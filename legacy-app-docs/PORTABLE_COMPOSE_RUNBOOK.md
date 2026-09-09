# Portable Compose Deployment Runbook

Log Explorer can run as a single self-contained Docker image. The frontend is
bundled inside the backend JAR (served from `/`), so the whole application ships
in one container that mounts the local Docker socket. This runbook covers
building, distributing and running the portable stack.

## What ships where

| File | Purpose |
|------|---------|
| `compose.yaml` | Runtime-only deployment (image reference, port, socket, healthcheck). No build context. |
| `compose.build.yaml` | Local build-definition overlay (merged with `compose.yaml` via `-f`). |
| `Dockerfile` | Multi-stage build: Node build stage (`npm ci` + `npm run build`) -> Maven stage (bundles `frontend/dist`) -> JRE runtime (non-root). |
| `.dockerignore` | Build-context hygiene (excludes source, caches, logs, `.env*`). |
| `.env.example` | Every variable with defaults; no secrets. |
| `scripts/*.sh`, `scripts/*.ps1` | Helper scripts for build / save / load / run / stop. |

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `IMAGE_TAG` | `1.0.0` | Image tag for `logexplorer/runtime` and the compose reference. |
| `UI_PORT` | `5050` | Host port mapped to the app's internal 5050. **Change it if 5050 is already in use on the host.** |
| `SPRING_PROFILES_ACTIVE` | `prod` | Runtime profile. |
| `LOGEXPLORER_DOCKER_ENABLED` | `true` | Enables the Docker compose source. |
| `DOCKER_HOST` | `unix:///var/run/docker.sock` | Local Docker endpoint used by the app. |
| `LOGEXPLORER_DOCKER_PROJECT_FILTER` | *(empty)* | Empty = all Compose projects are discoverable. |
| `LOGEXPLORER_DOCKER_EXCLUSION_LABEL_KEY` | `logexplorer.excluded` | Label that hides Log Explorer's own containers (and any other container). |
| `RESTART_POLICY` | `unless-stopped` | Compose restart policy. |
| `NPM_PROXY`, `NPM_HTTPS_PROXY`, `NPM_NO_PROXY` | *(empty = no proxy)* | **Build-only** npm proxy build-args, used when building behind a corporate proxy. Never baked into the image. |

Copy `.env.example` to `.env` and adjust before building or running.

## 1. Build from source

Requires Docker, and (to build the frontend stage) network access for `npm ci`,
plus Maven Central for the backend build. If the build host is behind a
corporate proxy, set the npm proxy build-args so the Node stage can download
packages:

```bash
# Linux / macOS
export IMAGE_TAG=1.0.0
export NPM_PROXY=http://proxy.example.com:8080
export NPM_HTTPS_PROXY=http://proxy.example.com:8080
scripts/build-image.sh
# or: docker compose -f compose.build.yaml build
```

```powershell
# Windows / PowerShell
$env:IMAGE_TAG='1.0.0'
$env:NPM_PROXY='http://proxy.example.com:8080'
$env:NPM_HTTPS_PROXY='http://proxy.example.com:8080'
.\scripts\build-image.ps1
# or: docker compose -f compose.build.yaml build
```

Produces `logexplorer/runtime:1.0.0`.

**Reproducibility:** the frontend is built inside the Docker Node stage using
`npm ci` from `frontend/package-lock.json` (Node v20.18.0). The Maven stage
uses the committed `backend/.mvn/settings.xml` (build-stage only) and skips the
frontend-maven-plugin (`-Pskip-frontend`) because the UI is already built. Base
images are pinned (`node:20.18.0-bookworm-slim`, `maven:3.9.9-eclipse-temurin-21`,
`eclipse-temurin:21-jre`) - no floating `latest` tags.

## 2. Export / import (offline distribution)

Developer/online machine:

```bash
scripts/save-image.sh                    # Linux -> log-explorer-runtime-1.0.0.tar
```
```powershell
.\scripts\save-image.ps1                 # Windows -> log-explorer-runtime-1.0.0.tar
```

Target/offline machine:

```bash
scripts/load-image.sh                    # docker image load -i <tar>
```
```powershell
.\scripts\load-image.ps1
```

The loaded tag is `logexplorer/runtime:<IMAGE_TAG>` and must match
`compose.yaml` exactly (both default to `1.0.0`). No source code, Maven, Node
or npm is needed on the target machine.

## 3. Run (runtime-only, no source code)

```bash
scripts/run-portable.sh                  # http://localhost:<UI_PORT>
```
```powershell
.\scripts\run-portable.ps1
```

Equivalent to `docker compose -f compose.yaml up -d`. To override the UI port:

```bash
UI_PORT=8080 scripts/run-portable.sh
```
```powershell
$env:UI_PORT='8080'; .\scripts\run-portable.ps1
```

Stop with `scripts/stop-portable.sh` / `scripts/stop-portable.ps1`
(`docker compose -f compose.yaml down`).

## 4. Health check and verification

```bash
curl -s http://localhost:<UI_PORT>/api/v1/sources/docker-compose/health
```

A healthy response reports `runtimeType=unix`, `transportType=unix`,
`daemonPing=true`. If the socket is missing/inaccessible the response reports
`status=PERMISSION_DENIED` (or `UNAVAILABLE`) with a `suggestedAction` - useful
for diagnosing a non-root container that cannot read the Docker socket.

```bash
curl -s http://localhost:<UI_PORT>/api/v1/sources/docker-compose/services
```

Returns the discovered Compose services. Log Explorer's own container is
hidden via the `logexplorer.excluded=true` label. Set
`LOGEXPLORER_DOCKER_PROJECT_FILTER` to restrict discovery to a specific Compose
project, or leave it empty to discover all projects on the machine.

## 5. Docker socket access and security notes

- The app connects to the **Unix socket** (`unix:///var/run/docker.sock`); no
  TCP port 2375 is required or exposed by the deployment. `docker compose
  config` for `compose.yaml` contains no `-p 2375` and the container publishes
  only `<UI_PORT>:5050`.
- The socket is mounted **read-only** (`/var/run/docker.sock:/var/run/docker.sock:ro`).
  **Read-only does NOT remove Docker API privilege**: a container mounting the
  socket can still control containers via the Docker API. Do not add
  capabilities/privileged mode; keep the container non-root and treat the host
  as shared with any process that can reach this container.
- The runtime runs as a **non-root `logexplorer` user (uid 1001)**. On a Linux
  host where the `docker` group permission is denied to that uid, grant the
  backend process access to the socket (e.g. add the uid to the `docker` group,
  or run the Daemon with an appropriate access model). The health endpoint
  communicates exactly this through `suggestedAction`.
- **Windows Docker Desktop (Linux containers)**: the socket path
  `/var/run/docker.sock` is provided by Docker Desktop for Linux containers.
  On some setups the non-root uid is refused; the health response makes the
  denial explicit (see above). For a locked-down host, verification can be run
  transiently with a root override - do not commit a root override to the
  runtime `compose.yaml`.

## 6. Config consistency and validation

```bash
docker compose -f compose.yaml config --quiet
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.yaml -f compose.build.yaml config --quiet
```

Both files resolve independently and merged. `compose.yaml` carries the health
check, `depends_on`-free single service, `restart: <RESTART_POLICY>` and bounded
log rotation (`max-size: 10m`, `max-file: 3`). Log Explorer keeps no required
persistent host state (it reads containers on demand), so no host volume beyond
the Docker socket is required.

## Platform notes / limitations

- Built for **linux/amd64** only; other architectures are unverified (not
  claimed).
- Helper bash scripts require a host where the `docker` CLI is the real client
  (Linux / WSL with Docker). The PowerShell scripts run against the Windows
  Docker client. Bash scripts are validated for syntax and documented for the
  Linux path.
- Host port `5050` is the default; if it is already in use by another process,
  set a different `UI_PORT`.
- A corporate proxy is needed to build (npm/Maven); runtime does not need it.
