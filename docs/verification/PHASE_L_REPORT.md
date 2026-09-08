# Phase L — OpenShift deployment assets — Verification Report

Branch: `phase/l-openshift-deployment-assets`
Date: 2026-09-08

## Prerequisite

Phase K (portable Docker Compose delivery) is merged (PR #13) — confirmed via `gh pr view 13` (`MERGED`, `mergedAt: 2026-09-08T12:30:44Z`) and a fresh `main` checkout with the full backend suite (362/362) green before branching. (A separately-requested `docs/readme-update` PR (#14) was opened in this same session, outside the phase sequence, and had not yet merged when this phase branched — it touches only `README.md`, nothing Phase L depends on.)

## Architecture

**`deploy/openshift/`** — five manifests plus a `kustomization.yaml` for one-command apply (`oc apply -k deploy/openshift/ -n <namespace>`):

- **`serviceaccount.yaml`**: `log-explorer` ServiceAccount, no RBAC role bound by default, `automountServiceAccountToken: false` — the app's primary path (calling the Loki gateway over HTTPS with its own configured bearer token) makes no Kubernetes/OpenShift API call at all, so no permission and not even a mounted token is needed for it.
- **`configmap.yaml`**: every non-secret `logexplorer.*` setting the OpenShift deployment shape needs, mirroring `.env.example`'s own names. `LOGEXPLORER_SOURCES_DISABLED=local-docker` — there is no Docker socket in a pod, and this deployment shape never attempts to mount one.
- **`deployment.yaml`**: `securityContext.runAsNonRoot: true` with **no pinned `runAsUser`** (letting the cluster's own SCC assign one — see "A real bug found" below for why this matters), `readOnlyRootFilesystem: true` with a bounded `emptyDir` at `/tmp` for the one path the JVM actually writes to, `allowPrivilegeEscalation: false`, every Linux capability dropped, resource requests/limits, readiness/liveness probes against the real `/actuator/health` endpoint, and the Loki bearer token sourced via `secretKeyRef` (`optional: true`).
- **`service.yaml`** / **`route.yaml`**: a `ClusterIP` Service and an OpenShift `Route` terminating TLS at the edge with an HTTP→HTTPS redirect policy.
- **`role-and-rolebinding.example.yaml`**: a documented-only, namespace-scoped `Role`/`RoleBinding` for the one legitimate optional scenario (a LokiStack gateway that authorizes via the caller's own bound SA token) — deliberately excluded from `kustomization.yaml`, never applied by default.

**`scripts/validate-openshift-manifests.sh`** (new): YAML-syntax check for every file under `deploy/`; a structural assertion that no `ClusterRole`/`ClusterRoleBinding` or committed `Secret` object exists anywhere under `deploy/`; a secret-shaped-literal heuristic scan (JWT/AWS-key/PEM-header patterns) as defense in depth; and real Kubernetes OpenAPI schema validation via `kubeconform` (pulled and run through Docker — no local `kubectl`/`oc`/`kubeconform` install needed), `-ignore-missing-schemas` so the one OpenShift-specific CRD (`Route`) is skipped rather than failing the run, while every standard Kubernetes resource here is validated for real.

**`docs/SECURITY_NOTES.md`** (new): the full security posture across both deployment shapes (portable Compose, OpenShift) in one place — masking, Docker/OpenShift read-only access, credentials, TLS, non-root, bounds — with pointers to the real tests/commands that verify each claim.

## A real bug found by actually running the Phase K image under OpenShift's real security model

**Symptom.** OpenShift's default `restricted` SCC always runs every container as an arbitrary, non-zero UID with GID `0` — regardless of what the image's own Dockerfile declares. Simulating that exactly (`docker run --user 1000660000:0 log-explorer:local`, against the real image Phase K built) crashed the container immediately: `su-exec: setgroups: Operation not permitted`. The application never started at all.

**Diagnosis.** `docker-entrypoint.sh` (built in Phase K specifically for aligning group membership with a Compose-mounted `/var/run/docker.sock`) unconditionally attempted its `addgroup`/`adduser`/`su-exec` sequence, which requires genuinely being root — an assumption that held for every scenario Phase K actually tested (plain `docker run`/`docker compose`, where the image's own build-time UID/GID applies unless overridden) but not for OpenShift's model, where the platform itself forces a non-root, unprivileged UID from the very first instruction, never granting real root at any point.

**Fix.** `docker-entrypoint.sh`: `if [ "$(id -u)" != "0" ]; then exec java -jar app.jar "$@"; fi` — added as the very first check. Docker discovery (the only reason the socket-alignment logic exists) is Compose-only and irrelevant under OpenShift anyway (`LOGEXPLORER_SOURCES_DISABLED=local-docker` in `configmap.yaml` reflects this explicitly), so skipping straight to running the JVM is correct there, and harmless for any other non-root invocation of the same image.

**Re-verified, both directions, for real:**
- OpenShift-style arbitrary UID (`docker run --user 1000660000:0 ...`): boots cleanly, `GET /actuator/health` → `{"status":"UP"}`, `/proc/1/status` shows `Uid: 1000660000` / `Gid: 0` / `Groups: 0` throughout — exactly OpenShift's real convention.
- Every Phase K Compose scenario re-run unchanged after the fix (`demo`, `docker-socket` with real container discovery, `scripts/smoke.sh`) — no regression: the fix only skips logic that never applied when the process wasn't genuinely root to begin with.

This is filed as a Phase L finding even though the affected file (`docker-entrypoint.sh`) is nominally a Phase K deliverable, per CLAUDE.md §5's "when an older requirement conflicts with a later decision, name the conflict explicitly and apply the later decision" — Phase K's own "one deployable image" premise only holds if the same image genuinely runs under Phase L's target platform too, which this phase's own real testing is what actually proved (and initially disproved, then fixed).

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase L":

1. **`deploy/openshift/`**: Deployment, Service, Route, ConfigMap, ServiceAccount — all five, all real, all schema-validated.
2. **Non-root**: portable to OpenShift's real arbitrary-UID SCC model, not just Docker Compose's — see the bug above.
3. **Read-only filesystem where practical**: `readOnlyRootFilesystem: true` with a bounded `emptyDir` for the JVM's one actual write path.
4. **Resource requests/limits; readiness/liveness probes**: present, against the real `/actuator/health` endpoint.
5. **Loki configuration via ConfigMap; token/credentials via Secret references only; no committed secret**: `configmap.yaml` + `secretKeyRef` in `deployment.yaml`, structurally enforced by `scripts/validate-openshift-manifests.sh`.
6. **No cluster-wide role binding; document (do not apply) the namespace-scoped role binding an administrator may choose to create**: `role-and-rolebinding.example.yaml`, excluded from `kustomization.yaml`.
7. **TLS verification enabled**: unchanged from Phase D (outbound, to Loki) + this phase's `Route` (`edge` termination, redirect policy, inbound).

## Automated tests

| Check | Command | Result | Notes |
|---|---|---|---|
| Backend suite (regression) | `./mvnw test` | **PASS** | 362/362, unchanged from Phase K's completion — this phase touches no backend Java source. |
| Manifest validation | `./scripts/validate-openshift-manifests.sh` | **PASS** | YAML-valid (7 files); no `ClusterRole`/`ClusterRoleBinding` anywhere under `deploy/`; no `Secret` object committed; no secret-shaped literal found; real kubeconform schema validation: `8 resources found in 7 files - Valid: 6, Invalid: 0, Errors: 0, Skipped: 2` (the 2 skips are `kustomization.yaml`, not a Kubernetes resource kind, and `route.yaml`, an OpenShift-specific CRD kubeconform's default catalog has no schema for — both expected, neither a gap in what *was* validated). |
| Non-root, real Docker default UID/GID | `docker exec ... cat /proc/1/status` (Phase K's own Compose scenarios, re-run) | PASS | Unchanged: `Groups: 101` (no socket), `Groups: 101 101 991` (`docker-socket` profile). |
| Non-root, real OpenShift-style arbitrary UID | `docker run --user 1000660000:0 ...` + `/proc/1/status` + `/actuator/health` | **PASS (after the fix; FAIL before it)** | The bug and fix above. |
| Full Compose regression after the entrypoint fix | `docker compose -f ... -f docker-compose.docker-socket.yml --profile demo --profile docker-socket up` + real container discovery via `local-docker` | PASS | Unchanged real end-to-end behavior from Phase K. |
| Deterministic smoke test (regression) | `./scripts/smoke.sh` | **PASS** | Unchanged from Phase K, re-run after the entrypoint fix from a cold `.env`-less state. |

## Manual/live checks

Per the plan: *"Applying to a real cluster is DEFERRED BY SCOPE unless a cluster is genuinely available."* No real OpenShift cluster is reachable from this environment — consistent with every prior phase's own documented boundary for live OpenShift verification (e.g. Phase D's Loki TLS tests ran against a local self-signed cert, never a live cluster). What *is* real and not deferred: the manifests' own schema correctness (real kubeconform validation against the actual Kubernetes OpenAPI schema, not assumed), the structural security guarantees (no ClusterRole, no committed Secret — enforced by an automated script, not a manual read-through), and — going beyond what the plan's own PASS criteria strictly required — a genuine, previously-undiscovered portability bug in the underlying image, found by actually simulating OpenShift's real security model with Docker rather than only inspecting YAML.

## Results

- **PASS**: all 7 Phase L scope items; real schema validation, real structural security checks, and a real (found-and-fixed) portability bug specific to this phase's own target platform.
- **FAIL**: none remaining.
- **BLOCKED**: none.
- **DEFERRED**: live cluster apply — no real OpenShift cluster reachable from this environment, exactly as the plan's own text allows ("DEFERRED BY SCOPE unless a cluster is genuinely available"). The exact RBAC resource/verb `role-and-rolebinding.example.yaml` documents is likewise explicitly caveated as an approximation, not verified against a real LokiStack gateway.

## Regression

Backend: 362/362, unchanged (no backend Java source touched this phase). Frontend/Playwright: unchanged (no frontend source touched this phase; not re-run, matching the plan's own "Regression: N/A beyond repo build" for this phase). Docker Compose (Phase K's own deliverables): fully re-verified after the entrypoint fix, zero regression.

## Security check for this phase

- **No cluster-wide RBAC, structurally enforced.** `scripts/validate-openshift-manifests.sh` scans for `ClusterRole`/`ClusterRoleBinding` and fails the run if either is ever added under `deploy/`.
- **No committed secret, structurally enforced.** Same script asserts no `kind: Secret` exists anywhere under `deploy/`, plus a secret-shaped-literal heuristic scan.
- **Least privilege by default.** The ServiceAccount has no RBAC bound and doesn't even automount its own token unless an administrator opts into the one documented, namespace-scoped, non-default exception.
- **Non-root on the actual target platform, not just assumed.** See "A real bug found" above — this is the substantive security finding of this phase.
- **TLS**: unchanged from Phase D outbound; `edge`-terminated + redirect-enforced inbound via the new `Route`.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 95–97 → **Done**.

## Known gaps carried forward

- Live cluster apply remains DEFERRED — no real OpenShift cluster reachable from this environment.
- Resource `requests`/`limits` are conservative starting defaults, not load-tested or tuned against real traffic.
- The optional RBAC example's exact resource/verb is an honest approximation, not verified against a real LokiStack gateway (documented as such in the file itself).
- The `docs/readme-update` PR (#14), opened outside this phase's own sequence per an explicit user request, remains open — unrelated to Phase L's own scope (touches only `README.md`).
