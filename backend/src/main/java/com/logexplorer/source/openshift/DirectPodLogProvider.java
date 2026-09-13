package com.logexplorer.source.openshift;

import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SourceSearchOutcome;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.ContextTargetProofCodec;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.net.URI;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * OS-1C — direct OpenShift log retrieval: resolves the current OS-1B scope
 * into bounded (pod, container) targets, fetches each via the Kubernetes
 * pod-log API concurrently (bounded), reuses the canonical parser/filter
 * pipeline, and merges the result deterministically.
 *
 * <h2>Architecture</h2>
 *
 * <pre>
 * OpenShiftLogSource
 *    -&gt; DirectPodLogProvider (this class)
 *    -&gt; OpenShiftApiClient#fetchPodLog
 *    -&gt; LogLineParser (reused, unmodified)
 *    -&gt; EventFilters (reused, unmodified)
 *    -&gt; deterministic merge
 * </pre>
 *
 * <h2>Scope is consumed, never rediscovered (OS-1C §4)</h2>
 *
 * <p>This class reads {@link OpenShiftSession#scope()} exactly as OS-1B
 * last resolved it — it never calls {@code OpenShiftScopeService}'s own
 * discovery methods itself. "Workload = All" and "Pod = All" mean exactly
 * what OS-1B's own {@code discoverWorkloads()}/{@code discoverPods()}
 * already resolved and cached; this class only decides <em>which of those
 * already-resolved pods/containers</em> a specific search targets (OS-1C
 * §10), never re-derives the set itself. If the user has not yet visited
 * the scope controls for the currently-selected project, the resolved pod
 * list is genuinely empty and search correctly returns zero events — the
 * same "consume, don't guess" discipline OS-1B itself established for
 * "All workloads" is preserved one layer up.
 *
 * <h2>Immutable scope snapshot (OS-1C §23, atomicity corrected — OS-1D
 * final review recovery)</h2>
 *
 * <p>{@link #search} reads the selected project, generation, discovery
 * mode, and the whole {@link OpenShiftScope} exactly once, synchronously,
 * before issuing a single upstream call — every target fetched by one
 * search call belongs to that one snapshot. <b>That one read is now
 * genuinely atomic</b>: {@link #searchWithOutcome} calls {@link
 * OpenShiftSession#operationSnapshot()} exactly once and projects every
 * field (generation, server, token, CA path, selected project, scope)
 * from that same {@link ConnectionOperationSnapshot} — the original
 * implementation captured these through several independent {@code
 * OpenShiftSession} getter calls, each its own atomic read, which a
 * reconnect landing between two of them could turn into a hybrid of two
 * different connections. A project/workload switch (or reconnect) that
 * happens after a search has started has no effect on the pods/
 * containers, server, or token that search already resolved and is
 * executing against (OS-1C §22 "do not silently attach new pods").
 * Protecting the *frontend's* active search state from a late-arriving
 * stale response reuses the existing generic search request/abort
 * machinery (established since UX-R3) — this class adds no new mechanism
 * for that, per OS-1C §23's own
 * "reuse existing search request/race protections."
 *
 * <h2>Runtime warnings — RESOLVED (OS-1C review recovery)</h2>
 *
 * <p>{@link #describeScopeWarnings} can only ever report what is known
 * <em>before</em> any network call is made (scope completeness, target-cap
 * truncation) — a specific target's own runtime failure (403 on one pod,
 * 404 because it disappeared, a timeout, a byte/line cap actually hit) is
 * only known <em>during</em> {@link #search}. This section previously
 * documented that gap as "not yet individually named as a user-visible
 * note." It is now closed: {@link #searchWithOutcome} returns a {@link
 * SourceSearchOutcome} whose {@code runtimeWarnings} names exactly these
 * conditions, which {@code api.SearchService} appends into the same
 * query-plan {@code notes} channel {@link #describeScopeWarnings} already
 * uses — pre-search and runtime reasons now coexist in one place. {@link
 * #search} (the plain {@code Flux<CanonicalLogEvent>} form {@code
 * OpenShiftLogSource} and every pre-recovery test still use) is preserved
 * unchanged as a thin wrapper over {@link #searchWithOutcome} for exactly
 * that reason — see the OS-1C verification report's own "CI_RECOVERY"-
 * style section for the full before/after account of this fix.
 */
@Component
public class DirectPodLogProvider {

  /** Every proof this class issues/verifies is scoped to exactly this source id — see {@code resolveTargetPlan}. */
  private static final String SOURCE_ID = "openshift";

  private final OpenShiftApiClient client;
  private final OpenShiftSession session;
  private final LogLineParser parser;
  private final DirectPodLogProperties properties;
  private final ContextTargetProofCodec contextTargetProofCodec;

  public DirectPodLogProvider(
      OpenShiftApiClient client, OpenShiftSession session, LogLineParser parser, DirectPodLogProperties properties,
      ContextTargetProofCodec contextTargetProofCodec) {
    this.client = client;
    this.session = session;
    this.parser = parser;
    this.properties = properties;
    this.contextTargetProofCodec = contextTargetProofCodec;
  }

  /**
   * Bounded, cancellable direct search — see the class javadoc for the
   * full contract. A thin wrapper over {@link #searchWithOutcome}
   * preserving this method's own exact prior external behavior (same
   * event stream, same error semantics) — {@link #searchWithOutcome} is
   * the one real implementation; this exists only because it predates
   * OS-1C review recovery and {@code OpenShiftLogSource}/every existing
   * test still calls it directly.
   */
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    return searchWithOutcome(request).flatMapMany(outcome -> Flux.fromIterable(outcome.events()));
  }

  /**
   * OS-1C review recovery — same search as {@link #search}, but the
   * returned {@link SourceSearchOutcome} also names, per this exact
   * invocation: which targets could not be read and why (not found,
   * forbidden, timed out, a generic upstream error), which targets had
   * their response truncated at the per-target byte cap, which targets
   * returned exactly the requested line cap (so older matching lines may
   * exist unseen), and whether the internal overall-event safety cap
   * (never the caller's own smaller requested limit) trimmed the merged
   * result. See the class javadoc's "What this class deliberately does
   * not surface" section — this method is what closes that gap.
   */
  public Mono<SourceSearchOutcome> searchWithOutcome(SearchRequest request) {
    return Mono.defer(() -> {
      // OS-1D final snapshot atomicity recovery - exactly ONE atomic
      // session read for this whole operation. Every field this method
      // (and everything it calls: resolveTargetPlan, authorizeNarrowContextTarget,
      // fetchAndMerge, the final onErrorMap generation guard) uses is
      // projected from this SAME ConnectionOperationSnapshot - never
      // re-read individually, so a reconnect landing anywhere during this
      // method's execution cannot produce a hybrid pre-/post-reconnect
      // operation state (see ConnectionOperationSnapshot's own javadoc).
      ConnectionOperationSnapshot connection = session.operationSnapshot();
      requireConnectedWithSelectedProject(connection);
      long generation = connection.generation();
      URI server = connection.server();
      var token = connection.token();
      var caPath = connection.certificateAuthorityPath();
      String namespace = connection.selectedProject();
      OpenShiftScope scope = connection.scope();

      TargetPlan plan = resolveTargetPlan(scope, namespace, request, generation);
      Mono<SourceSearchOutcome> result = plan.queried().isEmpty()
          ? Mono.just(SourceSearchOutcome.of(List.of()))
          : fetchAndMerge(server, token, caPath, plan, request, generation);

      return result
          .timeout(properties.getOverallTimeout())
          .onErrorMap(OpenShiftApiException.class, e -> {
            // Deliberately a LIVE read here, compared against this
            // operation's own captured `generation` - this is the
            // generation GUARD itself (mission §9's own "intentionally
            // safe" carve-out), not a second snapshot field feeding this
            // operation's execution: it only ever decides whether to
            // expire the CURRENT live session, never what this operation
            // authorized against or executed against.
            if (e.kind() == Kind.UNAUTHORIZED && session.generation() == generation) {
              session.markExpired();
            }
            return e;
          });
    });
  }

  private Mono<SourceSearchOutcome> fetchAndMerge(
      URI server, RawToken token, String caPath, TargetPlan plan, SearchRequest request, long generation) {
    Instant fetchedAt = Instant.now();
    return Flux.fromIterable(plan.queried())
        .flatMap(target -> fetchTarget(server, token, caPath, target, request.start()), properties.getMaxConcurrency())
        .collectList()
        .flatMap(attempts -> {
          boolean anyOk = attempts.stream().anyMatch(a -> a.outcome() == TargetOutcome.OK);
          if (!anyOk) {
            boolean allForbidden = attempts.stream().allMatch(a -> a.outcome() == TargetOutcome.FORBIDDEN);
            if (allForbidden) {
              return Mono.error(new OpenShiftApiException(
                  Kind.FORBIDDEN, "Not permitted to read logs for any resolved pod/container in this project."));
            }
            // OS-1C review recovery - generalizes the all-forbidden check
            // above to every other all-failed case (all 404, all timeout,
            // all generic upstream error, or a mix of those with zero
            // successes): none of this is a legitimate "complete search,
            // zero matching events" result, and must never be returned as
            // one (mission §7 cases C/E). A distinct Kind (never NOT_FOUND/
            // NETWORK/TIMEOUT, which each mean something connection- or
            // discovery-level elsewhere) keeps this pod-log-fetch-specific
            // truth from being confused with those.
            return Mono.error(new OpenShiftApiException(Kind.UPSTREAM_UNAVAILABLE,
                "None of the " + attempts.size() + " resolved pod/container target"
                    + (attempts.size() == 1 ? "" : "s") + " could be read (" + summarizeFailureKinds(attempts) + ")."));
          }
          List<CanonicalLogEvent> events = parseFilterAndMerge(attempts, request, fetchedAt, generation);
          List<String> warnings = new ArrayList<>(buildRuntimeWarnings(attempts));
          TrimResult trimmed = trimToInternalCap(events, request);
          if (trimmed.safetyCapReached()) {
            warnings.add("Only " + trimmed.events().size() + " of " + trimmed.candidateCount()
                + " matching events were returned; an internal safety cap was reached, more matching events may "
                + "exist that were never evaluated (OVERALL_EVENT_CAP).");
          }
          return Mono.just(new SourceSearchOutcome(trimmed.events(), warnings));
        });
  }

  /** A short, safe (kind names only, never a response body) summary for the all-targets-failed exception message. */
  private static String summarizeFailureKinds(List<TargetAttempt> attempts) {
    Map<TargetOutcome, Long> byKind = new LinkedHashMap<>();
    for (TargetAttempt attempt : attempts) {
      byKind.merge(attempt.outcome(), 1L, Long::sum);
    }
    List<String> parts = new ArrayList<>();
    byKind.forEach((outcome, count) -> parts.add(count + " " + outcome.name()));
    return String.join(", ", parts);
  }

  /**
   * OS-1C review recovery - one aggregated, human-readable note per
   * distinct runtime condition actually observed across this search's
   * targets (never one note per target - a namespace with dozens of pods
   * must not flood the query-plan disclosure). Empty when every queried
   * target came back {@code OK} with no cap hit, which is the common case.
   */
  private static List<String> buildRuntimeWarnings(List<TargetAttempt> attempts) {
    int total = attempts.size();
    long notFound = attempts.stream().filter(a -> a.outcome() == TargetOutcome.NOT_FOUND).count();
    long forbidden = attempts.stream().filter(a -> a.outcome() == TargetOutcome.FORBIDDEN).count();
    long timedOut = attempts.stream().filter(a -> a.outcome() == TargetOutcome.TIMEOUT).count();
    long errored = attempts.stream().filter(a -> a.outcome() == TargetOutcome.ERROR).count();
    long byteCapped = attempts.stream().filter(TargetAttempt::byteCapReached).count();
    long lineCapped = attempts.stream().filter(TargetAttempt::linesPossiblyCapped).count();

    List<String> warnings = new ArrayList<>();
    if (notFound > 0) {
      warnings.add(countOf(notFound, total) + " could not be found - the pod may have been deleted or recycled "
          + "since scope was last resolved (TARGET_NOT_FOUND).");
    }
    if (forbidden > 0) {
      warnings.add(countOf(forbidden, total) + " not permitted to read (PERMISSION_DENIED).");
    }
    if (timedOut > 0) {
      warnings.add(countOf(timedOut, total) + " did not respond in time (TARGET_TIMEOUT).");
    }
    if (errored > 0) {
      warnings.add(countOf(errored, total) + " could not be read due to an upstream error (UPSTREAM_ERROR).");
    }
    if (byteCapped > 0) {
      warnings.add(countOf(byteCapped, total) + " own log response was truncated at the configured byte limit - "
          + "earlier lines within that response may be missing (BYTE_CAP_REACHED).");
    }
    if (lineCapped > 0) {
      warnings.add(countOf(lineCapped, total) + " returned exactly the requested line limit; older matching lines "
          + "may exist that were never read (LINE_CAP_REACHED_OR_POSSIBLE).");
    }
    return warnings;
  }

  private static String countOf(long count, int total) {
    return count + " of " + total + " pod/container target" + (total == 1 ? "" : "s");
  }

  /**
   * OS-1C — synchronous, no-network-call account of anything already known
   * to make this search's result potentially incomplete: scope
   * completeness (OS-1B review recovery's {@code workloadScopeComplete}/
   * {@code podScopeComplete}) and target-cap truncation. See the class
   * javadoc for why per-target runtime failures are not included here.
   *
   * <p><b>OS-1D final review recovery — one consistent snapshot, captured
   * once.</b> {@code namespace}, {@code scope}, and {@code generation} are
   * each read from {@link #session} exactly once, at the top, and then
   * threaded through to {@link #resolveTargetPlan}/{@link
   * #authorizeNarrowContextTarget} — never re-read individually
   * mid-method. This method itself is still correctly "live" in the sense
   * that mattered before (a fresh call always reflects current session
   * state, which is exactly right for a synchronous, no-network,
   * called-once-per-request informational method) — what changed is only
   * that the several session reads this one call makes can no longer
   * observe two different generations of session state within a single
   * invocation (mission §6/§9 "AUTHORIZATION_SNAPSHOT == EXECUTION_SNAPSHOT").
   */
  public List<String> describeScopeWarnings(SearchRequest request) {
    // OS-1D final snapshot atomicity recovery - one atomic read, exactly
    // like searchWithOutcome, rather than isConnected()/selectedProject()/
    // generation()/scope() as separate live reads.
    ConnectionOperationSnapshot connection = session.operationSnapshot();
    if (!connection.isConnected() || connection.selectedProject() == null) {
      return List.of();
    }
    long generation = connection.generation();
    String namespace = connection.selectedProject();
    OpenShiftScope scope = connection.scope();
    List<String> warnings = new ArrayList<>();
    if (!scope.workloadScopeComplete()) {
      warnings.add("Workload scope may be incomplete: one or more supported workload kinds could not be listed, "
          + "so some pods may be missing from this search (SCOPE_PARTIAL).");
    }
    if (!scope.podScopeComplete()) {
      warnings.add("Pod scope may be incomplete: one or more resolved workloads' own pods could not be listed, "
          + "so some pods may be missing from this search (SCOPE_PARTIAL).");
    }
    if (scope.selectedPod() == null && scope.pods().size() > properties.getMaxPods()) {
      warnings.add("Only " + properties.getMaxPods() + " of " + scope.pods().size()
          + " resolved pods were included in this search (TARGET_CAP_REACHED) - some pods were skipped.");
    }
    TargetPlan plan = resolveTargetPlan(scope, namespace, request, generation);
    if (plan.resolvedCount() > plan.queried().size()) {
      warnings.add("Only " + plan.queried().size() + " of " + plan.resolvedCount()
          + " resolved pod/container targets were queried (TARGET_CAP_REACHED) - some pods were skipped.");
    }
    return List.copyOf(warnings);
  }

  // ------------------------------------------------------------ target resolution

  private record TargetPlan(List<PodLogTarget> queried, int resolvedCount) {}

  /**
   * OS-1C §10 - resolves exactly what the current selection means, reading
   * only the already-cached OS-1B scope, then dedups and applies the hard
   * target cap (§8) — truncation is never silent; {@link #describeScopeWarnings}
   * reports it using the same {@code resolvedCount} this method computes.
   *
   * <p><b>OS-1D narrow-context override, corrected (OS-1D review
   * recovery).</b> When {@code request} carries both {@link
   * SearchRequest#pod()} and {@link SearchRequest#containerName()} — which
   * only ever happens for a "Show surrounding logs" call, the one place
   * {@code api.SearchController}'s {@code /context} endpoint populates
   * either field for this source — this resolves to <em>exactly that one
   * (pod, container) target</em> instead of the full currently-selected
   * OS-1B scope (mission §8: "Surrounding logs → same pod/container by
   * default", §16: never broaden scope implicitly).
   *
   * <p><b>CLIENT_POD_CONTAINER_FIELDS != AUTHORIZATION.</b> The original
   * OS-1D implementation constructed this single target directly from
   * {@code request.pod()}/{@code request.containerName()} whenever the pod
   * was absent from {@code scope.pods()}, with no further check — a real
   * server-side scope-integrity defect: those two fields come straight off
   * the HTTP request body, so a crafted request could name any pod/
   * container name in the current namespace (a Job pod, a standalone pod,
   * an operator pod — anything OS-1B never resolved into scope at all) and
   * this backend would still call the cluster's real pod-log API for it.
   * Corrected here: {@link #authorizeNarrowContextTarget} now requires
   * EITHER (a) the target is still present in the current {@code
   * scope.pods()} (ordinary, unchanged server-side scope validation — see
   * mission §12, this remains authoritative and is never weakened), OR
   * (b) {@link SearchRequest#contextTargetProof()} is a valid, {@link
   * ContextTargetProofCodec}-verified proof that this exact (source,
   * connection generation, namespace, pod, container) tuple was a real
   * target this backend itself resolved and queried at some point in the
   * current connection's lifetime — never inferred from message text,
   * traceId, correlationId, eventId, or a workload name the frontend
   * merely supplied (mission §7). Neither path ever authorizes anything
   * beyond exactly the one (pod, container) pair named — see {@link
   * ContextTargetProofCodec#verify}'s own javadoc for the full field-by-
   * field binding (source, generation, namespace, pod, container all must
   * match exactly). Failing both paths throws {@link
   * GuardrailViolationException} ({@link Reason#INVALID_CONTEXT_TARGET})
   * <em>before this method returns a target at all</em> — {@link
   * #fetchTarget}/{@code OpenShiftApiClient#fetchPodLog} are never
   * reached, so an unauthorized target results in genuinely zero cluster
   * calls, never a 404 that would otherwise (falsely) prove or disprove
   * the target's existence to an unauthorized caller (mission §8: "do not
   * leak whether arbitrary pod names exist").
   *
   * <p>A historically-valid but now-disappeared pod (the original, still-
   * valid OS-1D requirement: "a pod can legitimately disappear between the
   * original search and the investigator clicking the action") still
   * works exactly as before via path (b) — the real Kubernetes API call
   * still answers truthfully (404 if genuinely gone), which is what makes
   * "pod disappeared" a real, evidenced {@code TARGET_NOT_FOUND}/{@code
   * UPSTREAM_UNAVAILABLE} outcome (mission §9/§19/§32) rather than either
   * a silent empty result or an unauthorized-access risk.
   *
   * <p>Correlation/trace/journey calls never set {@code pod}/{@code
   * containerName} at all, so they are completely unaffected by any of
   * this and keep resolving the full OS-1B scope exactly as before
   * (mission §13/§16 - correlation stays inside the full resolved scope,
   * never narrowed to one historical target).
   */
  private TargetPlan resolveTargetPlan(OpenShiftScope scope, String namespace, SearchRequest request, long generation) {
    String narrowPod = blankToNull(request.pod());
    String narrowContainer = blankToNull(request.containerName());
    List<PodLogTarget> resolved = narrowPod != null && narrowContainer != null
        ? List.of(authorizeNarrowContextTarget(scope, namespace, narrowPod, narrowContainer, request, generation))
        : resolveTargets(scope, namespace);
    Map<String, PodLogTarget> deduped = new LinkedHashMap<>();
    for (PodLogTarget target : resolved) {
      deduped.putIfAbsent(target.targetKey(), target);
    }
    List<PodLogTarget> all = List.copyOf(deduped.values());
    List<PodLogTarget> capped = all.size() > properties.getMaxTargets()
        ? all.subList(0, properties.getMaxTargets())
        : all;
    return new TargetPlan(capped, all.size());
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  /**
   * OS-1D review recovery — the single security-critical gate for "Show
   * surrounding logs": returns the exact one target to query only after
   * establishing this backend's own evidence that (namespace, podName,
   * containerName) was a legitimate target, never trusting the request
   * fields alone. See {@link #resolveTargetPlan}'s own javadoc for the
   * full rule table (mission §6).
   *
   * <p><b>OS-1D final review recovery — {@code generation} is the
   * caller's own already-captured snapshot, never re-read here.</b> The
   * original implementation called {@code session.generation()} directly
   * at the point of verification — a time-of-check/time-of-use
   * inconsistency: {@code searchWithOutcome} already captures {@code
   * generation} (alongside {@code server}/{@code token}/{@code caPath}/
   * {@code scope}) as one immutable snapshot for the whole operation
   * before this method ever runs, and the actual pod-log fetch that
   * follows authorization uses that same captured {@code server}/{@code
   * token} — reading live session state here instead would let this one
   * check silently drift onto a *different* connection generation than
   * the one whose credentials will actually perform the read, the exact
   * "AUTHORIZATION_SNAPSHOT == EXECUTION_SNAPSHOT" invariant this
   * recovery exists to restore. {@code generation} must always be the
   * value the caller already captured, threaded down through {@link
   * #resolveTargetPlan}, never {@code session.generation()} read fresh
   * inside this method.
   */
  private PodLogTarget authorizeNarrowContextTarget(
      OpenShiftScope scope, String namespace, String podName, String containerName, SearchRequest request,
      long generation) {
    PodSummary pod = scope.findPod(podName);
    if (pod != null && pod.containerNames().contains(containerName)) {
      // Rule A - still in current OS-1B scope: ordinary, unweakened
      // server-side scope validation is authoritative on its own: no
      // proof is required or consulted at all.
      return new PodLogTarget(namespace, pod.workload(), podName, containerName);
    }
    // Rule B/C/D/E/F - not in current scope: a valid, server-issued
    // historical proof is the ONLY other path. contextTargetProofCodec
    // throws GuardrailViolationException(INVALID_CONTEXT_TARGET) - the
    // exact same fixed message - for a missing proof, a tampered/forged
    // one, or any single field mismatch (wrong source, stale connection
    // generation, wrong namespace, wrong pod, wrong container) alike, so
    // this call site never has to branch on (and therefore never risks
    // leaking) which specific check failed. Verified against THIS
    // operation's own captured `generation`, never a fresh
    // session.generation() read (see this method's own javadoc).
    contextTargetProofCodec.verify(
        request.contextTargetProof(), SOURCE_ID, generation, namespace, podName, containerName);
    // Workload identity is genuinely unknown for a target no longer in the
    // local cache - null here is the same "workload unknown" fallback
    // every other OK-outcome path already tolerates (see
    // parseFilterAndMerge's own serviceHint fallback).
    return new PodLogTarget(namespace, null, podName, containerName);
  }

  private List<PodLogTarget> resolveTargets(OpenShiftScope scope, String namespace) {
    List<PodLogTarget> targets = new ArrayList<>();
    if (scope.selectedPod() != null) {
      PodSummary pod = scope.findPod(scope.selectedPod());
      if (pod == null) {
        return List.of();
      }
      if (scope.selectedContainer() != null) {
        // Selected Pod + Selected Container -> one target.
        targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), scope.selectedContainer()));
      } else {
        // Selected Pod + Container=All -> every normal runtime container in that pod.
        for (String container : pod.containerNames()) {
          targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), container));
        }
      }
      return targets;
    }
    // Pod=All: every pod currently resolved for the selected workload
    // (Pod=All + Workload selected), or OS-1B's own resolved
    // supported-workload pod union (Pod=All + Workload=All) - both cases
    // are already exactly {@code scope.pods()}, since OS-1B's own
    // discoverPods() already scoped that list to the selected workload
    // when one is selected. Never every pod in the namespace.
    //
    // maxPods (§7/§8) is a hard cap on distinct pods considered, applied
    // BEFORE per-pod container expansion - kept separate from maxTargets
    // (the (pod, container) fan-out cap applied afterward in {@link
    // #resolveTargetPlan}) so a namespace with many single-container pods
    // and a namespace with few many-container pods are each bounded on the
    // dimension that actually threatens them; describeScopeWarnings
    // reports pod-level truncation using this same cap.
    List<PodSummary> pods = scope.pods();
    List<PodSummary> cappedPods = pods.size() > properties.getMaxPods()
        ? pods.subList(0, properties.getMaxPods())
        : pods;
    for (PodSummary pod : cappedPods) {
      // Container=All across multiple pods: each pod's own discovered
      // runtime containers, never assumed identical across replicas.
      for (String container : pod.containerNames()) {
        targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), container));
      }
    }
    return targets;
  }

  // ------------------------------------------------------------ fetch

  /** OS-1C review recovery adds {@code TIMEOUT}, distinct from the generic {@code ERROR} bucket (mission §8). */
  private enum TargetOutcome { OK, FORBIDDEN, NOT_FOUND, TIMEOUT, ERROR }

  /**
   * {@code byteCapReached}/{@code linesPossiblyCapped} are OS-1C review
   * recovery additions - real, per-target truncation signals (never
   * inferred after the fact) that {@link #buildRuntimeWarnings} turns
   * into aggregate, user-visible notes.
   */
  private record TargetAttempt(
      PodLogTarget target, List<String> rawLines, TargetOutcome outcome, boolean byteCapReached,
      boolean linesPossiblyCapped) {
    private static TargetAttempt failed(PodLogTarget target, TargetOutcome outcome) {
      return new TargetAttempt(target, List.of(), outcome, false, false);
    }
  }

  private Mono<TargetAttempt> fetchTarget(
      URI server, RawToken token, String caPath, PodLogTarget target, Instant sinceTime) {
    int maxLines = properties.getMaxLinesPerTarget();
    return client
        .fetchPodLog(server, token, caPath, target.namespace(), target.podName(), target.containerName(),
            sinceTime, maxLines, properties.getMaxBytesPerTarget(), properties.getPerTargetTimeout())
        .map(result -> {
          List<String> lines = splitLines(result.body());
          boolean byteCapped = result.byteCapReached();
          if (byteCapped && !lines.isEmpty() && !result.body().endsWith("\n")) {
            // OS-1C review recovery - the byte cap almost always cuts off
            // mid-line; the trailing "line" left in the truncated body is
            // an artifact of exactly where OUR OWN client-side cap
            // happened to stop reading, never a real, complete line the
            // upstream actually sent. Surfacing it as a "malformed" event
            // would misrepresent an artifact of truncation as real (if
            // garbled) log content - dropped instead, same "never
            // fabricate/mislead" discipline as the byte-level UTF-8
            // boundary trim in OpenShiftApiClient. If the cap happened to
            // land exactly on a line boundary (body ends with \n), every
            // split line is genuinely complete and none of this applies.
            lines = lines.subList(0, lines.size() - 1);
          }
          // "Exactly tailLines came back" is the only truthful signal
          // available (mission §2/§9) - the Kubernetes pod-log API gives
          // no separate "there were more" indicator, so this is
          // deliberately a conservative POSSIBLE, never a claimed
          // certainty (LINE_CAP_REACHED_OR_POSSIBLE, never
          // LINE_CAP_REACHED alone).
          boolean linesPossiblyCapped = lines.size() >= maxLines;
          return new TargetAttempt(target, lines, TargetOutcome.OK, byteCapped, linesPossiblyCapped);
        })
        .onErrorResume(OpenShiftApiException.class, e -> {
          if (e.kind() == Kind.UNAUTHORIZED) {
            return Mono.error(e);
          }
          TargetOutcome outcome = switch (e.kind()) {
            case FORBIDDEN -> TargetOutcome.FORBIDDEN;
            case NOT_FOUND -> TargetOutcome.NOT_FOUND;
            case TIMEOUT -> TargetOutcome.TIMEOUT;
            default -> TargetOutcome.ERROR;
          };
          return Mono.just(TargetAttempt.failed(target, outcome));
        });
  }

  private static List<String> splitLines(String body) {
    if (body == null || body.isEmpty()) {
      return List.of();
    }
    return Arrays.stream(body.split("\n", -1)).filter(line -> !line.isEmpty()).toList();
  }

  // ------------------------------------------------------------ parse + filter + merge

  private record ParsedEvent(CanonicalLogEvent event, PodLogTarget target, int sequence) {}

  private List<CanonicalLogEvent> parseFilterAndMerge(
      List<TargetAttempt> attempts, SearchRequest request, Instant fetchedAt, long generation) {
    List<ParsedEvent> parsed = new ArrayList<>();
    for (TargetAttempt attempt : attempts) {
      if (attempt.outcome() != TargetOutcome.OK) {
        continue;
      }
      // OS-1D review recovery - issued once per target (not per line):
      // this is the server-side evidence that (namespace, pod, container)
      // was a real, legitimately-queried target of THIS search, which
      // authorizeNarrowContextTarget later requires before it will accept
      // this exact target again once it has aged out of the OS-1B scope
      // cache (see that method's own javadoc for the full authorization
      // contract - a client-supplied pod/containerName pair is never, by
      // itself, sufficient).
      String contextTargetProof = contextTargetProofCodec.encode(
          SOURCE_ID, generation, attempt.target().namespace(), attempt.target().podName(),
          attempt.target().containerName());
      int sequence = 0;
      for (String rawLine : attempt.rawLines()) {
        Instant sourceTimestamp = extractTimestamp(rawLine, fetchedAt);
        String content = stripTimestamp(rawLine);
        String serviceHint = attempt.target().workload() != null ? attempt.target().workload().name() : null;
        CanonicalLogEvent event = parser.parse(content, serviceHint).toBuilder()
            .sourceId(SOURCE_ID)
            .namespace(attempt.target().namespace())
            .pod(attempt.target().podName())
            .containerName(attempt.target().containerName())
            .sourceTimestamp(sourceTimestamp)
            .contextTargetProof(contextTargetProof)
            .build();
        if (EventFilters.matches(event, request)) {
          parsed.add(new ParsedEvent(event, attempt.target(), sequence));
        }
        sequence++;
      }
    }

    // OS-1C §17 - deterministic multi-stream merge: primary key is the
    // event's own (source-native) timestamp, direction-of-travel ordered
    // exactly like Docker's own merge; secondary tie-breakers are
    // explicit and stable (namespace, pod, container, then this event's
    // own per-stream sequence) - never left to Flux arrival timing, which
    // Reactor's bounded flatMap does not otherwise preserve.
    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    parsed.sort(Comparator
        .comparing((ParsedEvent p) -> p.event().sourceTimestamp(), Comparator.nullsLast(nativeOrder))
        .thenComparing(p -> p.event().namespace(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(p -> p.event().pod(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(p -> p.event().containerName(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparingInt(ParsedEvent::sequence));

    return parsed.stream().map(ParsedEvent::event).toList();
  }

  /**
   * OS-1C §24 - never returns more than this source's own internal
   * default/cap, or the caller's requested limit if smaller. Deliberately
   * conservative: {@code api.SearchService} only ever builds a pagination
   * cursor when a source returns MORE events than the effective limit it
   * computed — trimming here first means that never happens for this
   * source, which is what makes {@code pagination=false} true rather than
   * aspirational (OS-1C never invents a cursor by slicing an
   * already-truncated array).
   *
   * @return the (possibly trimmed) events, plus whether an internal safety
   *     cap ({@code maxEventsOverall} — never the caller's own smaller
   *     requested {@code limit}, which trimming here without comment
   *     already always honored) is what actually did the trimming (OS-1C
   *     review recovery mission §6 — "distinguish request limit
   *     intentionally requested ... from ... internal safety cap")
   */
  private record TrimResult(List<CanonicalLogEvent> events, int candidateCount, boolean safetyCapReached) {}

  private TrimResult trimToInternalCap(List<CanonicalLogEvent> events, SearchRequest request) {
    int maxEventsOverall = properties.getMaxEventsOverall();
    int cap = request.limit() != null ? Math.min(request.limit(), maxEventsOverall) : maxEventsOverall;
    boolean trimmed = events.size() > cap;
    // The safety cap is only the "surprise" worth naming when it is what
    // actually controlled the result - if the caller's own smaller
    // request.limit() is what trimmed, that is ordinary, expected, already
    // truthfully reflected by ResultCounts#limit()/truncated() upstream in
    // api.SearchService, and never worth an extra OS-1C-specific note.
    boolean safetyCapControlling = request.limit() == null || maxEventsOverall < request.limit();
    List<CanonicalLogEvent> result = trimmed ? events.subList(0, cap) : events;
    return new TrimResult(result, events.size(), trimmed && safetyCapControlling);
  }

  /**
   * Kubernetes' {@code timestamps=true} prefixes every line with its own
   * RFC3339Nano receive timestamp followed by a single space (OS-1C §5) -
   * this is this event's {@code sourceTimestamp}, always set even when the
   * line's own content fails canonical parsing (mirrors Docker's frame-
   * receive-time convention exactly). Falls back to the time this batch
   * was fetched only if the prefix is missing or unparseable - never null.
   */
  private static Instant extractTimestamp(String line, Instant fallback) {
    int idx = line.indexOf(' ');
    if (idx < 0) {
      return fallback;
    }
    try {
      return Instant.parse(line.substring(0, idx));
    } catch (DateTimeParseException e) {
      return fallback;
    }
  }

  private static String stripTimestamp(String line) {
    int idx = line.indexOf(' ');
    if (idx < 0) {
      return line;
    }
    try {
      Instant.parse(line.substring(0, idx));
      return line.substring(idx + 1);
    } catch (DateTimeParseException e) {
      return line;
    }
  }

  /**
   * OS-1D final snapshot atomicity recovery - validates connection state
   * from the operation's own already-captured {@link ConnectionOperationSnapshot},
   * never by re-reading {@link #session} live. Replaces the previous
   * {@code requireSelectedProject()}, which independently called {@code
   * session.isConnected()} then {@code session.selectedProject()} - two
   * more separate live reads that could each observe a different
   * connection generation than the rest of the operation.
   */
  private static void requireConnectedWithSelectedProject(ConnectionOperationSnapshot connection) {
    if (!connection.isConnected()) {
      throw new IllegalStateException("Not connected to OpenShift.");
    }
    if (connection.selectedProject() == null) {
      throw new IllegalStateException("No project/namespace selected.");
    }
  }
}
