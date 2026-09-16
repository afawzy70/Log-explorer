import type {
  CanonicalFieldKey,
  ClassificationRule,
  ClassificationRulesState,
  ExtractionSuggestionRequest,
  ExtractionSuggestionResult,
  ImportApplyRequest,
  ImportApplyResult,
  ImportPreviewResult,
  PatternDetectionRequest,
  PatternDetectionResult,
  RuleTestRequest,
  RuleTestResult,
  RuleValidationError,
  RuleValidationResult,
  ContextRequestBody,
  DockerConnectionCandidate,
  DockerConnectionSummary,
  EnvironmentInfo,
  FieldMappingProfileDto,
  FieldMappingSampleResponse,
  FieldMappingValidationReport,
  SchemaScanResponse,
  JourneyRequestBody,
  MaskingSettings,
  ProblemDetail,
  ProtectedFieldKey,
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealth,
  SourceHealthDetail,
  SourceInfo,
  OpenShiftConnectionSummary,
  OpenShiftFailureReason,
  OpenShiftPodDiscovery,
  OpenShiftProxySettings,
  OpenShiftScopeSummary,
  OpenShiftWorkloadDiscovery,
  OpenShiftWorkloadKind,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail;

  constructor(status: number, problem: ProblemDetail) {
    super(problem.detail ?? problem.title ?? `Request failed with status ${status}`);
    this.status = status;
    this.problem = problem;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let problem: ProblemDetail = { status: response.status };
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Body wasn't JSON (or empty) - fall back to the bare status.
    }
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<T>;
}

export async function fetchSources(signal?: AbortSignal): Promise<SourceInfo[]> {
  const response = await fetch('/api/v1/sources', { signal });
  return parseJsonOrThrow<SourceInfo[]>(response);
}

export async function fetchSourceHealth(sourceId: string, signal?: AbortSignal): Promise<SourceHealthDetail> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/health`, { signal });
  return parseJsonOrThrow<SourceHealthDetail>(response);
}

/** UX-R3 §7/§8 — `composeProject`, when supplied, scopes discovery to that one project's own hard boundary (never a frontend-only filter). */
export async function fetchSourceServices(
  sourceId: string,
  composeProject?: string,
  signal?: AbortSignal,
): Promise<ServiceInfo[]> {
  const query = composeProject ? `?composeProject=${encodeURIComponent(composeProject)}` : '';
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/services${query}`, { signal });
  return parseJsonOrThrow<ServiceInfo[]>(response);
}

/**
 * UX-R3 §7 — real, currently-visible Docker Compose projects on this
 * source's own connection (canonical `com.docker.compose.project` label,
 * never a container-name guess, never fabricated). Empty for a source
 * with no real Compose-project concept - callers gate on {@link
 * SourceCapabilities.composeProjectScoping}, never this list's emptiness
 * alone, to tell "unsupported" apart from "supported, currently empty."
 */
export async function fetchComposeProjects(sourceId: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/compose-projects`, { signal });
  return parseJsonOrThrow<string[]>(response);
}

/** UI Gap Closure Pass - the real, running instance's active Spring profile(s), never a guess (`EnvironmentInfoContributor`). */
export async function fetchEnvironmentInfo(signal?: AbortSignal): Promise<EnvironmentInfo> {
  const response = await fetch('/actuator/info', { signal });
  return parseJsonOrThrow<EnvironmentInfo>(response);
}

/**
 * Search values never appear in the URL (CLAUDE.md §2 rule 4) - this is
 * the only place the frontend ever sends them, as a POST body, never as
 * query-string parameters.
 */
export async function runSearch(body: SearchRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * "Show ±30 seconds" (IMPLEMENTATION_PLAN.md "Phase H") - a distinct
 * endpoint from `runSearch` because the window itself is never
 * client-supplied (see `ContextRequestBody`'s own comment); the backend
 * computes it from `timestamp` alone.
 */
export async function fetchContext(body: ContextRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * "Find this trace/correlation/journey/event" (IMPLEMENTATION_PLAN.md
 * "Phase I") - a distinct endpoint from `runSearch` because the backend
 * enforces ascending order here (no `LogSource` implementation this
 * project has honors `direction` consistently - see `SearchController#journey`'s
 * own comment), which the general search endpoint does not guarantee.
 */
export async function fetchJourney(body: JourneyRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/journey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * Docker connection settings (Legacy Remediation Slice 3) - the current
 * effective configuration, sanitized, read-only.
 */
export async function fetchDockerConnectionSummary(signal?: AbortSignal): Promise<DockerConnectionSummary> {
  const response = await fetch('/api/v1/sources/docker/connection', { signal });
  return parseJsonOrThrow<DockerConnectionSummary>(response);
}

/**
 * Test Connection (Legacy Remediation Slice 3) - `candidate` is ephemeral,
 * sent as a POST body only, never persisted anywhere by this client and
 * never applied to the running application's actual Docker connection.
 */
export async function testDockerConnection(candidate: DockerConnectionCandidate, signal?: AbortSignal): Promise<SourceHealth> {
  const response = await fetch('/api/v1/sources/docker/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
    signal,
  });
  return parseJsonOrThrow<SourceHealth>(response);
}

/*
 * Pre-closure functional recovery (§11/§12/§13) - the global, source-
 * independent masking-settings endpoint. Deliberately not nested under
 * `/sources/docker` or `/sources/openshift` - masking applies identically
 * to every source. `updateMaskingSetting` toggles exactly ONE field at a
 * time (matching the settings UI's own one-checkbox-per-field
 * interaction) and returns the full, authoritative policy the server now
 * holds - callers must apply the RETURNED policy, never optimistically
 * assume their own requested change took effect (the server is always the
 * single source of truth for this).
 */
export async function fetchMaskingSettings(signal?: AbortSignal): Promise<MaskingSettings> {
  const response = await fetch('/api/v1/settings/masking', { signal });
  return parseJsonOrThrow<MaskingSettings>(response);
}

export async function updateMaskingSetting(
  field: ProtectedFieldKey,
  masked: boolean,
  signal?: AbortSignal,
): Promise<MaskingSettings> {
  const response = await fetch('/api/v1/settings/masking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, masked }),
    signal,
  });
  return parseJsonOrThrow<MaskingSettings>(response);
}

/* ------------------------------------------------------------------ */
/* OS-1A - OpenShift connection                                        */
/* ------------------------------------------------------------------ */

export async function fetchOpenShiftConnection(signal?: AbortSignal): Promise<OpenShiftConnectionSummary> {
  const response = await fetch('/api/v1/sources/openshift/connection', { signal });
  return parseJsonOrThrow<OpenShiftConnectionSummary>(response);
}

/**
 * Whether this instance may accept credentials at all.
 *
 * The backend refuses credential intake unless it is bound to a loopback
 * address (OS-1A §10). Asking first lets the UI explain *why* the form is
 * unavailable instead of letting the user type a token and then fail.
 */
export async function fetchOpenShiftIntakeAllowed(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch('/api/v1/sources/openshift/connection/intake-allowed', { signal });
  return parseJsonOrThrow<boolean>(response);
}

/**
 * Establishes the connection.
 *
 * `loginCommand` is the pasted `oc login` text. It is sent exactly once,
 * as a POST body over the loopback interface, and is **never** retained by
 * this client: the caller clears its own form state immediately, and the
 * value is never written to `localStorage`, `sessionStorage` or the URL
 * (CLAUDE.md §2 rule 4). The backend parses it - it is never executed.
 */
export async function connectOpenShift(
  loginCommand: string,
  connectionName: string | undefined,
  signal?: AbortSignal,
): Promise<OpenShiftConnectionSummary> {
  const response = await fetch('/api/v1/sources/openshift/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginCommand, connectionName: connectionName || null }),
    signal,
  });
  return parseJsonOrThrow<OpenShiftConnectionSummary>(response);
}

export async function disconnectOpenShift(signal?: AbortSignal): Promise<OpenShiftConnectionSummary> {
  const response = await fetch('/api/v1/sources/openshift/connect', { method: 'DELETE', signal });
  return parseJsonOrThrow<OpenShiftConnectionSummary>(response);
}

export async function refreshOpenShiftProjects(signal?: AbortSignal): Promise<OpenShiftConnectionSummary> {
  const response = await fetch('/api/v1/sources/openshift/projects/refresh', { method: 'POST', signal });
  return parseJsonOrThrow<OpenShiftConnectionSummary>(response);
}

/** Commits the selected project - safe, non-sensitive data (OS-1A §20). */
export async function selectOpenShiftProject(
  project: string | null,
  signal?: AbortSignal,
): Promise<OpenShiftConnectionSummary> {
  const response = await fetch('/api/v1/sources/openshift/project', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
    signal,
  });
  return parseJsonOrThrow<OpenShiftConnectionSummary>(response);
}

/**
 * Pre-closure functional recovery 2 (§B2/§B16) - the current OpenShift/
 * Loki proxy mode, independent of whether a connection currently exists
 * (it applies to the connect/test attempt itself).
 */
export async function fetchOpenShiftProxySettings(signal?: AbortSignal): Promise<OpenShiftProxySettings> {
  const response = await fetch('/api/v1/sources/openshift/proxy', { signal });
  return parseJsonOrThrow<OpenShiftProxySettings>(response);
}

/**
 * Sets the proxy mode/host/port. `host`/`port` are ignored by the backend
 * unless `mode` is `'CUSTOM'` - always send `null` for the other two
 * modes so a leftover value from a previous CUSTOM entry is never
 * mistakenly resubmitted (§B3 "switching away from CUSTOM must stop using
 * stale custom values").
 */
export async function updateOpenShiftProxySettings(
  settings: OpenShiftProxySettings,
  signal?: AbortSignal,
): Promise<OpenShiftProxySettings> {
  const response = await fetch('/api/v1/sources/openshift/proxy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
    signal,
  });
  return parseJsonOrThrow<OpenShiftProxySettings>(response);
}

/* ------------------------------------------------------------------ */
/* OS-1B - OpenShift workload / pod / container scope discovery        */
/* ------------------------------------------------------------------ */

/**
 * OS-1F - a pure, non-mutating read of the session's CURRENT project/
 * workload/pod/container scope, for a truthful "WHERE am I searching?"
 * trail (`ScopeTrail`) and for restoring the Settings panel's own scope
 * controls on reopen - never inferred from a mutating PUT response, and
 * never re-derived by re-running discovery.
 */
export async function fetchOpenShiftScope(signal?: AbortSignal): Promise<OpenShiftScopeSummary> {
  const response = await fetch('/api/v1/sources/openshift/scope', { signal });
  return parseJsonOrThrow<OpenShiftScopeSummary>(response);
}

export async function fetchOpenShiftWorkloads(signal?: AbortSignal): Promise<OpenShiftWorkloadDiscovery> {
  const response = await fetch('/api/v1/sources/openshift/workloads', { signal });
  return parseJsonOrThrow<OpenShiftWorkloadDiscovery>(response);
}

/** Commits (or clears, with both fields `null`) a workload selection (OS-1B §13). */
export async function selectOpenShiftWorkload(
  workload: { kind: OpenShiftWorkloadKind; name: string } | null,
  signal?: AbortSignal,
): Promise<OpenShiftScopeSummary> {
  const response = await fetch('/api/v1/sources/openshift/workload', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: workload?.kind ?? null, name: workload?.name ?? null }),
    signal,
  });
  return parseJsonOrThrow<OpenShiftScopeSummary>(response);
}

/**
 * Pods for the currently-selected workload, or the union of pods
 * belonging to every currently-discovered supported workload when no
 * workload is selected ("All workloads", OS-1B §22) - never every pod in
 * the namespace (OS-1B review recovery). See {@link OpenShiftPodDiscovery}
 * for what `status: 'PARTIAL'` means.
 */
export async function fetchOpenShiftPods(signal?: AbortSignal): Promise<OpenShiftPodDiscovery> {
  const response = await fetch('/api/v1/sources/openshift/pods', { signal });
  return parseJsonOrThrow<OpenShiftPodDiscovery>(response);
}

/** Commits (or clears, with `null`) a pod selection (OS-1B §13). */
export async function selectOpenShiftPod(pod: string | null, signal?: AbortSignal): Promise<OpenShiftScopeSummary> {
  const response = await fetch('/api/v1/sources/openshift/pod', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pod }),
    signal,
  });
  return parseJsonOrThrow<OpenShiftScopeSummary>(response);
}

/** Container names for the currently-selected pod - empty when no pod is selected (OS-1B §11). */
export async function fetchOpenShiftContainers(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/v1/sources/openshift/containers', { signal });
  return parseJsonOrThrow<string[]>(response);
}

/** Commits (or clears, with `null`) a container selection (OS-1B §13). */
export async function selectOpenShiftContainer(
  container: string | null,
  signal?: AbortSignal,
): Promise<OpenShiftScopeSummary> {
  const response = await fetch('/api/v1/sources/openshift/container', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ container }),
    signal,
  });
  return parseJsonOrThrow<OpenShiftScopeSummary>(response);
}

/**
 * The backend's machine-readable failure category, when present.
 *
 * Used to choose precise copy ("that is not an https:// server URL")
 * instead of a generic "connection failed" - OS-1A §18 explicitly forbids
 * the generic message where a safe precise one exists.
 */
export function openShiftFailureReason(error: unknown): OpenShiftFailureReason | null {
  if (error instanceof ApiError) {
    const reason = (error.problem as { reason?: string } | undefined)?.reason;
    return (reason as OpenShiftFailureReason | undefined) ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Configurable Log Field Mapping + Original JSON Sampling             */
/* ------------------------------------------------------------------ */

/** True when `error` is the backend's `MAPPING_NOT_READY` guardrail rejection ({@code GuardrailViolationException.Reason.MAPPING_NOT_READY}) — the same `.problem.reason` convention {@link openShiftFailureReason} already uses. */
export function isMappingNotReadyError(error: unknown): boolean {
  return error instanceof ApiError && (error.problem as { reason?: string } | undefined)?.reason === 'MAPPING_NOT_READY';
}

/**
 * Owner mission "Project-Scoped Schema Scan" §7/§8 — every field-mapping
 * settings call is scoped to a real source + selected project/namespace
 * (Compose project for Docker, the resolved OpenShift project for
 * OpenShift, `undefined` for a source with no sub-project concept).
 * Omitting both falls back to the backend's legacy/global scope.
 */
function scopeQuery(sourceId?: string, project?: string | null): string {
  const params = new URLSearchParams();
  if (sourceId) {
    params.set('sourceId', sourceId);
  }
  if (project) {
    params.set('project', project);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchFieldMappingProfile(
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(`/api/v1/settings/field-mapping${scopeQuery(sourceId, project)}`, { signal });
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

export async function updateFieldMappingCandidates(
  field: CanonicalFieldKey,
  candidatePaths: string[],
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(
    `/api/v1/settings/field-mapping/fields/${encodeURIComponent(field)}${scopeQuery(sourceId, project)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidatePaths }),
      signal,
    },
  );
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

export async function resetFieldMappingProfile(
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(`/api/v1/settings/field-mapping/reset${scopeQuery(sourceId, project)}`, {
    method: 'POST',
    signal,
  });
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

/**
 * `samples` are real, unmasked Original Source JSON strings the caller
 * already fetched and is holding in its own component state — never
 * re-persisted here, this is a stateless pass-through call (mission §4/§20).
 */
export async function validateFieldMapping(
  proposedCandidates: Partial<Record<CanonicalFieldKey, string[]>>,
  samples: string[],
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingValidationReport> {
  const response = await fetch(`/api/v1/settings/field-mapping/validate${scopeQuery(sourceId, project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposedCandidates, samples }),
    signal,
  });
  return parseJsonOrThrow<FieldMappingValidationReport>(response);
}

/** `validationPassed` must be the real `passed` value from the most recent {@link validateFieldMapping} call — never hardcoded `true`. */
export async function saveFieldMappingProfile(
  validationPassed: boolean,
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(`/api/v1/settings/field-mapping/save${scopeQuery(sourceId, project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validationPassed }),
    signal,
  });
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

/**
 * Owner mission "Mapping Verification and Investigation Workspace" -
 * evidence-gated: the backend re-validates this field's CURRENT candidate
 * paths against `samples` (real Original Source JSON the caller already
 * holds, e.g. from a Quick Schema Scan) and only marks it `VERIFIED` when
 * that fresh check actually finds it - a 400 ({@link ApiError}) otherwise,
 * never a silent "verified" on faith. `samples` never persists past this
 * one call (mission §4/§20 - same rule as every other field-mapping call
 * that carries real sample content).
 */
export async function verifyFieldMapping(
  field: CanonicalFieldKey,
  samples: string[],
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(
    `/api/v1/settings/field-mapping/fields/${encodeURIComponent(field)}/verify${scopeQuery(sourceId, project)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
      signal,
    },
  );
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

/** Owner mission "Mapping Verification and Investigation Workspace" - an explicit, no-evidence-required owner flag: "I have reviewed this and it needs to change." Never silently promoted back to `VERIFIED` by a later save alone. */
export async function markFieldMappingNeedsChange(
  field: CanonicalFieldKey,
  sourceId?: string,
  project?: string | null,
  signal?: AbortSignal,
): Promise<FieldMappingProfileDto> {
  const response = await fetch(
    `/api/v1/settings/field-mapping/fields/${encodeURIComponent(field)}/needs-change${scopeQuery(sourceId, project)}`,
    { method: 'POST', signal },
  );
  return parseJsonOrThrow<FieldMappingProfileDto>(response);
}

/**
 * Original Source JSON samples (mission §3/§5) — bounded (1-50, default
 * 20), real, unmasked. The caller must hold the result only in ephemeral
 * component state, never `localStorage`/`sessionStorage`/a URL.
 */
export async function fetchFieldMappingSamples(
  sourceId: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<FieldMappingSampleResponse> {
  const query = limit != null ? `?limit=${encodeURIComponent(limit)}` : '';
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/field-mapping/samples${query}`, {
    method: 'POST',
    signal,
  });
  return parseJsonOrThrow<FieldMappingSampleResponse>(response);
}

/**
 * Quick Schema Scan (owner mission "Field Mapping Schema Scan + Masking
 * Policy Extension" §A) — bounded, severity/structure-diverse scan
 * returning both real Original Event Samples and the generated Discovered
 * Source Schema union. The caller must hold the result only in ephemeral
 * component state, never `localStorage`, exactly like {@link
 * fetchFieldMappingSamples}.
 */
export async function fetchFieldMappingSchemaScan(
  sourceId: string,
  project?: string | null,
  maxEvents?: number,
  signal?: AbortSignal,
): Promise<SchemaScanResponse> {
  const params = new URLSearchParams();
  if (project) {
    params.set('project', project);
  }
  if (maxEvents != null) {
    params.set('maxEvents', String(maxEvents));
  }
  const qs = params.toString();
  const response = await fetch(
    `/api/v1/sources/${encodeURIComponent(sourceId)}/field-mapping/schema-scan${qs ? `?${qs}` : ''}`,
    { method: 'POST', signal },
  );
  return parseJsonOrThrow<SchemaScanResponse>(response);
}

/* ------------------------------------------------------------------ */
/* Event Classification & Extraction Rules                             */
/* ------------------------------------------------------------------ */

const CLASSIFICATION_RULES_BASE = '/api/v1/settings/classification-rules';

/** The backend's machine-readable `reason`, when the error carries one. */
export function apiErrorReason(error: unknown): string | null {
  return error instanceof ApiError ? (error.problem.reason ?? null) : null;
}

/** `RULES_REVISION_CONFLICT` - the rules changed elsewhere since this client last read them. */
export function isRulesRevisionConflict(error: unknown): boolean {
  return apiErrorReason(error) === 'RULES_REVISION_CONFLICT';
}

/** Per-path validation errors carried by `RULE_INVALID` / `IMPORT_HAS_INVALID_RULES`; empty otherwise. */
export function ruleValidationErrors(error: unknown): RuleValidationError[] {
  return error instanceof ApiError && Array.isArray(error.problem.errors) ? error.problem.errors : [];
}

export async function fetchClassificationRules(signal?: AbortSignal): Promise<ClassificationRulesState> {
  const response = await fetch(CLASSIFICATION_RULES_BASE, { signal });
  return parseJsonOrThrow<ClassificationRulesState>(response);
}

export async function createClassificationRule(
  expectedRevision: number,
  rule: ClassificationRule,
  signal?: AbortSignal,
): Promise<ClassificationRulesState> {
  const response = await fetch(CLASSIFICATION_RULES_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, rule }),
    signal,
  });
  return parseJsonOrThrow<ClassificationRulesState>(response);
}

export async function updateClassificationRule(
  id: string,
  expectedRevision: number,
  rule: ClassificationRule,
  signal?: AbortSignal,
): Promise<ClassificationRulesState> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, rule }),
    signal,
  });
  return parseJsonOrThrow<ClassificationRulesState>(response);
}

export async function deleteClassificationRule(
  id: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ClassificationRulesState> {
  const response = await fetch(
    `${CLASSIFICATION_RULES_BASE}/${encodeURIComponent(id)}?expectedRevision=${encodeURIComponent(expectedRevision)}`,
    { method: 'DELETE', signal },
  );
  return parseJsonOrThrow<ClassificationRulesState>(response);
}

export async function validateClassificationRule(rule: ClassificationRule, signal?: AbortSignal): Promise<RuleValidationResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
    signal,
  });
  return parseJsonOrThrow<RuleValidationResult>(response);
}

/** A suggestion only - the backend saves nothing. The anchor value travels in the POST body, never a URL. */
export async function detectClassificationPattern(
  body: PatternDetectionRequest,
  signal?: AbortSignal,
): Promise<PatternDetectionResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<PatternDetectionResult>(response);
}

/** Evaluates a draft rule against a bounded sample - nothing is persisted. */
/**
 * Suggests extractable values from the events a rule matches in the committed search scope. Deterministic and
 * server-side (the same detector Detect pattern uses); saves nothing.
 */
export async function suggestClassificationExtractions(
  body: ExtractionSuggestionRequest,
  signal?: AbortSignal,
): Promise<ExtractionSuggestionResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/extractions/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<ExtractionSuggestionResult>(response);
}

export async function testClassificationRule(body: RuleTestRequest, signal?: AbortSignal): Promise<RuleTestResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<RuleTestResult>(response);
}

/** `ids` omitted or empty exports every rule. Rule ids are non-sensitive identifiers. */
export function classificationExportUrl(ids?: string[]): string {
  const params = new URLSearchParams();
  for (const id of ids ?? []) {
    params.append('ids', id);
  }
  const qs = params.toString();
  return `${CLASSIFICATION_RULES_BASE}/export${qs ? `?${qs}` : ''}`;
}

const DEFAULT_EXPORT_FILENAME = 'log-explorer-classification-pack.json';

function filenameFromDisposition(header: string | null): string {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null;
  return match ? match[1] : DEFAULT_EXPORT_FILENAME;
}

/**
 * Downloads the rule pack: fetch, Blob, object URL, a temporary
 * `<a download>` that is clicked and removed, then the URL is revoked.
 */
export async function downloadClassificationRulesExport(ids?: string[], signal?: AbortSignal): Promise<void> {
  const response = await fetch(classificationExportUrl(ids), { signal });
  if (!response.ok) {
    await parseJsonOrThrow<never>(response);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filenameFromDisposition(response.headers.get('Content-Disposition'));
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Sends the raw pack file text as `text/plain`. Writes nothing. */
export async function previewClassificationImport(packText: string, signal?: AbortSignal): Promise<ImportPreviewResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/import/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: packText,
    signal,
  });
  return parseJsonOrThrow<ImportPreviewResult>(response);
}

export async function applyClassificationImport(body: ImportApplyRequest, signal?: AbortSignal): Promise<ImportApplyResult> {
  const response = await fetch(`${CLASSIFICATION_RULES_BASE}/import/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<ImportApplyResult>(response);
}
