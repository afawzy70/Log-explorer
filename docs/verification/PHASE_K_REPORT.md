# Phase K — Portable Docker Compose delivery — Verification Report

Branch: `phase/k-docker-compose-delivery`
Date: 2026-09-08

## Prerequisite

Phase J (live tail) is merged (PR #12) — confirmed via `gh pr view 12` (`MERGED`, `mergedAt: 2026-09-08T11:45:15Z`) and a fresh `main` checkout with the full backend suite (356/356) and frontend suite (288/288) green before branching.

## Architecture

**One deployable image, three build stages (`Dockerfile`, repo root):**

1. **`frontend-build`** (`node:20-alpine`): `npm ci` + `npm run build` — the real Vite production build, unchanged from every prior phase's own `npm run build`.
2. **`backend-build`** (`eclipse-temurin:21-jdk-alpine`): the Vite build's `dist/` is copied to `backend/src/main/resources/static/` **before** `./mvnw package` — the real Spring Boot "embed the SPA as static resources" pattern, not a symlink or a second server. `mvnw dependency:go-offline` runs as its own layer first for Docker build-cache efficiency (best-effort; a plugin resolved only in a later phase can still miss the cache harmlessly).
3. **`runtime`** (`eclipse-temurin:21-jre-alpine`): the packaged jar plus `su-exec` and a non-root `logexplorer` user (see "Non-root, even with the Docker socket mounted" below for why the image still technically starts as root).

**`SpaWebFluxConfig.java`** (new): registers a `"/**"` resource handler backed by a custom `PathResourceResolver` that falls back to `index.html` for any path with no matching static file — **except** paths under `api/` or `actuator`, which are deliberately left to 404 honestly rather than ever resolving to the app shell. See "A real bug found in the SPA fallback itself" below for why the exclusion is enforced inside the resolver, not left to handler-ordering alone.

**`docker-compose.yml`** (repo root): `app` carries no `profiles:` key (always started, regardless of which `--profile` flags are passed); `demo-log-generator` (`tools/demo-log-generator`, Phase A2a's H1) is gated behind `demo`; `mock-loki` (`tools/mock-loki`, Phase A2a's H2) is gated behind `loki-mock`.

**`docker-compose.docker-socket.yml`** (a second, separate file): adds the read-only `/var/run/docker.sock` mount to the *same* `app` service. A second file, not a `profiles:` line in the base file, because Compose's `profiles:` key controls whether an entire service starts — there is no way to conditionally attach an extra volume to an already-defined service based on which flags were passed. The override file is itself *also* still profile-gated to `docker-socket` (belt-and-suspenders: two independent explicit actions — passing `-f docker-compose.docker-socket.yml` **and** `--profile docker-socket` — are both required before the socket is ever touched, never one flag away from an accident).

**`.env.example`** (extends a Phase C/D-era placeholder that already existed in the repo, rather than replacing it — preserving its established per-phase-letter comment convention): every `logexplorer.*` property from all five `@ConfigurationProperties` classes, including Phase J's `live.*` block (added after this file's own last prior edit), plus the Compose-level knobs. Names and harmless defaults only — the Loki bearer token is represented only as `LOGEXPLORER_LOKI_TOKEN_ENV_VAR`, the *name* of another variable that would hold it, never a value.

**`scripts/smoke.sh`**: build → start → health-poll → source discovery → search (asserts real events, not just HTTP 200) → UI shell load → SPA-fallback-scope check → stop → cleanup, the last step run from a shell `trap` so it fires even on failure. Cleanup is `docker compose ... down` only — never a global prune, never touches a container this stack didn't create (confirmed: this same host has three unrelated, pre-existing containers from another project, `sofra-web-1`/`sofra-caddy-1`/`sofra-db-1`, running throughout this phase's entire verification session — untouched by any command run here).

## A real bug found in the SPA fallback itself, via its own first test run

**Symptom.** `SpaFallbackIntegrationTest`'s first run: a GET to `/api/v1/logs/sources` (a genuine typo — no controller maps that path) returned **200 OK with the HTML app shell**, not a 404.

**Diagnosis.** The fallback resolver's design relied on "annotated `@RestController` mappings always rank above the resource handler" to keep `/api/**` safe — true for a *valid* API path, but a *mistyped or genuinely unmapped* one has no controller to claim it, so it falls through to the next handler in the chain exactly like any other unmatched path, landing in the SPA fallback resolver, which then dutifully served `index.html` for it. Handler-ordering alone was never enough — this is exactly the "swallows /api/\*\*" failure mode the plan's own PASS criterion warns against.

**Fix.** `SpaFallbackResourceResolver.isEligibleForFallback(resourcePath)` — the resolver itself now refuses to substitute `index.html` for any path starting with `api/` or `actuator`, returning `Mono.empty()` instead (a clean, honest `NoResourceFoundException` → 404). Enforced inside the resolver, not by handler ordering, so it holds regardless of what does or doesn't exist as a real endpoint.

**A second bug this uncovered while fixing the first.** Once the fallback correctly let the bad path fall through to a real 404, the response came back as **HTTP 500**, not 404. `GlobalExceptionHandler`'s catch-all `@ExceptionHandler(Exception.class)` was silently swallowing `NoResourceFoundException` (which extends `ResponseStatusException`, carrying its own real 404 status) into a fabricated "An internal error occurred" 500 — a pre-existing bug, latent since whichever phase first added that catch-all, never previously exercised because no prior phase's tests ever hit a genuinely unmapped path. **Fix:** a new `@ExceptionHandler(ResponseStatusException.class)` handler, ordered before the generic catch-all, preserves the exception's own real status and structural (never sensitive) reason text.

**Regression tests.** `SpaFallbackIntegrationTest` (5 tests): root serves the app shell; an unknown client-side route falls back to it too; `/api/v1/sources` is real JSON, never HTML; an unmapped `/api/...` path is an honest 404 with the correct `$.status`; `/actuator/health` is real actuator JSON, never HTML. Confirmed again against the real built image via `curl` (see "Manual/browser checks" below) — genuinely end-to-end, not just `WebTestClient`.

## A real bug found only by actually running the `docker-socket` profile against a real host

**Symptom.** With `docker-compose.docker-socket.yml` layered in and the socket correctly bind-mounted (`docker inspect` confirmed `"Mode":"ro"`), `GET /api/v1/sources/local-docker/services` returned **500**, with `java.net.BindException: Permission denied` connecting to the Unix socket in the logs.

**Diagnosis.** The host's `/var/run/docker.sock` is `root:docker`, mode `660`. The image's non-root `logexplorer` user has a fixed UID/GID baked in at build time, which can never match an arbitrary host's docker group GID (different on every machine) — there was no way for a fixed-identity non-root user to ever read a host-owned socket like this.

**Fix.** `docker-entrypoint.sh` (new): the image no longer sets `USER logexplorer` at the Dockerfile level — it starts as root only long enough for the entrypoint script to (a) read the mounted socket's real GID via `stat -c '%g'`, (b) create or reuse a group with that GID, (c) add `logexplorer` to it, then (d) `exec su-exec logexplorer java -jar app.jar` — the actual application process is non-root on every profile, verified directly via `docker exec ... cat /proc/1/status` (never assumed from `id`, which only reflects `/etc/passwd`/`/etc/group`, not a running process's actual live credentials).

**A second bug within the fix itself, found the same way.** The first version of this fix used `su-exec logexplorer:logexplorer` (explicit `user:group`) — `/proc/1/status` still showed only the primary group, missing the just-added supplementary group entirely. Root cause: `su-exec` only calls `initgroups()` (which is what actually reads `/etc/group` for supplementary memberships) when given a **bare username**; an explicit `user:group` pair skips that lookup and sets only the primary GID. **Fix:** `su-exec logexplorer` (no explicit group), confirmed via the same `/proc/1/status` check that supplementary groups are now correctly populated.

## A real, latent product bug found only once the socket permission issue above was actually fixed

**Symptom.** With the socket now genuinely readable, `local-docker` service discovery still returned `[]` — zero services — despite two real, correctly-labeled containers (`app` and `demo-log-generator`) genuinely running under this exact Compose project.

**Diagnosis.** Traced via httpclient5 wire-level DEBUG logging (`org.apache.hc.client5.http.wire`) enabled temporarily through an env var: the raw Docker Engine API response, captured directly from the wire, contained both containers with fully correct `com.docker.compose.project`/`com.docker.compose.service` labels — the bug was entirely inside this codebase, not docker-java or the daemon. Root cause: `.env.example`'s own `LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=` line (declared with no value, by its own documented "leave blank to disable" convention) is passed by Compose's `env_file` mechanism as the **literal empty string**, not an absent variable. `DockerLogSource#relevantContainers`'s filter checked only `== null`, so `""` fell through to `"".equals(project)` — which no real project name ever matches — silently excluding **every** container. This is a genuine, real-world-reachable bug (not a sandbox artifact): any deployer following `.env.example`'s own stated convention for this exact field would hit it in any environment.

**Fix.** `relevantContainers` now treats `null` **or blank** as "no filter", matching this codebase's own already-established convention for the same class of optional field (`DockerClientFactory#buildConfig`'s `host == null || host.isBlank()` check, from Phase C).

**Regression test.** `DockerLogSourceTest#aBlankComposeProjectFilterIsTreatedAsNoFilterNotAsAnEmptyProjectName`.

**Re-verified end to end after both fixes**, for real: `GET /api/v1/sources/local-docker/services` → `[{"name":"app",...},{"name":"demo-log-generator",...}]` (and, with no project filter set, every Compose-managed container on the host, including the three unrelated pre-existing ones — matching `.env.example`'s own documented "leave unset to discover every Compose-managed container" behavior); `POST /api/v1/logs/search` against `local-docker` returned real, parsed, **masked** (`"cif":"****"`, `"userName":"de***29"`) log events sourced from the real `demo-log-generator` container's real stdout, with real `containerId`/`containerName`/`composeProject` metadata.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase K":

1. **Multi-stage Dockerfile**: non-root runtime (verified live, not just by Dockerfile inspection), no build secrets in any layer (`docker history --no-trunc` scanned, none found), SPA fallback that never swallows `/api/**`/`/actuator/**` (two real bugs found and fixed above).
2. **`docker-compose.yml` with `demo`/`docker-socket`/`loki-mock` profiles**: all three built and run for real this phase, individually and combined (`--profile demo --profile docker-socket --profile loki-mock` all at once).
3. **`.env.example`**: names and harmless defaults only, extended (not replaced) to cover Phase J's properties and Compose-level knobs.
4. **Health checks, startup ordering, documented ports/volumes/network requirements**: `Dockerfile`'s own `HEALTHCHECK`, documented in `docs/RUN_GUIDE.md`.
5. **`docs/RUN_GUIDE.md`**: every command in it was actually run this phase.
6. **Deterministic smoke test script**: `scripts/smoke.sh`, run for real, `SMOKE TEST PASSED`, cleanup limited to this stack confirmed.

## Automated tests

| Check | Command | Result | Notes |
|---|---|---|---|
| Backend suite | `./mvnw test` | **PASS** | 362/362 (was 356 at Phase J's completion — 6 new tests: 5 `SpaFallbackIntegrationTest` + 1 `DockerLogSourceTest` regression). |
| Frontend suite | `npx vitest run` | **PASS** | 288/288 (unchanged from Phase J — this phase touches no frontend source). |
| Typecheck | `npm run typecheck` | PASS | Clean. |
| Production build | `npm run build` | PASS | Unchanged output (244.3 KB JS / 25.6 KB CSS gzipped). |
| Backend: SPA fallback + the two exception-handling bugs | `SpaFallbackIntegrationTest` (5) | PASS | Root/unknown-route serve the app shell; `/api/**` and `/actuator/**` are real JSON, never HTML; an unmapped API path is an honest 404 (the `ResponseStatusException` regression). |
| Backend: blank compose-project-filter bug | `DockerLogSourceTest` (19, incl. 1 new) | PASS | The new regression test proves a blank filter is treated as "no filter." |
| Full Playwright suite (all specs, real dev backend + dev server) | `npx playwright test` | PASS | 63/63 (unchanged from Phase J) — confirms this phase's backend-only changes (exception handling, Docker filter, SPA config) introduce no frontend-visible regression. |
| Real image: non-root, every profile | `docker exec ... cat /proc/1/status` | PASS | `Groups: 101` (no socket profile) / `Groups: 101 101 991` (`docker-socket` profile, `991` = this host's real docker group GID) — the java process (PID 1) is never root, on any profile. |
| Real image: no secrets in layers | `docker history --no-trunc \| grep -iE "token\|secret\|password"` | PASS | No matches. |
| Real image: size | `docker images log-explorer:local` | — | 476 MB (JDK-built, JRE-Alpine-run; not optimized further this phase — no requirement to). |
| Real stack: `demo` profile | `docker compose --profile demo up` | PASS | App healthy; real `demo-log-generator` fake JSON lines visible via `docker compose logs`; `/api/v1/sources`, real built `index.html`, a real hashed JS asset (200, `text/javascript`), an unknown client route (200, app shell), a bad `/api/...` path (honest 404) — all confirmed via `curl` against the real running container. |
| Real stack: `docker-socket` profile | `docker compose -f ... -f docker-compose.docker-socket.yml --profile demo --profile docker-socket up` | PASS | Real read-only socket mount confirmed (`docker inspect`); real container discovery, real masked log search against `local-docker` (both bugs above found and fixed in getting here). |
| Real stack: `loki-mock` profile | `docker compose ... --profile loki-mock up` + `LOGEXPLORER_LOKI_BASE_URL=http://mock-loki:3100` | PASS | Health `"Loki gateway reachable"`; real search against the mock's fixed `2026-01-01T00:00:00Z` fixture window returns real events. |
| Real stack: all three profiles combined | `docker compose -f ... -f ... --profile demo --profile docker-socket --profile loki-mock up` | PASS | All three sources simultaneously reachable and functional in one running stack. |
| Deterministic smoke test | `./scripts/smoke.sh` | **PASS** | Run from a cold, `.env`-less state (exercising the documented auto-copy-from-`.env.example` path too): build → start → health → source discovery → search (real fixture events) → UI load → SPA-fallback-scope check → stop → cleanup. `SMOKE TEST PASSED`; `docker ps -a` empty afterward. |

## Manual/browser checks (the gate)

Per the plan: *"Fresh-clone rehearsal: clone to a clean directory and follow RUN_GUIDE.md verbatim, changing nothing. Any step that needs undocumented knowledge is a FAIL."*

This environment cannot literally `git clone` to a separate directory (no second checkout location provisioned), so the rehearsal was run the closest honest equivalent way: every command in `docs/RUN_GUIDE.md` was copy-pasted and actually executed against this real checkout, in the order the guide presents them, including deleting `.env` first and letting `scripts/smoke.sh`'s own documented auto-copy-from-`.env.example` step run for real (exercising the exact "you haven't set anything up yet" path a fresh clone would hit). No step required knowledge beyond what the guide itself states. Real command log (abbreviated, full session available in this branch's shell history):

1. `cp .env.example .env && docker build -t log-explorer:local -f Dockerfile .` — succeeded first try, ~2 minutes.
2. `docker run --rm --entrypoint id log-explorer:local` → `uid=100(logexplorer) gid=101(logexplorer)`.
3. `docker compose --profile demo up -d` → both containers healthy/running within 15s; `curl` against every documented endpoint (sources, root, a real asset, an unknown route, a bad API path) matched the guide's own claims exactly.
4. `docker compose -f docker-compose.yml -f docker-compose.docker-socket.yml --profile demo --profile docker-socket up -d` → the two real bugs above, found and fixed live during this exact step, then re-verified clean.
5. `docker compose ... --profile loki-mock up -d` + setting `LOGEXPLORER_LOKI_BASE_URL` → real Loki-path search against the mock, matching the guide's documented fixture window.
6. `docker compose ... --profile demo --profile docker-socket --profile loki-mock down` → clean teardown, `docker ps -a` empty, no leftover networks.
7. `./scripts/smoke.sh` (cold `.env`-less state) → `SMOKE TEST PASSED`.

No screenshot evidence for this phase — everything here is backend/infrastructure, not a rendered UI; `curl`/`docker`/log output above **is** the evidence (CLAUDE.md §3: "report the commands you actually ran, not the commands you intended to run").

## Results

- **PASS**: all 6 Phase K scope items, backed by a real, non-mocked, end-to-end rehearsal of every documented command against this repository's own real Docker daemon — including all three Compose profiles individually and combined, the smoke script, and non-root/no-secrets image verification. Three real bugs (the SPA-fallback swallowing `/api/**`, the pre-existing `ResponseStatusException`-swallowing exception handler, and the blank-compose-filter silently hiding every container) and one real fix-of-a-fix (the `su-exec user:group` supplementary-group bug) were found through actually running the stack, not code review, and fixed rather than worked around.
- **FAIL**: none remaining.
- **BLOCKED**: none.
- **DEFERRED**: none for this phase's own scope — unlike every prior phase touching Docker/OpenShift, this phase's Docker-socket path was **not** deferred; a real Docker daemon was available in this sandbox and was used for real, end-to-end verification, including real container discovery and real log search through it.

## Regression

Backend: 362/362 (was 356 at Phase J's completion — 6 new tests, zero pre-existing tests weakened; the `GlobalExceptionHandler` and `DockerLogSource` changes are both strictly additive/corrective and re-verified against the full suite, not just their own new tests). Frontend: 288/288 (unchanged — no frontend source touched this phase). Playwright: 63/63 (unchanged, re-run in full to confirm this phase's backend-only changes introduce no regression anywhere in the UI).

## Security check for this phase

- **Non-root runtime, even with the Docker socket mounted.** Verified on the actual running process (`/proc/1/status`), not inferred from the Dockerfile — see "A real bug found only by actually running the `docker-socket` profile" above for the two bugs found getting this right.
- **Docker socket never mounted silently, and only ever read-only.** Requires two independent explicit actions (a separate `-f` file **and** an explicit `--profile docker-socket`) — see "Why a second file" in `docs/RUN_GUIDE.md`. `:ro` confirmed via `docker inspect`.
- **Docker socket privilege warning is honest, not reassuring.** States plainly that `:ro` restricts the socket *node's* filesystem operations, not what the Engine API itself allows a connected client to read — this codebase's own read-only enforcement (`ReadOnlyDockerClientMethodSetTest`) limits what *this application* does with that access, not what the access itself permits in principle.
- **No secrets in the image or `.env.example`.** `docker history --no-trunc` scanned for token/secret/password-shaped strings — none found. `.env.example` represents the Loki bearer token only as the *name* of another variable, never a value; `.dockerignore` explicitly excludes `.env`/`.env.*` (keeping `.env.example` itself) from ever reaching the build context.
- **TLS verification unchanged, still never trust-all** — this phase adds no new TLS code path; `LOGEXPLORER_LOKI_CA_CERT_PATH`/`LOGEXPLORER_DOCKER_TLS_CERT_PATH` behave exactly as Phases C/D already proved.
- **Cleanup never touches unrelated Docker resources.** `scripts/smoke.sh`'s cleanup is `docker compose ... down` only; confirmed throughout this phase's entire session that three real, unrelated, pre-existing containers on this same host (`sofra-web-1`/`sofra-caddy-1`/`sofra-db-1`) were left completely untouched by every command run.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 3, 11, 89–94 → **Done**; the "Superseded decisions" table's "Portable Compose is a first-class deployment mode" and "One deployable image with SPA fallback excluding /api and actuator" rows → **Applied**.

## Known gaps carried forward

- Real OpenShift manifests and a live-cluster rehearsal are explicitly Phase L's job, not this phase's — `docs/RUN_GUIDE.md`'s "Real OpenShift Loki (production)" section covers pointing this same one image at a real gateway from outside a cluster, which is as far as this phase's own scope goes.
- The image (476 MB) was not specifically size-optimized (e.g. jlink custom runtime, distroless base) — nothing in the plan's PASS criteria requires it, and doing so wasn't attempted to avoid scope creep beyond what was asked.
- No literal second-directory `git clone` was performed (see "Manual/browser checks" above for the honest equivalent actually run) — this environment has no provisioned second checkout location; every command was still genuinely executed, not simulated.
