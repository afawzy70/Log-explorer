# Release v0.1.0 — Branding, Publisher Metadata, and Publication

**Merge commit (release content):** `5a58d8113956af7d3026e60677bd3b3de1ee4187`
(PR #48, `release/v0.1.0-branding-and-publication` → `main`)
**Tag:** `v0.1.0` (annotated, object `ddcd9e2aa1147f8f2404a292cfb3d35f605d0fc9`,
pointing exactly at the merge commit above — `TAG_TARGET_MATCH=YES`)
**GitHub Release:** <https://github.com/afawzy70/Log-explorer/releases/tag/v0.1.0>
(published, not draft, not prerelease)

---

## 1. Version source

`AUTHORITATIVE_VERSION=0.1.0` — the repository-root `VERSION` file,
unchanged from REL-1 (`docs/verification/REL_1_DESKTOP_RELEASE_READINESS_REPORT.md`).
`GIT_TAG=v0.1.0`. Both `scripts/build-desktop-windows.ps1` and
`scripts/build-desktop-macos.sh` resolve version via `git describe --tags
--exact-match` first; because the tag was created *before* triggering the
release build (`gh workflow run ... --ref v0.1.0`, not a push-triggered
build against an untagged commit), both platforms resolved the exact
tag, verbatim, with **no** `-dev.<sha>` suffix — confirmed directly in
both real CI logs:

```
Windows: Version: 0.1.0
macOS:   Version: 0.1.0
```

`VERSION_DRIFT=0` — `backend/pom.xml` (`0.1.0-SNAPSHOT`) and
`frontend/package.json` (`0.1.0`) were already consistent with `VERSION`
before this pass (no drift to reconcile).

## 2. Publisher / author metadata

`EXPECTED_PUBLISHER="Ahmed Fawzy elrifaye"`. Set wherever each platform's
packaging format truthfully supports a publisher/author/vendor field,
and **verified for real** (not just reviewed in source) via new
assertions added to both packaged smoke tests, executed on the real
tag-triggered CI runs:

### Windows (real evidence, `windows-latest`)

```
Add/Remove Programs Publisher:   Ahmed Fawzy elrifaye
Add/Remove Programs DisplayVersion: 0.1.0
Launcher executable CompanyName:    Ahmed Fawzy elrifaye
Launcher executable ProductName:    Log Explorer
Launcher executable FileDescription: Log Explorer
Launcher executable ProductVersion:  0.1.0+5a58d8113956af7d3026e60677bd3b3de1ee4187
```

`WINDOWS_INSTALLER_PUBLISHER=PASS`, `WINDOWS_ARP_PUBLISHER=PASS`,
`WINDOWS_PUBLISHER_VERIFICATION=PASS`. Source: `desktop/packaging/installer.iss`'s
`MyAppPublisher` (drives both the installer's own displayed publisher
and the Add/Remove Programs registry value Inno Setup writes for the
uninstall entry) and `desktop/launcher/LogExplorerLauncher.csproj`'s
`<Company>` (the Win32 `FileVersionInfo` field Explorer shows as
"Company" in a file's Properties > Details tab).

### macOS (real evidence, `macos-latest`)

```
Info.plist CFBundleName: Log Explorer
Info.plist CFBundleShortVersionString: 1.0.0
Info.plist NSHumanReadableCopyright: Copyright (c) 2026 Ahmed Fawzy elrifaye
```

`MACOS_PUBLISHER_METADATA=PASS`. Metadata fields used: `jpackage
--vendor` and `--copyright` — the latter is written directly into the
generated `Info.plist` as `NSHumanReadableCopyright`, which macOS
Finder's "Get Info" panel displays to a user. This is the most
user-visible attribution `jpackage` truthfully supports without a real
Apple Developer Team identity, which this project does not have and
does not fabricate.

**`CFBundleShortVersionString` reads `1.0.0`, not `0.1.0`** — a
`jpackage` constraint, not a product versioning error (documented in
REL-1's own report and `docs/development/BUILD_DESKTOP.md`): `jpackage`
rejects a leading-zero major version outright for its internal
`--app-version` bundle metadata. The DMG filename, GitHub Release
tag/title, and every other user-visible version string correctly show
`0.1.0`.

`PUBLISHER_METADATA=PASS` overall.

**Important, stated explicitly (mission §13):** this publisher metadata
is *not* code-signing identity. `WINDOWS_CODE_SIGNING=NOT_CONFIGURED`,
`MACOS_SIGNING_NOTARIZATION=NOT_CONFIGURED`. Neither Windows SmartScreen
nor macOS Gatekeeper cryptographically verifies this publisher string —
both builds remain unsigned, and no signing/notarization success is
claimed.

## 3. Application icon

`CANONICAL_ICON_SOURCE=MISSING`. Audited: `frontend/` (no SVG/PNG logo,
no favicon reference in `index.html`), `desktop/` (only
`desktop/launcher/Resources/app.ico`, a 32×32, 4-color, generic
rounded-rectangle-outline placeholder — not a distinctive designed "Log
Explorer" mark; no wordmark, no monogram, no brand-specific color
identity), `README.md` (no logo/brand references), packaging/
documentation resources (none). Per this project's own anti-fabrication
discipline and the mission's own explicit instruction ("If NO
product-specific source artwork exists: STOP icon generation... Do not
invent unrelated branding without owner approval"), no new icon was
generated this pass:

```
CANONICAL_ICON_COMMITTED=NO
WINDOWS_APP_ICON=UNCHANGED (existing generic placeholder, not regressed, not upgraded)
WINDOWS_INSTALLER_ICON=UNCHANGED
MACOS_APP_ICON=NOT_SET (jpackage default icon)
MACOS_ICNS=NOT_PRODUCED
MACOS_DMG_BRANDING=NOT_APPLICABLE (no custom DMG background/layout - out of scope without source artwork, and would itself edge toward a UI/UX decision this mission does not authorize)
```

Tracked as a `FUTURE_IMPROVEMENT` in both this report and
`docs/development/BUILD_DESKTOP.md` — real, owner-supplied or
owner-approved artwork is required before a proper multi-resolution
`.ico`/`.icns` can be produced.

## 4. Release artifacts — built from the exact tag, real CI

Both workflows (`windows-desktop.yml`, `macos-desktop.yml`) were
triggered via `workflow_dispatch` directly against the `v0.1.0` tag ref
(`gh workflow run <workflow> --ref v0.1.0`) — a real build, on real
`windows-latest`/`macos-latest` runners, from the exact tagged commit,
not a push-triggered build against an untagged branch commit.

| Platform | Artifact | Size | SHA-256 |
|---|---|---|---|
| Windows | `LogExplorer-0.1.0-windows-x64.exe` | 120.2 MB (125,989,939 bytes) | `cd7e46ca0614814fbc4a26d6ae35a514c5cc7d1a8e98e5e1437c172653be0db3` |
| macOS (arm64) | `LogExplorer-0.1.0-macos-arm64.dmg` | 81 MB (82,475,414 bytes) | `fcecd66e5d2a95b8b62b6e140abe65c78c0a67e218d249478992e3a3dbab4334` |

Both checksums independently recomputed locally (`sha256sum`) on the
exact bytes downloaded from the CI run's own artifact upload, and cross-
checked against the checksum the Windows build script itself printed
during the run (`SHA-256: cd7e46ca...` — identical) and against the
`digest` field GitHub itself computed and stored on each uploaded
release asset (identical for both). `WINDOWS_RELEASE_ARTIFACT=PASS`,
`WINDOWS_RELEASE_SHA256=PASS`, `MACOS_RELEASE_ARTIFACT=PASS`,
`MACOS_RELEASE_SHA256=PASS`.

## 5. Real package verification (smoke tests, real runners)

### Windows

```
Backend healthy on port 3434
UI shell loads
API call returned real source data
No orphan backend process - clean shutdown
Uninstall removed the installed application
PACKAGED WINDOWS SMOKE TEST PASSED
```

`WINDOWS_RELEASE_SMOKE=PASS`. Full run: <https://github.com/afawzy70/Log-explorer/actions/runs/34757185526>.

### macOS

```
Backend healthy on port [assigned]
UI shell loads
API call returned real source data
No orphan backend process - clean shutdown
App bundle removed
PACKAGED MACOS SMOKE TEST PASSED
```

`MACOS_RELEASE_SMOKE=PASS`. Full run: <https://github.com/afawzy70/Log-explorer/actions/runs/34757186730>.

## 6. Security sweep — release artifacts

Both downloaded artifacts (`.exe`, `.dmg`) were scanned directly
(`strings` + pattern search) for: OpenShift/Sandbox tokens, Docker
credentials, Loki credentials, GitHub tokens/credentials, generic API-key
patterns, PEM private key headers, and CI-runner-specific developer
paths (`D:\a\Log-explorer\...`, `/Users/runner/...`, `runneradmin`).
**Zero matches in either artifact.** `SECRETS_IN_RELEASE_ARTIFACTS=NO`.

This is consistent with, not a new finding beyond, REL-1's own source-
level review (`REL_1_DESKTOP_RELEASE_READINESS_REPORT.md` §5): neither
build script reads or embeds any credential, and the packaged app
bundles only the compiled launcher, the jlinked runtime, and the one
named backend jar.

## 7. GitHub Release — published and verified

```
GITHUB_RELEASE_EXISTS=YES
GITHUB_RELEASE_TAG=v0.1.0
GITHUB_RELEASE_VERSION=0.1.0
GITHUB_RELEASE_URL=https://github.com/afawzy70/Log-explorer/releases/tag/v0.1.0
GITHUB_RELEASE_TARGET_COMMIT=5a58d8113956af7d3026e60677bd3b3de1ee4187 (matches RELEASE_PREP_MERGE_SHA exactly)
GITHUB_RELEASE_IS_DRAFT=NO
GITHUB_RELEASE_IS_PRERELEASE=NO
WINDOWS_RELEASE_ASSET=YES
WINDOWS_CHECKSUM_ASSET=YES
MACOS_RELEASE_ASSET=YES
MACOS_CHECKSUM_ASSET=YES
```

All four asset filenames contain exactly `0.1.0`, no dev-SHA suffix.
Verified directly via `gh release view v0.1.0 --json ...` after
publication, not merely assumed from the publish command's own exit
code.

## 8. What remains deferred (not silently dropped)

- A real, owner-supplied/approved application icon (`.ico`/`.icns`) —
  `CANONICAL_ICON_SOURCE=MISSING`, `FUTURE_IMPROVEMENT`.
- Real code signing (Windows Authenticode certificate) and macOS
  notarization — `NOT_CONFIGURED`, no credentials exist in this
  environment; the release/packaging path is already structured to
  accept them later without restructuring (REL-1's `RELEASE_GRADE_MODE`).
- Real Loki environment verification — unchanged from OS-1G,
  `REAL_LOKI=BLOCKED_EXTERNAL_ENVIRONMENT`; not attempted again in this
  branding/release-only pass.

## 9. Scope discipline

`PRODUCT_BEHAVIOR_CHANGED=NO` — no `backend/src/main/java` or
`frontend/src` file was touched in either PR of this pass (`release/v0.1.0-branding-and-publication`,
and this documentation-only follow-up). No Search/OpenShift/Docker/Loki/
Live/Context/Correlation/Journey/masking/API-contract behavior changed.
The `functional-baseline-pre-ux-redesign` tag was deliberately **not**
created in this mission — that belongs to the separate Final Functional
Closure mission, per explicit instruction.

## 10. Documentation

- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — §7's main REL-1 row
  updated: GitHub Releases publication (the row's own long-standing
  requirement) is now real, with this report as evidence.
- `docs/development/BUILD_DESKTOP.md` — publisher metadata and icon
  status sections (added in the `release/v0.1.0-branding-and-publication`
  PR, already merged).
- This report.

`DOCUMENTATION_AUDIT=PASS`, `REQUIREMENTS_REGISTER_UPDATED=YES`,
`UNTRACKED_OWNER_REQUIREMENTS=0`.
