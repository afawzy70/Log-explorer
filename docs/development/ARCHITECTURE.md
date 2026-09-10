# Architecture

System overview, component maps, and every deployment shape. See
[`backend/README.md`](../../backend/README.md) and
[`frontend/README.md`](../../frontend/README.md) for the code-level
developer guides this document sits above, and
[`BACKEND_FRONTEND_INTEGRATION.md`](BACKEND_FRONTEND_INTEGRATION.md) for
the exact request/response flow through every layer.

## System overview

```mermaid
flowchart LR
    User(("Investigator")) --> React["React + TypeScript UI"]
    React <-->|"REST + SSE"| Spring["Spring Boot (WebFlux)"]
    Spring --> Mask["Masking boundary\n(structured + free-text redaction)"]
    Mask --> LogSource{{"LogSource abstraction"}}
    LogSource --> Docker["Docker adapter\n(read-only Docker Engine API)"]
    LogSource --> Loki["Loki adapter\n(OpenShift gateway, TLS verified)"]
    LogSource --> Fixture["Fixture adapter\n(synthetic, dev/test only)"]
```

Every response leaving `Spring` for `React` has already crossed exactly
one masking boundary — there is no code path from an adapter's raw event
to an HTTP response body that skips it. The frontend never redacts
anything itself; it only ever renders what the backend already decided is
safe to show.

## Backend component map

```mermaid
flowchart TD
    subgraph api["api/ - REST + SSE"]
        SourcesController
        SearchController
        LiveTailController
        DockerSettingsController
        GlobalExceptionHandler
    end
    subgraph core["core/ - source-agnostic logic"]
        Parse["parse/ - LogLineParser"]
        Mask["mask/ - MaskingService, TextRedactor"]
        Query["query/ - DSL lexer/parser/AST/evaluator"]
        Search["search/ - EventFilters, PageCursorCodec"]
        Guard["guard/ - concurrency/rate guardrails"]
        Model["model/ - CanonicalLogEvent"]
    end
    subgraph source["source/ - one package per adapter"]
        LogSource["LogSource interface + LogSourceRegistry"]
        DockerAdapter["docker/"]
        LokiAdapter["loki/"]
        FixtureAdapter["fixture/"]
    end

    api --> core
    core --> LogSource
    LogSource --> DockerAdapter
    LogSource --> LokiAdapter
    LogSource --> FixtureAdapter
```

Every controller depends on `LogSourceRegistry` (an interface-typed
collection), never a concrete adapter — enforced by `ArchitectureTest`
(ArchUnit), not just convention.

## Frontend component map

```mermaid
flowchart TD
    App["App.tsx\n(ShortcutRegistryProvider)"] --> Shell
    App --> Toolbar
    App --> ResultsPanel["ResultsPanel (eager)"]
    App --> JourneyView["JourneyView (lazy)"]
    App --> LiveTailPanel["LiveTailPanel (lazy)"]
    App --> EventInspector

    Shell --> DockerSettingsPanel
    Shell --> KeyboardShortcutsHelp
    Shell --> SourceHealthBadge

    Toolbar --> AdvancedFilters["AdvancedFilters (More Filters)"]
    Toolbar --> QueryBuilder

    App -->|"owns"| useSearchState["useSearchState\n(all application state)"]
    App -->|"owns"| useLiveTail["useLiveTail\n(Live connection state machine)"]
```

`useSearchState` is the one state owner almost every feature reads from
and calls into — there is no separate global store. `ResultsPanel` stays
eagerly bundled (the primary path); `JourneyView`/`LiveTailPanel` are
`React.lazy` since both are genuinely conditional and mutually exclusive
with it.

## Canonical data flow

```mermaid
sequenceDiagram
    participant U as Investigator
    participant R as React UI
    participant S as Spring Boot
    participant A as LogSource adapter
    U->>R: Search
    R->>S: POST /api/v1/logs/search
    S->>A: query (source-native where possible)
    A-->>S: raw source events
    S->>S: parse/normalize -> CanonicalLogEvent
    S->>S: mask (structured fields + free-text redaction)
    S-->>R: SearchResponseDto (masked)
    R->>R: render Results table / Inspector
```

The same shape (query → adapter → normalize → mask → DTO) is reused,
unchanged, for the `context` and `journey` endpoints — see the
integration doc for how each differs only in how the request is
constructed, not in this pipeline.

## Security boundaries

- **Masking boundary** (`core/mask/`): the one seam every response
  crosses; structurally cannot be bypassed (sensitive fields live in a
  nested `RawSensitiveFields` the DTO mapper never reads directly).
- **Docker read-only boundary** (`source/docker/ReadOnlyDockerClient`):
  the Docker client type itself only exposes list/inspect/read-logs/
  follow-logs methods — there is no method to call that would mutate
  anything, even by mistake.
- **Remote-Docker SSRF boundary** (`source/docker/security/`):
  default-deny for loopback/link-local/private-LAN/cloud-metadata
  addresses, explicit allowlist only.
- **Loki TLS boundary**: verification always on; a configured extra CA is
  additive, never a trust-all replacement.
- **Frontend persistence boundary**: exactly one `localStorage` call site
  (`tablePreferences.ts`), versioned and validated; everything else
  (queries, filters, results, credentials) never leaves memory. See
  `frontend/README.md`'s "Persistence rules".

## Deployment architecture

Three shapes, one backend, one frontend build:

```mermaid
flowchart TB
    subgraph docker["Docker / Docker Compose"]
        direction LR
        Host["Host: 127.0.0.1:3434"] --> Container["Container (0.0.0.0:3434 internally)"]
        Container --> AppJar1["app.jar\n(backend + embedded React build)"]
    end
    subgraph openshift["OpenShift"]
        direction LR
        Route/Service --> Pod["Pod (0.0.0.0:3434)"]
        Pod --> AppJar2["app.jar\n(same image)"]
    end
    subgraph windows["Windows desktop"]
        direction LR
        WebView2 --> Launcher["LogExplorerLauncher.exe"]
        Launcher --> AppJar3["app.jar\n(same backend, bundled JRE, 127.0.0.1:3434)"]
    end
```

The backend jar is identical across all three — packaging differs, the
application does not. See "Docker architecture" and "Windows desktop
architecture" below for what's specific to each.

### Docker architecture

`Dockerfile` is a three-stage build: Vite production build → Maven build
(embedding the Vite output as Spring Boot static resources) → a minimal
non-root JRE runtime image. `docker-entrypoint.sh` starts as root only to
align group membership with a bind-mounted `/var/run/docker.sock` (when
the `docker-socket` Compose profile is used) before dropping to a
non-root user via `su-exec` — the application process itself is never
root, on any profile, including under OpenShift's arbitrary-UID `restricted`
SCC (that entrypoint script detects it isn't genuinely root under that
model and skips the group-fixup logic entirely rather than crashing).

The container binds `0.0.0.0:3434` internally (`SERVER_ADDRESS=0.0.0.0`,
set explicitly in `docker-compose.yml`/`deploy/openshift/configmap.yaml`)
because it runs inside its own network namespace — the "never reachable
beyond the intended boundary" property from the application's own
`127.0.0.1` default is instead enforced one layer out: Compose's
host-side port publish is scoped to `127.0.0.1` (`docker-compose.yml`),
and OpenShift's actual boundary is its Service/any NetworkPolicy in front
of the Pod.

### Windows desktop architecture

```
LogExplorer.exe
  -> WinForms launcher (desktop/launcher)
     1. acquire single-instance ownership (named Mutex)
        - already held? signal the existing instance to activate its
          window (named EventWaitHandle), exit - never start a second backend
     2. select a port: 3434 if free, else an OS-assigned free loopback port
        (never a predictable range scan)
     3. start the bundled backend: <install-dir>\runtime\bin\java.exe
        -jar <install-dir>\app\log-explorer-backend.jar
        (SERVER_PORT=<selected port>; SERVER_ADDRESS is left at the
        application's own 127.0.0.1 default - this is a same-machine
        deployment, nothing else should ever reach it)
     4. poll GET /actuator/health, bounded (30s) - a clear failure dialog,
        never a blank window, if it never comes up
     5. open a WebView2 window navigated to http://127.0.0.1:<port>/
  -> on window close: kill the whole backend process tree, release the
     mutex - no orphaned java.exe
     (the backend is also assigned to a Windows Job Object configured
     with KILL_ON_JOB_CLOSE the moment it starts - the OS itself kills
     it if the launcher ever ends any other way, e.g. an external
     force-kill or a crash, not just on a graceful window close)
```

WebView2 embeds the OS's own installed Edge Chromium runtime rather than
bundling a separate browser engine (Electron was evaluated and rejected -
WebView2 is viable and is Microsoft's own recommended lightweight
embedding path, so the mission's "only use Electron if WebView2 isn't
viable" bar was never met). Navigation is restricted to the local
application origin — any other URL (an external link, a `target="_blank"`)
opens in the user's normal system browser instead of turning the shell
into a general browser; devtools are disabled in release builds.

Packaging: a custom `jlink` runtime (module list detected from the real
backend jar via `jdeps`, not hand-guessed) plus the self-contained,
single-file-published launcher are laid out side by side by an Inno Setup
script (`desktop/packaging/installer.iss`) into a per-user
(no-admin-required) installer,
`LogExplorer-<version>-windows-x64.exe`. Built and smoke-tested for real
on a Windows GitHub Actions runner
(`.github/workflows/windows-desktop.yml`) — see
[`docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md`](../verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md)
for the actual result. Per-user runtime data (backend logs, the WebView2
profile) lives under `%LOCALAPPDATA%\LogExplorer\`, never inside the
installed program directory.
