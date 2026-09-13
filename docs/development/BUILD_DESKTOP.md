# Building the Log Explorer desktop package

This is the desktop packaging guide for developers who want to build a
native Windows or macOS package locally, from a clean checkout of this
repository. It does **not** describe how to run Log Explorer for
development (see the root `README.md` / `RUN_GUIDE.md` for that) - this
covers producing the native installer/disk image a non-developer end
user would actually install.

The desktop package is **not a different build of the product**. It is
the same single deployable artifact (React frontend embedded into the
Spring Boot backend's static resources, CLAUDE.md §1's "one deployable
image") plus a small native launcher shell around it, and a bundled,
custom-built Java runtime (via `jlink`) so end users need no
separately-installed Java. Same Search, same Docker/OpenShift/Loki
behavior, same masking/security/capability semantics - packaging changes
nothing about the product itself (`PRODUCT_BEHAVIOR_CHANGED=NO`).

**No cross-build support.** Windows builds on Windows only (the launcher
is a native WinForms/WebView2 application; the installer tool, Inno
Setup, is Windows-only). macOS builds on macOS only (`jpackage`'s
`.app`/`.dmg` output, and the DMG tooling itself, are macOS-only). There
is no "build the Windows installer from Linux/macOS" path, and none is
planned.

---

## Windows

### Prerequisites

- **Java 21** (a full JDK, e.g. Temurin - not a JRE-only distribution;
  `jlink`/`jdeps` must be on `PATH`)
- **Node.js** (see `.github/workflows/ci.yml` for the exact version CI
  uses)
- **.NET 8 SDK** - the repository root's `global.json` pins the exact
  SDK version (`8.0.100`, `rollForward: latestFeature`); install .NET 8
  even if a newer SDK is already present, `global.json` prevents the
  newer one from silently being used instead
- **Inno Setup 6** (`ISCC.exe`) - e.g. `choco install innosetup`, or
  <https://jrsoftware.org/isinfo.php>
- **Apache Maven wrapper** - already vendored at `backend/mvnw.cmd`, no
  separate Maven install needed

### Build

```powershell
.\scripts\build-desktop-windows.ps1
```

The script itself verifies every prerequisite above before doing any
work (clear, actionable failure messages - never a silent fallback or an
opaque failure three steps later). Useful flags:

```powershell
.\scripts\build-desktop-windows.ps1 -Version 1.2.3          # override the resolved version
.\scripts\build-desktop-windows.ps1 -SkipPreflight          # tooling already verified, skip the checks
.\scripts\build-desktop-windows.ps1 -SkipFrontendInstall    # node_modules already installed/current
```

### Output

```
desktop\build\installer\LogExplorer-<version>-windows-x64.exe
```

A per-user installer (no admin/UAC elevation needed) built with Inno
Setup (`desktop\packaging\installer.iss`).

### Verify (packaged smoke test)

```powershell
.\desktop\packaging\packaged-smoke-test.ps1 -InstallerPath desktop\build\installer\LogExplorer-<version>-windows-x64.exe
```

Installs the real generated installer, launches the real installed app,
waits for real backend health, verifies the UI loads and a real API call
succeeds, then closes the app, confirms no orphan `java.exe` process
survives, uninstalls, and confirms the install directory is removed.
This is exactly what `.github/workflows/windows-desktop.yml` runs on a
real `windows-latest` CI runner on every PR that touches `desktop/`,
`backend/`, or `frontend/`.

### Windows reproducibility contract

Preserved unchanged by this pass (REL-1 §8 - do not weaken any of these):

- `global.json` pins .NET SDK `8.0.100` (`rollForward: latestFeature`) -
  `dotnet --version` must resolve to `8.0.x`, never a preinstalled newer
  SDK shadowing the repository's own contract.
- `desktop/launcher/packages.lock.json` is committed; restore always runs
  `--locked-mode` (`RestorePackagesWithLockFile=true` in the `.csproj`).
  A lock/`.csproj` mismatch fails loudly - regenerate the lock file
  deliberately (without `--locked-mode`), review the diff, commit it as
  its own change. Never let a build silently re-lock.
- `Microsoft.Web.WebView2` is pinned to an exact version (no wildcard
  package references in the release/desktop path).
- `dotnet publish` always runs `--no-restore`, immediately after a
  separate, already-verified `dotnet restore` step - a restore failure
  is never masked by, or confused with, a publish-time failure.
- The NuGet restore's bounded retry (max 2 attempts) only retries a small
  explicit allowlist of transient network/feed failure signatures
  (timeouts, DNS failures, 502/503) - anything else (a real `NU1xxx`
  dependency error, an `MSB`-prefixed build error, a lock mismatch) fails
  immediately on the first attempt.
- **Local and CI use the exact same contract**: `scripts/build-desktop-windows.ps1`
  is the one place this logic lives; `.github/workflows/windows-desktop.yml`
  calls it, it does not duplicate it in YAML.

To intentionally update the pinned NuGet dependency graph: regenerate
`packages.lock.json` locally (`dotnet restore` **without**
`--locked-mode` inside `desktop/launcher/`), review the diff, and commit
it as its own explicit, reviewed change.

---

## macOS

### Prerequisites

- **Java 21** (a full JDK, e.g. Temurin - `jlink`/`jdeps`/`jpackage` must
  all be on `PATH`)
- **Apache Maven** (`mvn` on `PATH`) - builds the small
  `desktop/launcher-macos` module
- **Node.js** and **npm**
- **Xcode command-line tools** (`xcode-select --install`) - `jpackage`'s
  DMG generation and code-signing tooling on macOS depend on them
- `hdiutil` (ships with macOS)

### Build

```bash
./scripts/build-desktop-macos.sh
```

Runs in `DEV_UNSIGNED_MODE` by default - produces a working, **unsigned**
`.app`/`.dmg` with no Apple Developer account or signing credentials
required. macOS Gatekeeper will require an explicit right-click → Open
the first time a user runs an unsigned app; this is expected for a local
developer build, not a defect.

Useful flags:

```bash
./scripts/build-desktop-macos.sh --version 1.2.3
./scripts/build-desktop-macos.sh --skip-preflight
./scripts/build-desktop-macos.sh --skip-frontend-install
```

### Output

```
desktop/build-macos/dmg/LogExplorer-<version>-macos-<arch>.dmg
```

### DEV_UNSIGNED_MODE vs RELEASE_GRADE_MODE

| | `DEV_UNSIGNED_MODE` (default) | `RELEASE_GRADE_MODE` (`--mode release`) |
|---|---|---|
| Apple credentials required | No | Yes - `MACOS_SIGNING_IDENTITY` must already be a valid "Developer ID Application: ..." identity in the local keychain |
| Behavior if credentials are missing | N/A | **Fails loudly and immediately** - this script never silently falls back to an unsigned build under a release-mode request, and never fabricates a signing/notarization success it cannot back with a real result |
| Notarization | Not attempted | Attempted only if `MACOS_NOTARIZE_APPLE_ID` / `MACOS_NOTARIZE_TEAM_ID` / `MACOS_NOTARIZE_PASSWORD` are all set; otherwise the script reports honestly that the DMG is signed but **not** notarized - never claimed as notarized |
| Suitable for | Local development, this repository's own CI (no signing credentials exist there) | An actual release build, run by whoever holds the real Apple Developer credentials |

### Verify (packaged smoke test)

```bash
./desktop/packaging-macos/packaged-smoke-test.sh desktop/build-macos/dmg/LogExplorer-<version>-macos-<arch>.dmg
```

Mounts the real generated DMG, copies the real `.app` bundle out (a DMG
is drag-to-install; there is no separate silent-installer step to
invoke), launches the real app, waits for real backend health, verifies
the UI loads and a real API call succeeds, quits the app, confirms no
orphan backend `java` process survives, then removes the bundle (a macOS
app's "uninstall" is simply deleting the bundle - there is no separate
uninstaller). This is exactly what `.github/workflows/macos-desktop.yml`
runs on a real `macos-latest` CI runner.

### macOS launcher design (why it differs from Windows)

The Windows launcher (`desktop/launcher`, C#/WinForms) embeds the
product inside a native WebView2 application window. The macOS launcher
(`desktop/launcher-macos`, plain Java - zero dependencies beyond the
JDK) is a deliberate v1 design decision: it starts the same bundled
backend jar and opens the system's default browser to it, with a
menu-bar (`SystemTray`) icon providing "Open Log Explorer" and "Quit".
Same product, same backend, same API, same security/masking behavior -
only the desktop "chrome" differs. Full rationale in
`docs/verification/REL_1_DESKTOP_RELEASE_READINESS_REPORT.md` §9.
Embedding a native `WKWebView` shell (matching the Windows experience
exactly) is tracked there as a `FUTURE_IMPROVEMENT`, not silently
dropped.

---

## Versioning

**`VERSION`** (repository root, a single line, e.g. `0.1.0`) is the one
authoritative release/application version source for the desktop
artifacts (installer/DMG filenames, launcher/app version metadata).
Both `scripts/build-desktop-windows.ps1` and `scripts/build-desktop-macos.sh`
resolve the effective version with the identical algorithm:

1. If the current commit is exactly tagged (`git describe --tags
   --exact-match`), use that tag with any leading `v` stripped.
2. Otherwise, use `VERSION`'s own content with a `-dev.<short-sha>`
   suffix (e.g. `0.1.0-dev.a1b2c3d`).
3. An explicit `-Version`/`--version` argument overrides both.

This governs the **desktop artifact/release version** specifically, not
each module's own independent Maven/npm version
(`backend/pom.xml`'s `0.1.0-SNAPSHOT`, `frontend/package.json`'s
`0.1.0`) - those are separate, pre-existing per-module versions and are
not rewritten by this contract; keep them in sync with `VERSION`
manually when cutting a release, they are not read by the build scripts.

To cut a real release, tag the commit (`git tag v1.2.3`) before running
either build script - both will then use `1.2.3` verbatim, matching the
existing pre-REL-1 CI convention.

**macOS-only exception:** `jpackage`'s own `--app-version` rejects a
leading-zero major version outright ("The first number in an app-version
cannot be zero or negative") - unavoidable for this project's current
pre-1.0 versions (`0.1.0`). `scripts/build-desktop-macos.sh` substitutes
a fixed `1.0.0` for jpackage's own internal bundle-version metadata only
in that case; the DMG filename and every other artifact-naming/logging
path still use the real, correct version. This means a `v0.1.0`
release's macOS `.app`'s internal `CFBundleShortVersionString`/
`CFBundleVersion` will read `1.0.0`, not `0.1.0` - a `jpackage`
constraint, not a product versioning decision. Windows has no equivalent
constraint; its installer/assembly metadata shows the real version
exactly.

---

## Publisher / author metadata

Product identity is consistent across both platforms:

- **Product name:** Log Explorer
- **Publisher / author:** Ahmed Fawzy elrifaye (exact spelling/casing;
  no company suffix - this is an individual owner, not a registered
  organization)

**Windows:** `desktop/packaging/installer.iss`'s `MyAppPublisher` drives
both the installer's own displayed publisher and the Windows Add/Remove
Programs "Publisher" registry value Inno Setup writes for the uninstall
entry. `desktop/launcher/LogExplorerLauncher.csproj`'s `<Company>` is the
Win32 `FileVersionInfo` field Windows Explorer shows as "Company" in a
file's Properties > Details tab.

**macOS:** `jpackage --vendor` and `--copyright` are the two
jpackage-supported author/publisher fields for a macOS app bundle.
`--copyright` is written directly into the generated `Info.plist` as
`NSHumanReadableCopyright`, which Finder's "Get Info" panel displays -
the most user-visible attribution macOS packaging truthfully supports
without a real Apple Developer Team identity (this project has none, and
does not fabricate one).

**Important:** none of the above is code-signing identity. An unsigned
build shows this metadata but is NOT digitally verified by Windows
SmartScreen or macOS Gatekeeper - those require a real, paid signing
certificate/Apple Developer account, which this project does not have.
See `RELEASE_GRADE_MODE` above for the (currently unexercised) signed
path.

## Application icon status

**No official Log Explorer product mark/logo exists in this repository**
as of this writing (audited: no SVG/PNG logo in `frontend/`, no
favicon, no brand asset directory - only a small, generic 32x32
placeholder icon at `desktop/launcher/Resources/app.ico`, already in use
by the Windows launcher, but not a distinctive designed mark). Per this
project's own anti-fabrication discipline, no new "official" icon was
invented for this pass - the existing placeholder continues to be used
on Windows, and macOS packaging uses `jpackage`'s own default icon.
`CANONICAL_ICON_SOURCE=MISSING`. Replacing this with real, owner-supplied
or owner-approved artwork (a proper multi-resolution `.ico`/`.icns`) is
tracked as a `FUTURE_IMPROVEMENT`, not silently skipped.

---

## Publishing a future release (automated)

`v0.1.0` was published manually (the first release; see
`docs/verification/RELEASE_V0_1_0_REPORT.md`). Every release **after**
`v0.1.0` is published automatically by
`.github/workflows/release.yml` — full detail in
`docs/verification/AUTOMATED_RELEASE_PIPELINE_REPORT.md`. The process:

1. Update the root `VERSION` file to the new version (e.g. `0.2.0`).
2. Optionally edit `docs/release-notes/NEXT_RELEASE.md` with a short,
   user-facing description of what changed.
3. Merge that change to `main` normally (PR, green CI).
4. Tag the merge commit exactly matching `VERSION`: `git tag -a v0.2.0
   -m "..."`.
5. Push the tag: `git push origin v0.2.0`.
6. GitHub Actions takes over from here — no manual build or upload step:
   a strict gate confirms the tag matches `VERSION` (refuses to publish
   otherwise), then real Windows and macOS release builds run (the exact
   same `windows-desktop.yml`/`macos-desktop.yml` workflows every PR
   already exercises, reused via `workflow_call` — not duplicated), each
   with its own real packaged smoke test and a secret/developer-path
   scan of the built artifact.
7. If every job above succeeds, the GitHub Release is created
   automatically — title `Log Explorer v0.2.0`, the Windows `.exe` +
   `.sha256` and macOS `.dmg` + `.sha256` attached, not draft, not
   prerelease.

**If anything fails, no release is published** — a version mismatch, a
platform build failure, a smoke-test failure, or a secret-scan match on
either platform all stop the pipeline before the publish step ever runs.
Fix the underlying issue, then either push a corrected tag (if the old
one was never published — delete and recreate it) or bump `VERSION`
again and tag a new version.

---

## Clean rebuild

Both scripts are safe to re-run from a clean checkout; each removes its
own previous output directory before rebuilding
(`desktop\build\...`/`desktop/build-macos/...`). To force a fully clean
rebuild (e.g. after a dependency change), also remove `frontend/dist`,
`backend/target`, and `desktop/launcher-macos/target` first - neither
script assumes a stale prior build is still valid, but removing them
avoids relying on that assumption at all.

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `dotnet --version` is not `8.0.x` | A newer .NET SDK is installed and shadowing `global.json`'s pin | Install .NET 8 SDK explicitly; `global.json`'s `rollForward: latestFeature` should then resolve to it |
| `dotnet restore --locked-mode` fails with a `NU1xxx`/lock-mismatch error | `desktop/launcher/packages.lock.json` has drifted from `LogExplorerLauncher.csproj` | Regenerate the lock file deliberately (`dotnet restore` without `--locked-mode`), review the diff, commit it as its own change - never silently re-lock |
| `ISCC.exe`/Inno Setup not found | Not installed | `choco install innosetup`, or install from jrsoftware.org |
| `jpackage`/`jlink`/`jdeps` not found | A JRE-only Java install, or Java is not 21 | Install a full JDK 21 (Temurin) |
| macOS: "app is damaged and can't be opened" / Gatekeeper block | Expected for `DEV_UNSIGNED_MODE` (no signing credentials) | Right-click the app → Open, and confirm; or build with `--mode release` with real signing credentials for a distributable build |
| macOS: `RELEASE_GRADE_MODE` fails immediately with a clear "MACOS_SIGNING_IDENTITY required" message | No signing credentials in the environment | Expected, deliberate behavior - this script never fabricates a signed build. Set `MACOS_SIGNING_IDENTITY` to a real keychain identity, or use `--mode dev` |
| macOS: jpackage reports "The first number in an app-version cannot be zero or negative" | `jpackage`'s own internal bundle-metadata constraint - it refuses a leading `0` (e.g. this project's pre-1.0 `VERSION`) | Handled automatically by `scripts/build-desktop-macos.sh` (substitutes a fixed `1.0.0` for jpackage's internal `--app-version` only when the real version's major is 0) - the DMG filename and all other artifact naming still use the real project version. This is jpackage's own constraint, not a product versioning change |
| Backend never reports healthy during the packaged smoke test | Check the backend log the script/failure message points to (`%LOCALAPPDATA%\LogExplorer\logs\backend.log` on Windows, `~/Library/Application Support/LogExplorer/logs/backend.log` on macOS) | The log almost always shows the real underlying Spring Boot startup error |

## Artifact verification

After a build, before distributing an artifact:

- Confirm the artifact exists at the documented output path and its size
  is in the same rough range the build script itself reports (a
  near-zero-byte or implausibly small file signals a silent packaging
  failure that did not otherwise error).
- Both scripts write a `.sha256` checksum file alongside the artifact
  (`LogExplorer-<version>-windows-x64.exe.sha256`,
  `LogExplorer-<version>-macos-<arch>.dmg.sha256`) - verify with
  `Get-FileHash -Algorithm SHA256 <file>` (Windows) or `shasum -a 256
  <file>` (macOS) before distributing it.
- Run the packaged smoke test (above) - packaging success alone
  (`ISCC.exe`/`jpackage` exiting 0) is not sufficient evidence the
  product actually works; the smoke test is what proves the real
  installed/launched app is healthy end to end.
- Confirm no secrets are embedded: neither build script ever reads or
  bundles any OpenShift/Docker/Loki/GitHub credential, and the packaged
  application ships no `.env`, no test fixtures, no repository source
  beyond the compiled jar/launcher/runtime.
