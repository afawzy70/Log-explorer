# Automated Tag-Driven Release Pipeline

**Branch:** `release/automated-tag-publication` (from `main`)
**Scope:** repository-owned, automated GitHub Release publication for
every version **after** `v0.1.0`. `v0.1.0` itself was published manually
(`docs/verification/RELEASE_V0_1_0_REPORT.md`) and is explicitly
untouched by this pass — verified in §6 below. `PRODUCT_BEHAVIOR_CHANGED=NO`.

---

## 1. Audit — what existed before this pass

- No `release.yml` (or equivalent) existed. `v0.1.0` was published by
  running `gh release create` manually against artifacts downloaded from
  a `workflow_dispatch`-triggered run of the existing
  `windows-desktop.yml`/`macos-desktop.yml` workflows, triggered
  manually against the `v0.1.0` tag ref.
- `scripts/build-desktop-windows.ps1` / `scripts/build-desktop-macos.sh`
  (REL-1) already implement the full build (frontend, backend jar, jlink
  runtime, launcher, installer/DMG) and already resolve version
  correctly from an exact git tag when present — no changes needed to
  either script's own version-resolution logic for this pass.
- `desktop/packaging/packaged-smoke-test.ps1` /
  `desktop/packaging-macos/packaged-smoke-test.sh` (REL-1 + the v0.1.0
  branding pass) already verify the real installed product end-to-end,
  including publisher/product metadata — reused as-is.
- `VERSION` (repository root) was already the single authoritative
  version source (REL-1 §10) — reused as-is, no format change.

None of this was duplicated. The only genuinely new logic is: the strict
tag-vs-`VERSION` gate, and the release-aggregation/publish step.

## 2. Architecture

```
push tag v0.2.0
      │
      ▼
validate-version  (tag == VERSION, or FAIL immediately)
      │
      ├──────────────┬──────────────┐
      ▼              ▼
windows-release   macos-release      (both: workflow_call reuse of the
(windows-desktop.yml)  (macos-desktop.yml)   SAME workflows every PR runs)
      │              │
      └──────┬───────┘
             ▼
      publish-release   (contents: write, only this job)
             │
             ▼
      GitHub Release created — Windows .exe + .sha256, macOS .dmg + .sha256
```

`windows-release`/`macos-release` are **not** new jobs with copied
steps — they are `uses: ./.github/workflows/windows-desktop.yml` /
`macos-desktop.yml`, the exact same workflow files every pull request
touching `desktop/`, `backend/`, or `frontend/` already runs. A new
`workflow_call` trigger (with one optional input, `release_version`) was
added to each, alongside their existing `pull_request`/`push`/
`workflow_dispatch` triggers — the build step now passes
`-Version '${{ inputs.release_version }}'` (Windows) /
`--version '${{ inputs.release_version }}'` (macOS), which resolves to
an empty string for every non-release trigger (identical to today's
behavior — the scripts' own git-tag-or-`VERSION`+`-dev.<sha>` resolution
applies unchanged) and to the real release version only when `release.yml`
calls them. This is the deepest level of "do not duplicate packaging
implementation" available: not just the build scripts, but the entire
CI job (tool setup, the build step, the smoke test, artifact upload) is
the *same* job definition for ordinary CI and for a real release.

Two small additions were made to both reused workflows, in both cases
new steps, not modified existing ones: a secret/developer-path scan of
the built artifact (mirrors the manual sweep performed for `v0.1.0`,
now automated and gating), and the `.sha256` checksum file is now
included in the uploaded CI artifact (previously only the installer/DMG
itself was uploaded — needed so `publish-release` can attach a
checksum that was actually generated at build time, not recomputed
separately).

## 3. Strict version gate

`validate-version` (job 1, `ubuntu-latest`, no elevated permissions)
derives `TAG_VERSION` from `${GITHUB_REF_NAME#v}` and compares it,
byte-for-byte after whitespace trimming, against the `VERSION` file's
own content. A mismatch fails the job immediately (`exit 1` with a clear
`::error::` annotation) — no downstream job runs, no release is
published. Tested locally against both a matching case (`v0.1.0` vs.
the real `VERSION` file, currently `0.1.0` → match) and a deliberately
mismatched case (`v0.2.0` vs. `0.1.0` → correctly detected as a
mismatch) before this logic was committed.

Development/non-tagged builds are entirely unaffected — they never go
through `release.yml` at all (it only triggers on `push: tags: v*`);
`windows-desktop.yml`/`macos-desktop.yml`'s own ordinary `pull_request`/
`push`/`workflow_dispatch` triggers continue to produce
`<VERSION>-dev.<sha>` builds exactly as before REL-1.

## 4. Release publication gate

`publish-release` (job 4) declares `needs: [validate-version,
windows-release, macos-release]` — GitHub Actions' own dependency
semantics mean this job (and therefore the `gh release create` call
inside it) **does not run at all** if any of those three jobs fails,
including a failure deep inside a reused workflow (a Windows build
failure, a macOS smoke-test failure, either platform's secret scan
failing). No conditional `if:` logic was needed to enforce this — it is
the structural default. `publish-release` additionally re-verifies, as
defense-in-depth: that the exact expected version-named files exist
after download, that their checksums verify (`sha256sum -c`) against the
just-downloaded bytes, and — after publishing — that the created
release's own `targetCommitish` matches `$GITHUB_SHA` exactly and that
`isDraft`/`isPrerelease` are both `false`, failing the job if either
check doesn't hold (this would not un-publish an already-created
release, but would surface the discrepancy loudly in the workflow run
rather than silently reporting success).

## 5. Provenance

The entire pipeline runs within one workflow run, triggered by one tag
push event. `github.sha`/`$GITHUB_SHA` is identical across every job in
that run — `validate-version`, the two reused build workflows (their own
`actions/checkout@v4` steps use this same default), and
`publish-release` — because none of them ever checks out a different ref
(no job references `main` or any branch anywhere in this pipeline).
`RELEASE_PROVENANCE_MATCH` is asserted explicitly in the final
"Verify the published release" step: the published release's own
`targetCommitish` is compared against `$GITHUB_SHA` and the job fails if
they differ. `TAG_TARGET_SHA`, `WINDOWS_ARTIFACT_SOURCE_SHA`,
`MACOS_ARTIFACT_SOURCE_SHA`, and `GITHUB_RELEASE_TARGET_SHA` are all,
by this construction, the one same value for any given release.

## 6. Existing v0.1.0 — verified untouched

```
$ git rev-parse v0.1.0
ddcd9e2aa1147f8f2404a292cfb3d35f605d0fc9
$ git rev-parse v0.1.0^{commit}
5a58d8113956af7d3026e60677bd3b3de1ee4187
$ gh release view v0.1.0 --json tagName,isDraft,isPrerelease,targetCommitish,assets
{ "tagName": "v0.1.0", "isDraft": false, "isPrerelease": false,
  "targetCommitish": "5a58d8113956af7d3026e60677bd3b3de1ee4187",
  "assets": [ ...same 4 assets, same digests, as recorded in
  RELEASE_V0_1_0_REPORT.md... ] }
```

Identical to the values recorded at the time `v0.1.0` was published —
tag object, target commit, draft/prerelease flags, and all four asset
digests unchanged. `V0_1_0_TAG_UNCHANGED=YES`,
`V0_1_0_RELEASE_UNCHANGED=YES`, `V0_1_0_ASSETS_UNCHANGED=YES`. This
pipeline was never exercised against `v0.1.0` itself — no tag was
re-pushed, no workflow was manually run against that tag, no asset was
re-uploaded.

## 7. Safe validation (no real tag created this pass)

Per this mission's own explicit "No temporary public release should be
created" and "Do NOT publish a fake production release just to test the
workflow," this pipeline's own new logic (the `validate-version` gate
and the `publish-release` job) was validated without creating any real
version tag:

- **YAML syntax**: all three workflow files (`release.yml`,
  `windows-desktop.yml`, `macos-desktop.yml`) parsed successfully with
  Python's `yaml.safe_load`.
- **Version-gate logic**: the exact bash comparison
  (`${GITHUB_REF_NAME#v}` vs. `VERSION` file content) was run locally
  against both a matching case and a deliberately mismatched case,
  confirmed to produce the correct pass/fail result in each.
- **Release-notes assembly**: the exact `sed`/`cat`/heredoc pipeline
  that builds the final release body was run locally end-to-end against
  the real `docs/release-notes/NEXT_RELEASE.md` and simulated checksum
  files, confirmed to produce well-formed Markdown.
- **The build/smoke-test/security-scan logic itself** (inside
  `windows-desktop.yml`/`macos-desktop.yml`) is not new — it is the
  exact same logic already proven on real `windows-latest`/`macos-latest`
  runners across every REL-1 and v0.1.0-branding CI run. Reusing it via
  `workflow_call`, parameterized only by an optional version string
  that this session already confirmed (in the v0.1.0 release build)
  correctly flows through to the artifact filename and installed
  product's own version metadata, is a low-risk extension, not new
  untested surface.
- **Code review**: `publish-release`'s permissions are `contents: write`
  and nothing else, scoped to that one job only (every other job stays
  at the workflow's own default `contents: read`); `windows-release`/
  `macos-release` inherit no secrets (`secrets: inherit` was
  deliberately not added — neither reused workflow reads any repository
  secret in `DEV_UNSIGNED_MODE`, which remains the mode used for every
  release build until real signing credentials exist).
- **No `workflow_dispatch` test-publish mode was added to `release.yml`**
  — the mission's own §12 makes this optional ("may be added provided it
  NEVER publishes"), and the actual remaining risk surface
  (`validate-version` + `publish-release`) was judged fully covered by
  the methods above without needing a live trigger; adding a
  publish-capable manual trigger, even a gated one, was judged higher
  risk than the coverage it would add, for a job whose real behavior
  (`gh release create`) is inherently identical whether triggered by a
  real tag or a `workflow_dispatch` faking one.

This pipeline's true first real exercise will be the next genuine
release tag the owner pushes — expected, honest, and consistent with
"Do NOT publish a fake production release just to test the workflow."

## 8. Release notes strategy

`docs/release-notes/NEXT_RELEASE.md` is the repository-owned,
maintainer-edited source for what's-new content — never hardcoded as
large static text inside `release.yml`. The workflow strips the file's
leading explanatory HTML comment and appends a small, fully generated
provenance section (publisher, signing-status disclosure, SHA-256
checksums, source commit) around the maintainer's own content. The file
is **not** auto-reset by the workflow after a release — a maintainer
updates it before the *next* tag, documented in
`docs/development/BUILD_DESKTOP.md`.

## 9. Security

- `permissions: contents: read` at the workflow root; only
  `publish-release` escalates, and only to `contents: write` (the
  minimum needed to create a release and upload its assets) — no other
  scope (`issues`, `pull-requests`, `actions`, etc.) is granted anywhere
  in this pipeline. `EXCESS_PERMISSIONS=NO`.
- Both platform jobs' new secret-scan steps gate the pipeline — a match
  fails that job, which (§4) prevents `publish-release` from ever
  running.
- No repository secret is referenced anywhere in this pipeline — release
  builds run in the same `DEV_UNSIGNED_MODE` as ordinary CI, since no
  Apple/Windows signing credential exists in this repository. No signing
  or notarization success is fabricated; the generated release notes
  disclose the unsigned status explicitly.
- Publisher metadata ("Ahmed Fawzy elrifaye") flows through unchanged
  from the v0.1.0 branding pass — no new publisher-metadata logic was
  added or needed here, since it is already baked into
  `installer.iss`/`LogExplorerLauncher.csproj`/`build-desktop-macos.sh`.

## 10. Icon status — unchanged, not fabricated

`CANONICAL_ICON_SOURCE=MISSING`, unchanged from the v0.1.0 branding
pass. `ICON_WORK_THIS_MISSION=DEFERRED_PENDING_OWNER_ARTWORK` — no icon
work was attempted in this mission; future releases will continue to
use the same pre-existing generic placeholder (Windows) / `jpackage`
default (macOS) until real, owner-supplied or owner-approved artwork is
available.

## 11. Documentation

- `docs/development/BUILD_DESKTOP.md` — new "Publishing a future
  release (automated)" section.
- `docs/release-notes/NEXT_RELEASE.md` (new) — the repo-owned release
  notes source.
- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — updated to record
  this pipeline's existence against §7's own "a documented release
  process" acceptance criterion.
- This report.

`DOCUMENTATION_AUDIT=PASS`, `REQUIREMENTS_REGISTER_UPDATED=YES`,
`UNTRACKED_OWNER_REQUIREMENTS=0`.

## 12. Scope discipline

`PRODUCT_BEHAVIOR_CHANGED=NO` — no `backend/src/main/java` or
`frontend/src` file touched. `v0.1.0`'s tag, release, and all four
assets are byte-for-byte unchanged (§6). No UI/UX redesign work, no
Phase M work. Final Functional Closure was not resumed.
