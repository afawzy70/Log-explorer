# Security Notes

`IMPLEMENTATION_PLAN.md` "Phase L" deliverable — the security posture of
this project's packaging/deployment surfaces. Two are containerized
(portable Docker Compose, `deploy/`, Phase K; OpenShift,
`deploy/openshift/`, this phase); three are local, non-containerized
packaging forms added afterward (standalone executable JAR, Windows
desktop, macOS desktop — see "Local packaging: standalone JAR and desktop
apps" below). All five run the identical backend/frontend code and share
the same masking, TLS-verification, and read-only-source-access
invariants described throughout this document. The container-specific
controls in "Non-root, and portable to OpenShift's arbitrary-UID model"
and "Read-only root filesystem, resource bounds, health probes" below are
specific to the two containerized shapes — there is no container, no
`securityContext`, and no Kubernetes SCC involved in the standalone JAR
or either desktop app, and this document does not claim otherwise. See
`CLAUDE.md` for the non-negotiable rules all five shapes are built to
satisfy. `docs/verification/PHASE_K_REPORT.md` /
`docs/verification/PHASE_L_REPORT.md` hold the real commands that
verified the two containerized shapes' claims below; the local packaging
forms are verified by `scripts/jar-packaged-smoke-test.sh`,
`desktop/packaging/packaged-smoke-test.ps1`
(`.github/workflows/windows-desktop.yml`), and
`desktop/packaging-macos/packaged-smoke-test.sh`
(`.github/workflows/macos-desktop.yml`).

## Sensitive-field masking

Five fields are treated as sensitive everywhere in this codebase: `cif`,
`UserName`, `CustomerId`, `deviceId`, `deviceIp`. They are masked
server-side at a single boundary (`core/mask/MaskingService.java`, applied
in `api/EventMapper.java`) before any `CanonicalLogEvent` becomes a
response DTO — there is exactly one place in the backend that constructs a
response body from a domain event, and masking happens there, not
scattered across controllers. Verified by `MaskingServiceTest` (19 tests)
and `SerializationLeakTest`, which proves masking is applied *before*
serialization, not just present somewhere in the pipeline.

Search values, bearer tokens, raw customer identifiers, and full log
events are never logged — `LogLeakTest`/`QueryLeakTest` capture real
Logback output across success, guardrail-violation, and unknown-source
paths and assert none of it leaks. A real leak was found and fixed in
Phase B: Reactor Netty's own wire-tracing logger dumps raw request/response
bytes (including search filter values) the moment its category reaches
`TRACE` — pinned to `INFO` explicitly in `application.yml`, independent of
whatever an operator later raises root logging to.

## Docker access — strictly read-only

`ReadOnlyDockerClient` (`source/docker/`) exposes exactly five operations —
list containers, inspect, read logs, follow logs, ping/version — and
nothing else. Every mutating Docker Engine API method
(start/stop/create/remove/exec) is structurally unreachable from this
codebase, not merely unused: nothing in `source/docker/` holds a reference
to the underlying `DockerClient` except through this facade.
`ReadOnlyDockerClientMethodSetTest` locks the facade's own method set so it
cannot silently grow an unsafe one later.

The Docker socket is **never mounted silently**. In the portable Compose
stack (`deploy/`, Phase K), it is only ever mounted — always read-only —
behind the explicit `docker-socket` Compose profile **plus** a separate
override file (`docker-compose.docker-socket.yml`) that must be passed
with `-f`; two independent explicit actions are required before it is ever
touched. See that file's own header and `docs/RUN_GUIDE.md`'s "Docker
socket privilege warning" for the important caveat that `:ro` restricts
filesystem operations on the socket node itself, not what the Docker
Engine API allows a connected client to read. **OpenShift deployments
never mount a Docker socket at all** — there is no such concept in a pod,
and `deploy/openshift/configmap.yaml` explicitly disables the
`local-docker` source (`LOGEXPLORER_SOURCES_DISABLED=local-docker`) so it
never even appears as an option.

## OpenShift access — strictly read-only, least privilege by default

The app's primary path (querying the Loki gateway) makes **no Kubernetes
or OpenShift API calls at all** — it only ever issues plain HTTPS requests
to the configured Loki gateway URL with its own bearer token. The
`ServiceAccount` (`deploy/openshift/serviceaccount.yaml`) therefore:

- Has **no RBAC role bound to it by default** — no Role, no
  ClusterRole, nothing.
- Does not even automount its own token (`automountServiceAccountToken:
  false`) — least privilege by default, since the primary path needs no
  Kubernetes API credential to present in the first place.

**No `ClusterRole`/`ClusterRoleBinding` exists anywhere in this repository
— and never will**, enforced structurally: `scripts/validate-openshift-manifests.sh`
scans every file under `deploy/` for exactly that and fails the build if
one is ever added.

One optional, **namespace-scoped only**, **documented-but-not-applied**
exception exists: `deploy/openshift/role-and-rolebinding.example.yaml`.
Some OpenShift Logging LokiStack gateway configurations authorize each
request via a `SubjectAccessReview` against the *caller's own* bearer
token rather than a separately-managed static credential — if your
cluster's Loki gateway works that way, an administrator may choose to
bind this ServiceAccount's own token to a narrow, namespace-scoped `Role`
instead of managing a separate Secret. This file is **not** part of
`kustomization.yaml`'s default resource list and is never applied
automatically — see its own header for the full explanation, including
the honest caveat that the exact resource/verb a given LokiStack gateway
checks varies by OpenShift Logging version and was not verified against a
real cluster in this session (no cluster was available — see "Deferred"
in `docs/verification/PHASE_L_REPORT.md`).

## Credentials — Secret references only, never committed

`deploy/openshift/deployment.yaml` reads the Loki bearer token from
`LOKI_BEARER_TOKEN`, sourced via `secretKeyRef` (`name:
log-explorer-loki-token`, `key: token`, `optional: true` — a mock or
no-auth gateway needs no token at all). **No `Secret` object is committed
anywhere in this repository** — an administrator creates it out of band,
e.g.:

```bash
oc create secret generic log-explorer-loki-token --from-literal=token=<real token>
```

`scripts/validate-openshift-manifests.sh` asserts structurally that no
`kind: Secret` ever appears anywhere under `deploy/` (a stronger guarantee
than scanning for secret-*shaped* values, though it does that too, as
defense in depth) and no secret-shaped literal (JWT, AWS-style key, PEM
private key header) appears anywhere in the directory.

The portable-Compose equivalent is `.env.example` / `.env` (Phase K):
names and harmless defaults only, tracked in `.gitignore`, and
`LOGEXPLORER_LOKI_TOKEN_ENV_VAR` there likewise names *another* variable
that would hold the real token, never a value itself.

## TLS — verification always on, never trust-all

`source/loki/LokiWebClientFactory.java` never disables certificate
verification; `LOGEXPLORER_LOKI_CA_CERT_PATH` /
`deploy/openshift/configmap.yaml`'s equivalent only ever *adds* one more
trusted CA on top of the JVM's own default trust store
(`CompositeX509TrustManager`) — it can never replace or bypass
verification. `LokiWebClientFactoryTest` proves this with a real TLS
handshake against a self-signed certificate: rejected with no
`caCertPath` set, accepted once added as an extra trusted CA, still
rejected with an *unrelated* CA configured (proving there is no accidental
trust-all fallback anywhere in the chain).

The `Route` (`deploy/openshift/route.yaml`) terminates TLS at the edge and
redirects any plain-HTTP request (`insecureEdgeTerminationPolicy:
Redirect`) — inbound traffic to the app is always HTTPS from outside the
cluster.

## Local packaging: standalone JAR and desktop apps

The standalone executable JAR (`scripts/build-jar.sh`,
`java -jar log-explorer-<version>.jar`), the Windows desktop app
(`desktop/launcher`), and the macOS desktop app (`desktop/launcher-macos`)
all run the identical backend as an ordinary local OS process under the
invoking user's own account — no container, no image, no Kubernetes
manifest, no cluster-level RBAC. Each of the invariants above still holds
exactly as described: server-side masking at the same single boundary,
the same read-only Docker/OpenShift access, the same never-trust-all TLS
verification for OpenShift/Loki, and no application database (sources are
still queried live; the only server-side persistence is the same
file-backed classification-rules/field-mapping store used by every
shape). What differs is the *boundary* around that process, not the
invariants inside it:

- **Loopback-local by default.** `SERVER_ADDRESS`/`SERVER_PORT` default to
  `127.0.0.1:3434` for all three — the same default used everywhere else
  in this project — so the listener is not reachable from another machine
  unless an operator explicitly overrides the bind address. This is the
  process's own boundary, not a container network namespace or a
  Kubernetes `Service`/`NetworkPolicy` (there is neither here).
- **No container-specific controls apply.** Non-root container
  enforcement, `readOnlyRootFilesystem`, Kubernetes `securityContext`, and
  SCC arbitrary-UID handling (see the next two sections) are properties of
  a container runtime that these three packaging forms do not use; this
  document does not claim any of them apply here.
- **Per-user local data directory**, never inside the installed
  application: the standalone JAR defaults `LOGEXPLORER_DATA_DIR` to a
  local `./data` directory beside the jar (overridable); the Windows
  desktop app writes under `%LOCALAPPDATA%\LogExplorer\`; the macOS
  desktop app writes under `~/Library/Application Support/LogExplorer/`.
  None of the three ever write inside the installed program directory or
  the `.app`/install bundle itself.
- **Verified for real, not assumed**: `scripts/jar-packaged-smoke-test.sh`
  runs the jar from a directory containing nothing but the jar itself and
  confirms no Node/Docker/external-file dependency; the Windows and macOS
  packaged smoke tests each install/launch the real packaged app, confirm
  the health/API/UI path works, confirm no orphaned backend process
  survives quitting, and confirm the per-user data directory behaves as
  described above.

## Non-root, and portable to OpenShift's arbitrary-UID model

**Applies to the two containerized shapes only** (Docker Compose,
OpenShift) — there is no image, container runtime, or UID/GID model to
speak of for the standalone JAR or either desktop app; each of those runs
as an ordinary local OS process under the invoking user's own account
(see "Local packaging: standalone JAR and desktop apps" below).

Both containerized shapes run the identical image (`Dockerfile`) as non-root.
Docker Compose (Phase K) verified this live via `docker exec ... cat
/proc/1/status`, never assumed from the Dockerfile alone. **This phase
found and fixed a real gap Phase K's own image had**: OpenShift's default
`restricted` SCC always runs every container as an arbitrary, non-zero
UID with GID `0`, regardless of what the image declares — confirmed
directly by running the real Phase K image with `docker run --user
1000660000:0 ...` (the same shape OpenShift actually uses), which
crashed immediately (`su-exec: setgroups: Operation not permitted`)
because `docker-entrypoint.sh`'s Docker-socket group-fixup logic assumed
it was genuinely root. Fixed: the entrypoint now runs the JVM directly,
skipping that Compose-only logic entirely, whenever it is not actually
root — re-verified booting cleanly and passing its health check under the
identical arbitrary-UID simulation afterward. `deploy/openshift/deployment.yaml`
deliberately never pins a `runAsUser` — letting the cluster's own SCC
assign it is the point.

## Read-only root filesystem, resource bounds, health probes

**Applies to OpenShift only** — this is a Kubernetes `securityContext`
control; the standalone JAR and desktop apps have no such concept and are
not claimed to have it.

`deploy/openshift/deployment.yaml`'s container `securityContext` sets
`readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, and
drops every Linux capability (`capabilities.drop: ["ALL"]`); the one
directory the JVM needs write access to (`/tmp`) is provided as a bounded
`emptyDir`, never the root filesystem itself. `resources.requests`/`limits`
and `readinessProbe`/`livenessProbe` (both against the real
`/actuator/health` endpoint already exposed by every deployment shape) are
set to conservative starting defaults — not load-tested or tuned against a
real cluster's traffic in this session, and should be revisited against
real usage.

## Bounded everywhere

No unbounded scans, arrays, buffers, or DOM rows anywhere (CLAUDE.md §4
"Bounds") — search results, live-tail server/client buffers, and query
time ranges are all config-driven, enforced ceilings
(`SearchGuardrailsProperties`, `LiveTailProperties`), not documentation.

## Event classification rules

- **Masking boundary preserved.** Rules run on canonical events after
  parsing/mapping; extracted values leave only through `api.EventMapper`
  via `core.mask.ExtractedValueRedactor`: credential headers
  (`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, API-key /
  token headers) redacted in header text and JSON, extraction definitions
  marked `sensitive` or with credential-like names never shown, this event's
  protected identifiers masked per the masking policy, then `TextRedactor`.
  Rule tests and pattern detection use the same redaction. The five protected
  identifier fields are not addressable as rule fields.
- **Regex safety.** User-authored expressions use RE2/J (linear time, no
  backtracking), compiled once at save/import/load; lookaround and
  backreferences are rejected, never run on `java.util.regex`. Patterns are
  bounded to 1,000 characters; rules, conditions, extractions, import size,
  samples, previews, and returned value lengths are all bounded
  (`core.classify.ClassificationLimits`).
- **Configuration, not data.** The rules file holds rule definitions only —
  never events, samples, or extracted values. Portable packs never include
  revisions, paths, credentials, or runtime data. Diagnostics log counts and
  reason codes only, never rule literals or event content.
- **Writable data directory.** Rules persist under `LOGEXPLORER_DATA_DIR`
  (`/app/data` in the image, owned by `logexplorer` and group 0 for OpenShift's
  arbitrary UID). On OpenShift the root filesystem stays read-only; only the
  `log-explorer-data` PersistentVolumeClaim at `/app/data` is writable.
- **Trust model.** Rule management follows the existing unauthenticated
  local-tool model of the other settings endpoints.
