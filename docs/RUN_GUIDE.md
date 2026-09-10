# Run Guide — Log Explorer

IMPLEMENTATION_PLAN.md "Phase K" deliverable. Every command below was
actually run against this repository during Phase K's own verification
(see `docs/verification/PHASE_K_REPORT.md` for the full session log,
including two real bugs the exact commands here surfaced and how they
were fixed) — nothing here is aspirational.

## Requirements

- Docker Engine with Compose v2 (the `docker compose` subcommand, not the
  standalone `docker-compose` binary). Verified against Docker 29.7.2 /
  Compose v5.5.0; any reasonably current Compose v2 release should work
  the same way.
- Linux, macOS, or Windows (Docker Desktop) — the `docker compose`
  commands below are identical on every platform. Every script in
  `scripts/` has a native Windows PowerShell (`.ps1`) and Linux/macOS Bash
  (`.sh`) version (Legacy Remediation Slice 9 §W) — a Windows developer
  never needs WSL2/Git Bash/Cygwin for anything in this guide.
- No local Java or Node installation needed — the whole build happens
  inside the multi-stage `Dockerfile`.
- **Remote Docker TCP exposure is never required.** Nothing in this repo
  or this guide ever asks you to expose `HOST_IP:2375` or reconfigure your
  daemon or firewall to run Log Explorer (CLAUDE.md §4 "Remote Docker").

## Quick start (the default happy path — no host Docker access needed)

```bash
git clone <this repository>
cd Log-explorer
cp .env.example .env
docker compose --profile demo up --build
```

Then open <http://localhost:3434>. This starts two containers:

- **`app`** — the one deployable image (React build embedded as Spring
  Boot static resources, see `Dockerfile`). `SPRING_PROFILES_ACTIVE=dev`
  is `.env.example`'s own default, which enables the in-process **Fixture**
  source — deterministic, fully fake data, zero external dependency. This
  alone is enough to explore every feature except real Docker/Loki
  sources.
- **`demo-log-generator`** — a deterministic, fake-data Spring Boot JSON
  log feed (`tools/demo-log-generator`), started under the `demo` profile.
  It always emits to its own stdout/stderr (`docker compose logs
  demo-log-generator`), independent of everything else — it becomes
  visible *inside the app* (through the real `local-docker` source) only
  once the `docker-socket` profile below is also active.

`app` itself carries no `profiles:` tag — it always starts no matter which
`--profile` flags you pass, so `docker compose up --build` (no profile at
all) also works and gives you just the app on its own.

Stop everything: `docker compose --profile demo down` (or without
`--profile demo` if you started it without profiles — either form removes
every container/network Compose created for this project, nothing else).

## Real Docker container discovery (`docker-socket` profile)

To let the app's `local-docker` source discover, search, and live-tail
**real** containers on this host (including `demo-log-generator`'s own
container), layer the dedicated override file and add the
`docker-socket` profile:

```bash
docker compose -f docker-compose.yml -f docker-compose.docker-socket.yml \
  --profile demo --profile docker-socket up --build
```

Optionally scope discovery to just this stack's own containers (rather
than every Compose-managed container the host's Docker daemon can see —
e.g. unrelated projects on the same machine) by setting in `.env`:

```
LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=log-explorer
```

### Why a second file, not just a profile flag

Compose's `profiles:` key controls whether an entire *service* starts —
it has no way to conditionally attach an extra volume mount to the
*same*, already-defined `app` service depending on which flags were
passed. `docker-compose.docker-socket.yml` is Compose's real, documented
mechanism for that: layered on top with `-f`, it adds the socket mount to
the same `app` container, never a second competing one. See that file's
own header comment for the full reasoning, and
`docs/verification/PHASE_K_REPORT.md` for why this matters in practice
(this exact design is what makes "never mounted silently" true architecturally,
not just by convention).

### Docker socket privilege warning

**Read this before enabling `docker-socket` on a shared or untrusted
host.** The Docker Engine API is not scoped to "read-only" at the daemon
level. This codebase's own `ReadOnlyDockerClient` only ever issues
list/inspect/read-logs/follow-logs calls — never start, stop, create,
remove, or exec (CLAUDE.md §2 rule 8, enforced structurally — see
`ReadOnlyDockerClientMethodSetTest`) — but anything that can reach the
socket at all can still read the full configuration, environment
variables, image contents, and logs of **every** container on the host,
not just this stack's own. Mounting `:ro` (as this override file always
does) restricts filesystem-level operations on the socket *node itself*
(the container can't delete or replace it); it does **not** shrink what
the Docker Engine API itself allows a connected client to read. Only
enable this profile on a host, and for an audience, for whom that
visibility is acceptable.

The container image itself never becomes root because of this: it starts
as root only briefly, inside `docker-entrypoint.sh`, solely to align a
supplementary group with whatever GID the *host's* socket happens to have
(unpredictable per machine — cannot be baked into the image) before
dropping to the same non-root `logexplorer` user via `su-exec` and
exec'ing the JVM. The application process itself is non-root on every
profile, including this one — verified directly (`docker exec ... cat
/proc/1/status`), not assumed; see the report for the full story,
including two real bugs found while getting this working (a `su-exec
user:group` invocation that silently dropped supplementary groups, and a
blank-vs-null Compose-project-filter bug in the backend itself that
silently filtered out every real container).

## Offline OpenShift Loki demo (`loki-mock` profile)

```bash
docker compose --profile demo --profile loki-mock up --build
```

Then set in `.env` before starting (or restart `app` after setting it):

```
LOGEXPLORER_LOKI_BASE_URL=http://mock-loki:3100
```

`mock-loki` (`tools/mock-loki`) is a standalone stub serving the same
LokiStack gateway route shape a real cluster would
(`{gatewayPrefix}/{tenant}/loki/api/v1/query_range`), with a fixed,
deterministic fixture corpus anchored at `2026-01-01T00:00:00Z` — query
that window (e.g. `start=2026-01-01T00:00:00Z`,
`end=2026-01-01T01:00:00Z`) to see real results.

All three profiles combine freely — e.g.
`--profile demo --profile docker-socket --profile loki-mock` runs
everything at once (verified in `docs/verification/PHASE_K_REPORT.md`).

## Real OpenShift Loki (production)

Set, at minimum:

```
LOGEXPLORER_LOKI_BASE_URL=https://<your gateway route>
```

Every other `LOGEXPLORER_LOKI_*` variable in `.env.example` documents its
own real-cluster meaning (gateway prefix, tenant, label keys, namespace,
bearer token source, CA cert). TLS verification always stays on for Loki
— there is no trust-all option anywhere in this codebase (CLAUDE.md §2
rule 7); `LOGEXPLORER_LOKI_CA_CERT_PATH` only ever *adds* one more
trusted CA on top of the JVM's own default trust store. The bearer token
is never typed into `.env` directly — `LOGEXPLORER_LOKI_TOKEN_ENV_VAR`
names another environment variable that actually holds it (e.g. the
standard OpenShift/Kubernetes service-account token, injected by the
platform itself), or `LOGEXPLORER_LOKI_TOKEN_FILE_PATH` points at a
mounted file (e.g. the standard service-account token path). Applying
real OpenShift manifests is Phase L's job (`deploy/openshift/`, not yet
built at the time of writing) — this section only covers pointing the
same one image at a real gateway from outside a cluster.

## Remote Docker (optional, not required)

`LOGEXPLORER_DOCKER_MODE=REMOTE` plus `LOGEXPLORER_DOCKER_HOST` connects
to a Docker daemon on another machine instead of the local socket.
`LOGEXPLORER_DOCKER_PORT` defaults to `2375` and is always overridable.
TLS (`LOGEXPLORER_DOCKER_TLS=true` +
`LOGEXPLORER_DOCKER_TLS_CERT_PATH=<dir containing ca.pem/cert.pem/key.pem>`)
is an optional connection *mode*, never forced on, and never trust-all
when on (`DockerClientFactoryTest` covers both the off and on cases).
Portable Compose (this guide) is the primary, recommended deployment path
— remote Docker is an alternative for environments that specifically need
it, never a prerequisite.

## Ports

| Variable | Default | What |
|---|---|---|
| `APP_PORT` | `3434` | The app's own HTTP port, published on `127.0.0.1` only (host-side mapping; the container itself always listens on 3434 - see `docker-compose.yml`). |
| `MOCK_LOKI_PORT` | `3100` | The `loki-mock` profile's stub server (host-side mapping). |

`demo-log-generator` publishes no ports — it only ever emits to its own
stdout/stderr.

## Environment variables

Full reference with defaults and explanations: `.env.example` (copy it to
`.env` and edit only what you need to change — every value there already
matches the backend's own built-in defaults).

## Health checks and startup ordering

`app`'s own `HEALTHCHECK` (`Dockerfile`) polls `GET /actuator/health`
every 10s (3s timeout, 20s start period, 6 retries) — `docker compose ps`
and `docker inspect --format='{{.State.Health.Status}}' <container>` both
report it. `demo-log-generator` and `mock-loki` have no meaningful
"ready" state beyond "the process started" (a log generator and a stub
HTTP server respectively) — Compose starts them immediately, no explicit
`depends_on` ordering is needed since nothing in this stack requires them
to be ready before `app` itself boots (their absence just means the
`local-docker`/`openshift-loki` sources report themselves honestly
unavailable until whichever profile that supplies them is active).

## Volumes and network requirements

- **`docker-socket` profile only**: `/var/run/docker.sock` bind-mounted
  **read-only** into `app` — see the privilege warning above. No other
  profile or the base stack ever mounts it.
- No other host volumes are used anywhere in this stack.
- All three services share one Compose-managed bridge network
  (`log-explorer_default`); `app` reaches `mock-loki` at
  `http://mock-loki:3100` by Compose's own DNS, matching
  `LOGEXPLORER_LOKI_BASE_URL`'s documented value above.
- Outbound internet access is needed only at **build** time (pulling base
  images and npm/Maven dependencies) — the running stack itself makes no
  outbound calls beyond what you explicitly configure (a real Loki
  gateway, a remote Docker host).

## Deterministic smoke test

Windows PowerShell:

```powershell
.\scripts\smoke.ps1
```

Linux / macOS:

```bash
./scripts/smoke.sh
```

Build → start → health → source discovery → search → UI load → SPA-
fallback-scope check → stop → cleanup, all against the `demo` profile
(the default happy path — no `docker-socket`/`loki-mock` dependency, so
this script alone is a fair fresh-clone rehearsal). Cleanup is always
**limited to this stack** (`docker compose ... down`, run from a trap/
`finally` block so it fires even on failure) — never a global prune,
never touches an unrelated container or image on the host. Exits
non-zero with a labeled `FAIL:` line naming the failing step if anything
doesn't match.

## Offline export/import (no registry access)

For moving the built image to a machine with no registry access at all
(Legacy Remediation Slice 9 §O, capability matrix `PKG-03`):

Windows PowerShell:

```powershell
.\scripts\export-image.ps1            # -> log-explorer.tar.gz
# on the target machine:
.\scripts\import-image.ps1 log-explorer.tar.gz
```

Linux / macOS:

```bash
./scripts/export-image.sh             # -> log-explorer.tar.gz
# on the target machine:
./scripts/import-image.sh log-explorer.tar.gz
```

Only the image layers are included — never a `.env` file, never a
credential. `docker compose --profile demo up` (no `--build`, since the
image is already loaded) starts it exactly as the Quick Start above does.

## Troubleshooting

- **`app` never becomes healthy.** `docker compose logs app` — a real
  startup exception prints there. Most common real cause during this
  guide's own verification: a stale `.env` value the app can't parse
  (e.g. a malformed `Duration` string) — compare against `.env.example`'s
  exact formats (`10s`, `30m`, `7d`, etc., Spring's own `Duration`
  parsing).
- **`local-docker` source shows 0 services even with `docker-socket`
  active.** Confirm the override file is actually included (`-f
  docker-compose.yml -f docker-compose.docker-socket.yml`) *and* the
  `docker-socket` profile flag is passed — both are required together (see
  "Why a second file" above). Then check
  `LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER` isn't set to a project name
  that doesn't match `docker compose ps` output on your machine (leave it
  blank to see every Compose-managed container the daemon can reach).
- **`openshift-loki` search returns zero events against `loki-mock`.**
  The mock's fixture corpus is anchored at a fixed
  `2026-01-01T00:00:00Z`, not "now" — query that window (see "Offline
  OpenShift Loki demo" above), not a relative "last 1 day" range.
- **Port already in use.** Set `APP_PORT`/`MOCK_LOKI_PORT` in `.env` to a
  free port instead of guessing — Compose fails fast with a clear bind
  error otherwise.
- **A previous run's containers are still around.** `docker compose
  --profile demo --profile docker-socket --profile loki-mock down` (add
  whichever profiles you'd started with) removes exactly this stack's own
  containers/network — never a global prune.
