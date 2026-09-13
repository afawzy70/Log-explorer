# REL-1 — Desktop Release Readiness (Local Reproducible Packaging, Windows + macOS)

**Branch:** `rel/1-desktop-release-readiness` (from `main`, base SHA
`1a0428294f1cdeac0ae91c7048907b10264d2ecc` — the OS-1G merge)
**Scope:** implements the long-tracked, never-previously-implemented
REL-1 addendum (`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §7b,
"Local Reproducible Desktop Packaging", approved after OS-1A review
recovery #2, registered during OS-1B). Packaging/release work only —
`PRODUCT_BEHAVIOR_CHANGED=NO`. Explicitly not a public release
(`MERGE_AUTHORIZED=NO`, no GitHub Release published), not Final Closure,
not the UI/UX redesign, not Phase M.

---

## 1. What existed before this pass

The Windows desktop package already existed and was CI-verified (Legacy
Remediation Slice 9, `docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md`;
hardened further by the "Windows Desktop CI/Toolchain Hardening" pass,
register §7c). But every step of that build — frontend build, embed into
backend static resources, backend jar, jlink runtime, launcher publish,
Inno Setup installer — lived **only** inside
`.github/workflows/windows-desktop.yml`'s own YAML. A developer cloning
the repository had no way to produce that same installer without GitHub
Actions; the register's own §7b addendum named this exact gap and
explicitly required it be registered, not implemented, until REL-1
itself. There was no macOS packaging path of any kind.

## 2. What this pass implements

### 2.1 Windows — extraction, not a rewrite

`scripts/build-desktop-windows.ps1` is the single repository-owned entry
point; every step is the exact same operation the CI workflow already
ran (verified byte-for-byte equivalent against the pre-existing
`windows-desktop.yml`, not redesigned), plus an explicit preflight
(Java 21, `jlink`/`jdeps`, Node, npm, the pinned .NET 8 SDK, Inno Setup)
that fails early with a named, actionable message instead of an opaque
downstream `MSB4181`/`NETSDK`/`ISCC` error. `.github/workflows/windows-desktop.yml`
now calls this one script (`-SkipPreflight`, since the job's own
`actions/setup-*` steps already provision everything the preflight
checks) rather than duplicating the steps in YAML. The bounded-retry
NuGet restore logic (the exact transient-failure-signature allowlist
from the prior Windows CI hardening pass) moved into the script itself,
so local and CI now share one literal contract — not two copies that
could drift (mission §8/§13).

### 2.2 macOS — a new packaging path, from a real audit

**Audit before design.** No macOS launcher/packaging code existed. The
existing Windows launcher (`desktop/launcher`, C#/WinForms) hosts the
product inside a native embedded WebView2 window — replicating that
exactly on macOS would mean a genuine Xcode/Swift/AppKit `WKWebView`
project, outside every toolchain this repository otherwise uses, and
unverifiable without direct access to macOS development tooling this
session does not have.

**Design decision (v1, documented, reversible):** `desktop/launcher-macos`
is a new, minimal, plain-Java module (Maven, zero dependencies beyond
the JDK — `java.desktop` for `SystemTray`/`Desktop`, `java.net.http` for
the health poll, `java.nio` for the single-instance file lock) that
mirrors the Windows launcher's exact lifecycle (single-instance lock →
port selection → start the bundled backend → bounded health poll → show
the app's "shell" → graceful shutdown on Quit) but opens the system
default browser to the running backend, with a menu-bar (`SystemTray`)
icon providing "Open Log Explorer" / "Quit Log Explorer", instead of an
embedded native window. Same product, same backend jar, same API, same
masking/security/capability semantics — only the desktop chrome differs.
Embedding a native `WKWebView` shell to match the Windows experience
exactly is recorded below (§9) as a `FUTURE_IMPROVEMENT`, not silently
dropped.

Why plain Java rather than, say, JavaFX WebView: zero new runtime
dependency to bundle (JavaFX is a large separate SDK), and because the
launcher itself running as a JVM process means it can reuse
`System.getProperty("java.home")` directly as the bundled custom
runtime's own location to spawn the backend — no separate "find the
bundled JRE" path-guessing the native Windows launcher needs.

`desktop/packaging-macos/build-runtime.sh` mirrors
`desktop/packaging/build-runtime.ps1` exactly (same `jdeps`-against-the-
extracted-jar module detection, same `jdk.crypto.ec` addition for
reflective TLS provider loading), with one macOS-specific addition:
`java.desktop` is always added, since the launcher itself (not just the
backend) runs on this one shared bundled runtime.

`scripts/build-desktop-macos.sh` is the single repository-owned macOS
entry point (frontend build → embed → backend jar → jlink runtime →
launcher Maven build → `jpackage --type dmg`), with the same preflight
discipline as Windows (Java 21, `jlink`/`jdeps`/`jpackage`, Maven, Node,
Xcode command-line tools). `.github/workflows/macos-desktop.yml` (new)
calls it on a real `macos-latest` GitHub Actions runner — real Apple
hardware/VM, not a simulation.

### 2.3 DEV_UNSIGNED_MODE / RELEASE_GRADE_MODE

`DEV_UNSIGNED_MODE` (default): no Apple credentials required or used —
matches this repository's own CI, which holds none. `RELEASE_GRADE_MODE`
(`--mode release`): requires `MACOS_SIGNING_IDENTITY` (a real keychain
identity) to already be present; **fails immediately and loudly** if it
is not, rather than silently falling back to an unsigned build under a
release-mode request. Notarization is attempted only if
`MACOS_NOTARIZE_APPLE_ID`/`MACOS_NOTARIZE_TEAM_ID`/`MACOS_NOTARIZE_PASSWORD`
are all set, and the script reports honestly (signed-but-not-notarized)
when they are absent — no signing or notarization success is ever
fabricated.

### 2.4 Versioning

`VERSION` (repository root, currently `0.1.0`) is the single
authoritative release/application version source for desktop artifacts.
Both scripts resolve it identically: an exact git tag on the current
commit (stripped of a leading `v`) takes precedence; otherwise
`VERSION`'s own content plus `-dev.<short-sha>`. This exactly preserves
the pre-existing Windows CI's own tag-based versioning convention while
replacing its previously-hardcoded `"0.0.0-dev"` fallback literal with
one shared file. `backend/pom.xml`'s `0.1.0-SNAPSHOT` and
`frontend/package.json`'s `0.1.0` are separate, pre-existing per-module
versions, deliberately not rewritten by this contract (documented in
`docs/development/BUILD_DESKTOP.md`).

### 2.5 SHA-256 checksums and artifact naming

Both scripts write a `.sha256` file alongside the produced artifact
(the pre-existing, never-implemented §7b requirement). Windows:
`desktop\build\installer\LogExplorer-<version>-windows-x64.exe[.sha256]`.
macOS: `desktop/build-macos/dmg/LogExplorer-<version>-macos-<arch>.dmg[.sha256]`.

---

## 3. Real verification — both platforms, real CI runners, not simulated

Every result below is from an actual GitHub Actions run on the real
`windows-latest`/`macos-latest` runner (Windows: `x86_64`; macOS: the
real runner's own architecture, `arm64`), triggered by pushing this
branch and opening PR #47 — never claimed from this (Linux) development
session directly, per the mission's own explicit "Never claim macOS
PASS from a non-macOS environment" instruction. This session has no
direct Windows or macOS access; the GitHub-hosted runners are the real
verification environment for both.

### 3.1 Windows (real `windows-latest` CI run)

```
Version: 0.1.0-dev.0c01b8b
=== Build the Windows installer (Inno Setup) ===
SHA-256: 4b719cd5c537d1c9738ca737b3837ce6d6d3332e7f3a01752bb971220d00c070
Backend jar (with embedded frontend): 48.2 MB
Bundled custom JRE (jlink): 49.9 MB
Windows installer (LogExplorer-0.1.0-dev.0c01b8b-windows-x64.exe): 120.2 MB
BUILD COMPLETE: D:\a\Log-explorer\Log-explorer\desktop\build\installer\LogExplorer-0.1.0-dev.0c01b8b-windows-x64.exe

--- packaged smoke test ---
Backend healthy on port 3434
UI shell loads
API call returned real source data
No orphan backend process - clean shutdown
Uninstall removed the installed application
PACKAGED WINDOWS SMOKE TEST PASSED
```

`WINDOWS_PACKAGE_BUILD=PASS`, `WINDOWS_PACKAGED_SMOKE=PASS`. Effective
.NET SDK confirmed `8.0.425` (an `8.0.x` SDK, governed by `global.json`
as required — the runner image also has 9/10.x SDKs installed,
confirming the pin is genuinely doing its job, not merely coincidentally
correct). Full run: <https://github.com/afawzy70/Log-explorer/actions/runs/34754473051>.

### 3.2 macOS (real `macos-latest` CI run)

```
=== Mode: dev ===
=== Package with jpackage (.app + .dmg) ===
Note: resolved version '0.1.0-dev.0c01b8b' has a major component of 0 ...
=== SHA-256 checksum ===
Checksum written to .../LogExplorer-0.1.0-dev.0c01b8b-macos-arm64.dmg.sha256
=== Packaging sizes ===
Backend jar (with embedded frontend): 49 MB
Bundled custom JRE (jlink): 54 MB
macOS disk image (LogExplorer-0.1.0-dev.0c01b8b-macos-arm64.dmg): 81 MB
BUILD COMPLETE: .../LogExplorer-0.1.0-dev.0c01b8b-macos-arm64.dmg

--- packaged smoke test ---
=== Mount the real generated DMG ===
=== Install (copy the .app out of the disk image...) ===
=== Launch the real installed application ===
Backend healthy on port 3434
UI shell loads
API call returned real source data
No orphan backend process - clean shutdown
App bundle removed
PACKAGED MACOS SMOKE TEST PASSED
```

`MACOS_PACKAGE_BUILD=PASS`, `MACOS_PACKAGED_SMOKE=PASS`. Full run:
<https://github.com/afawzy70/Log-explorer/actions/runs/34754473087>.

### 3.3 Two real defects found and fixed via these real CI runs (not fabricated as first-try-clean)

Both are macOS/`jpackage`/bash-on-macOS-specific findings that could not
have been discovered without a real macOS runner — exactly the reason
this mission required real CI evidence rather than accepting "the script
looks right":

1. **bash 3.2 empty-array expansion under `set -u`.** macOS ships bash
   3.2 as `/bin/bash` (Apple stopped updating it for licensing reasons)
   — `"${SIGN_ARGS[@]}"` for a legitimately-empty array (the normal
   `DEV_UNSIGNED_MODE` case) raises `unbound variable` under `set -u` in
   bash 3.2, though not in modern bash. Fixed with the standard
   bash-3.2-safe idiom: `"${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"}"`.
2. **jpackage's `--app-version` rejects a leading-zero major version.**
   This project's pre-1.0 `VERSION` (`0.1.0`) is rejected outright by
   jpackage's own internal bundle-metadata validation ("The first number
   in an app-version cannot be zero or negative"). Fixed by substituting
   a fixed `1.0.0` for jpackage's own internal `--app-version` metadata
   only when the real version's major component is 0 — the DMG filename
   and every other artifact-naming/logging path still use the real,
   correct `$VERSION` unchanged; this is jpackage's own bundle-metadata
   requirement, not a product versioning change.

Both fixes are committed as their own, separately-described commits on
this branch, each confirmed by a subsequent real, green CI run — not
squashed away or silently folded in.

### 3.4 macOS launcher lifecycle — additionally verified locally (Java is cross-platform)

Before the real macOS CI run, the plain-Java launcher's process-
management logic (single-instance file lock, port selection/fallback,
real backend process start via `ProcessBuilder`, bounded health-poll,
graceful shutdown hook) was run end-to-end on this session's own Linux
sandbox against a real, locally-built backend jar — legitimate
verification of the cross-platform Java logic itself (not the
macOS-specific `.app`/DMG packaging, which only the real CI run above
verifies). Confirmed via real backend log output: real Spring Boot
startup ("Started LogExplorerApplication in 6.663 seconds"), the
launcher's own port-file correctly recording `3434`, and a clean
graceful shutdown ("Commencing graceful shutdown... Graceful shutdown
complete") with no orphan process left behind on JVM exit.

---

## 4. Portability

Neither script's PRODUCT (the packaged app itself) requires Maven, Node,
a repository checkout, `oc`, or Docker (unless the Docker source is
explicitly selected by the user at runtime, same as every other Log
Explorer deployment) — the packaged artifact bundles its own custom
jlinked JRE and the fully-built backend jar with the frontend already
embedded as static resources. Confirmed by the packaged smoke tests
above: both ran the real installed/launched product on a clean runner
image with no repository checkout involved in the smoke-test step itself
(the smoke-test script only reads the produced installer/DMG and the
launcher's own logged output paths under the OS's per-user data
directory — never a repository-relative path).

## 5. Security

`SECRETS_IN_PACKAGE=NO`. Neither build script reads, embeds, or requires
any OpenShift/Sandbox/Docker/Loki/GitHub credential, signing secret, or
local developer path. Confirmed by direct source review: `scripts/build-desktop-windows.ps1`
and `scripts/build-desktop-macos.sh` reference only `VERSION`, the
frontend/backend build outputs, and (macOS `RELEASE_GRADE_MODE` only,
never exercised in this repository's own CI) an already-present keychain
identity name — never a token, password, or key material read into a
variable, logged, or written into the packaged artifact. The packaged
application itself ships no `.env`, no test fixtures, and no repository
source beyond the compiled jar/launcher/runtime — confirmed by the
`jpackage --input`/Inno Setup `[Files]` sections both listing an
exhaustive, explicit file set (launcher publish output, jlink runtime,
one named backend jar — nothing else).

## 6. CI / release workflow

Both `.github/workflows/windows-desktop.yml` and the new
`.github/workflows/macos-desktop.yml` orchestrate only: platform
toolchain setup (`actions/setup-java`, `actions/setup-node`,
`actions/setup-dotnet`/Inno Setup for Windows), then exactly one call to
the repository-owned build script, then the repository-owned packaged
smoke-test script, then artifact upload. No packaging step is
implemented twice. `windows-latest` builds Windows; `macos-latest`
builds macOS — no cross-build attempted anywhere. **No public release
was published or attempted this pass** — GitHub Releases publication
(§7's own pre-existing, separate requirement) remains explicitly
deferred; this pass produces CI artifacts only (`retention-days: 14`),
matching the mission's own "Do NOT publish a public release unless
explicitly authorized."

## 7. Windows reproducibility contract — preserved, not weakened

Re-verified via the real CI run above: `global.json` pin (effective SDK
`8.0.425`, an `8.0.x` SDK, confirmed against a runner image that also
has 9.x/10.x installed), `packages.lock.json` + `--locked-mode` restore
(unchanged), the exact WebView2 version pin (unchanged, not touched),
`dotnet publish --no-restore` (unchanged), the bounded-retry allowlist
(moved into the script, not weakened — same patterns, same max-2-attempts
bound). Local and CI now provably share one contract (§2.1), which is a
strengthening of, not a deviation from, mission §8's requirement.

## 8. Regression — no other source changed

```
$ git diff --stat main -- backend/src/main/java frontend/src
(empty except backend/pom.xml and frontend/package.json untouched -
 no product source file changed)
```

Full local regression (Linux, this session) before pushing:
`BACKEND_TESTS=PASS`, `FRONTEND_TESTS=PASS` (801/801),
`TYPECHECK=PASS`, `PRODUCTION_BUILD=PASS`, `E2E_TESTS=PASS` (294/294).
One flaky timing-based test (`TextRedactorPerformanceTest`, a
system-load-sensitive 3000ms ceiling, briefly measured at 3037ms under
this session's own heavy concurrent build load) was confirmed non-
reproducible by re-running it in isolation (1204ms) and by a subsequent
full clean re-run of the whole backend suite — not a real regression,
not silently ignored. Fresh PR CI (real GitHub Actions, not local):
`CI=PASS` (Backend/Frontend/E2E), `WINDOWS_CI=PASS`, `MACOS_CI=PASS`.

`TEST-INFRA-1`'s known PNG-churn side effect of running the full E2E
suite was restored to the committed state before every push
(`UNRELATED_BINARY_CHANGES=0`).

## 9. Remaining, explicitly deferred (not silently dropped)

- **Native macOS embedded web view** (matching the Windows WebView2
  experience exactly, rather than opening the system browser) —
  `FUTURE_IMPROVEMENT`. Would require a genuine Xcode/Swift/AppKit
  `WKWebView` project, outside this repository's existing toolchain, and
  is not required for a functionally-equivalent v1 (same product, same
  backend, same API — only the desktop chrome differs).
- **A proper macOS app icon** (`.icns`) — the launcher currently ships
  with a simple programmatically-drawn tray icon (no external asset
  dependency for v1); converting `desktop/launcher/Resources/app.ico`
  into a real multi-resolution `.icns` requires real macOS icon tooling
  (`iconutil`) to produce and verify correctly. `FUTURE_IMPROVEMENT`.
- **GitHub Releases publication** (§7's pre-existing, separate
  requirement — tag-triggered release with checksummed assets) —
  explicitly out of this pass's scope per the mission's own "Do NOT
  publish a public release unless explicitly authorized"; the CI
  workflows here produce artifacts only.
- **RELEASE_GRADE_MODE, exercised for real** — this repository's CI
  holds no Apple signing credentials, so `RELEASE_GRADE_MODE` was
  verified only by code review and its own fail-fast behavior when
  credentials are absent (confirmed: it does fail, loudly, rather than
  silently building unsigned) — not exercised end-to-end with a real
  signing identity. Requires the owner's own Apple Developer credentials
  to verify for real, whenever that becomes available.
- **Windows/macOS port-collision and existing-instance-second-launch
  paths** — carried forward, unresolved, from Slice 9 (register §7a):
  still only design + code review, not CI-exercised, for both
  platforms now (the macOS launcher's own single-instance/second-launch
  path mirrors this same limitation).

None of the above blocks this pass's own scope (local reproducible
packaging + CI evidence); all are named explicitly rather than
discovered later as a silent gap.

## 10. Documentation

- `docs/development/BUILD_DESKTOP.md` (new) — prerequisites, build,
  output, verification, versioning, clean rebuild, common failures
  (including both real defects found in §3.3), and artifact
  verification, for both platforms.
- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — §7b updated from
  `APPROVED_PENDING` (not started) to implemented, with real evidence;
  new narrative closing paragraph.
- This report.

`DOCUMENTATION_AUDIT=PASS`, `REQUIREMENTS_REGISTER_UPDATED=YES`,
`VERIFICATION_REPORT_UPDATED=YES`, `DOCUMENTATION_CODE_CONSISTENCY=PASS`
(every path/command named in the documentation above was independently
confirmed to exist and behave as described, via the real CI runs cited).
`UNTRACKED_OWNER_REQUIREMENTS=0`.

## 11. Scope boundary (explicitly not touched)

Final Closure, branch cleanup / functional baseline freeze, English/
Arabic user guides, Quick Start, Capability Matrix, Troubleshooting
Guide, UI/UX redesign, Phase M. No OpenShift/Loki/Docker/Fixture source
behavior touched — `git diff --stat main -- backend/src/main/java
frontend/src` is empty. `openshift-loki` and the OS-1G decision (§12p)
untouched.
