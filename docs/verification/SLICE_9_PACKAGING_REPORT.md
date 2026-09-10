# Slice 9 — Packaging Report

Legacy Remediation Slice 9: Packaging, Portability, Windows Desktop
Distribution, Cross-Platform Developer Experience & Final Delivery
Polish. Evidence for §L/§M/§N. All numbers below are from real command
output — hosted CI (`.github/workflows/windows-desktop.yml`, run
`34458449693`, `windows-latest`) for the Windows artifacts, and this
sandbox (Docker 29.7.2 / Compose v5.5.0) for the Docker artifact — never
invented.

## Docker image (§L)

Real build, from a clean checkout, on this session's own sandbox:

```
docker compose build
docker image inspect log-explorer:local --format='{{.Size}}'
```

| Metric | Value |
|---|---|
| Image size (uncompressed) | **156.0 MB** |
| Offline-export tarball (gzip) | **155 MB** (`docker save \| gzip`) |

Real round-trip verified (§O, capability matrix `PKG-03`): exported the
image, deleted the local copy, re-imported the tarball via
`scripts/import-image.sh`, confirmed `docker image inspect log-explorer:local`
succeeds again and the container starts and passes the full smoke test
(below).

### Docker smoke test (real, this sandbox)

```
./scripts/smoke.sh
```

```
=== Build ===
=== Start ===
=== Health ===
app is healthy
=== Source discovery ===
fixture source discovered
=== Search ===
search returned real fixture events
=== UI load ===
UI shell loads
=== SPA fallback never swallows /api or /actuator (Phase K's own PASS criterion) ===
SPA fallback correctly scoped

SMOKE TEST PASSED
```

Run against the new port model (container listens on 3434 internally,
host publish scoped to `127.0.0.1:3434`) — see
`LEGACY_REMEDIATION_SLICE_9_REPORT.md` for the full port-migration
rationale.

## Windows packaging (§H, §M)

Real numbers from the Windows Desktop CI job (`windows-latest`, run
`34458449693`, commit `94c3191`):

| Artifact | Size |
|---|---|
| Backend jar (with embedded frontend production build) | **48 MB** |
| Bundled custom JRE (jlink, module list detected from the real jar via `jdeps`) | **49.9 MB** |
| Windows installer (`LogExplorer-<version>-windows-x64.exe`) | **120 MB** |

jlink module set (detected, not hand-guessed — see
`desktop/packaging/build-runtime.ps1`'s own doc comment for exactly how
detection is done reliably against a Spring Boot repackaged jar's nested
`BOOT-INF/lib/*.jar` dependencies): the real jdeps-detected set, plus
`jdk.crypto.ec` (TLS cipher suites, loaded reflectively by JSSE — not a
static bytecode reference jdeps can see regardless of classpath
visibility, exactly the case jlink's own documentation names it for).

## Startup / readiness timing

| Metric | Status |
|---|---|
| Docker container `HEALTHCHECK` first-healthy time | **NOT_MEASURED precisely** — `scripts/smoke.sh` polls every 2s up to 30 attempts and the real run above reported healthy well inside that window, but the script does not print the exact elapsed time. `docker-compose.yml`'s own `HEALTHCHECK` uses `start_period: 20s`. |
| Windows launcher: process start → backend healthy | **~10-15s**, real measurement — the packaged smoke test's own log timestamps: launch at `08:59:54`, `Backend healthy on port 3434` reported at `09:00:04` (see the CI run's step log) — roughly 10 seconds end to end, well inside the 30s bounded timeout `BackendProcessManager.cs` enforces. |
| WebView2 window paint-to-usable time | **NOT_MEASURED** — no UI-automation harness verifies actual WebView2 rendering in this environment (see the Windows desktop report's own "remaining manual verification" section). |

No value above was invented — where a precise number wasn't reliably
obtainable from real tooling in this environment, it is marked
`NOT_MEASURED` rather than estimated (CLAUDE.md §3).

## Frontend delivery performance preservation (§N)

Verified the production build after every Slice 9 change is byte-identical
in shape to Slice 8's own bundle (no packaging step altered it):

```
dist/index.html                             0.39 kB │ gzip:  0.26 kB
dist/assets/JourneyEntryRow-mh5razt9.css    1.11 kB │ gzip:  0.44 kB
dist/assets/JourneyView-8TjrAEXg.css        1.84 kB │ gzip:  0.60 kB
dist/assets/LiveTailPanel-BAGwB39Y.css      2.34 kB │ gzip:  0.76 kB
dist/assets/index-JiOYIsqb.css             37.62 kB │ gzip:  6.14 kB
dist/assets/JourneyEntryRow-Co9QYvAc.js     1.74 kB │ gzip:  0.75 kB
dist/assets/JourneyView-Dasdf6VN.js         3.22 kB │ gzip:  1.33 kB
dist/assets/LiveTailPanel-BZS1ETh1.js       4.84 kB │ gzip:  1.89 kB
dist/assets/index-COjG9iHT.js             283.90 kB │ gzip: 85.49 kB
```

Identical to `docs/verification/SLICE_8_FRONTEND_PERFORMANCE_REPORT.md`'s
own "after" numbers — same chunk names, same sizes. Confirms:

- No dev-only code restored (production `npm run build` output, not
  `npm run dev`).
- No accidental source maps (none present in `dist/`).
- No test dependency bundled (the chunk list contains nothing from
  `vitest`/`@testing-library`/`playwright`/`jest-axe`).
- No duplicate React bundle (one `index-*.js` critical chunk, as before).
- `JourneyView`/`LiveTailPanel` still code-split exactly as Slice 8 left
  them.

## Packaging waste review

No obvious waste found that was worth sacrificing stability to remove:

- The 120 MB installer is dominated by the bundled JRE (49.9 MB) and the
  self-contained, single-file-published .NET launcher (which embeds the
  whole .NET runtime for a zero-dependency install) — both are
  deliberate trade-offs for "no Java/.NET/Node requirement for end
  users," not waste.
- The Docker image (156 MB) uses an Alpine JRE base and a multi-stage
  build that discards the JDK/Maven/Node build toolchain entirely from
  the final layer — already lean; not revisited further this slice.
