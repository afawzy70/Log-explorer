# Security Notes

`IMPLEMENTATION_PLAN.md` "Phase L" deliverable — the security posture of
this project's two deployment shapes (portable Docker Compose, `deploy/`
Phase K; OpenShift, `deploy/openshift/`, this phase). See `CLAUDE.md` for
the non-negotiable rules both of these are built to satisfy, and
`docs/verification/PHASE_K_REPORT.md` / `docs/verification/PHASE_L_REPORT.md`
for the real commands that verified each claim below.

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

## Non-root, and portable to OpenShift's arbitrary-UID model

Both deployment shapes run the identical image (`Dockerfile`) as non-root.
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
