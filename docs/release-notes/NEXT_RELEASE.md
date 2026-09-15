<!--
  Repository-owned release notes for the NEXT tagged release.

  How this is used (docs/verification/AUTOMATED_RELEASE_PIPELINE_REPORT.md
  has the full process): before pushing a new version tag (e.g. v0.2.0),
  edit this file to describe what's new in that release, in plain,
  user-facing language - not implementation detail. The release workflow
  (.github/workflows/release.yml) reads this file's content verbatim and
  prepends/appends a small generated section (version, publisher,
  checksums, signing status) around it to form the final GitHub Release
  body. Keep it concise - a bullet list of what changed for a user is
  enough.

  After a release is published, replace the content below with a fresh
  "## What's new" placeholder for the next release - this file is not
  auto-reset by the workflow.
-->

## What's new

- (edit this section before tagging the next release)
- **Event classification rules.** Tag events with your own labels (for
  example `middleware`) and extract structured values such as URL, response
  code, or duration. Start from any event with *Create tag rule from this
  event*, let Log Explorer suggest a pattern from a bounded sample (local and
  deterministic — a suggestion you review, never saved automatically), test
  it against real events, and save. Tags and extracted values appear in the
  Event Inspector across Search, Investigation, Surroundings, and Live, and
  you can filter searches by tag. Rules are managed in *Classification
  rules* and move between installations as portable JSON rule packs with an
  import preview. Extracted values follow the same server-side masking as
  the rest of an event.
- Classification rules are now stored persistently as a small JSON
  configuration file (`classification-rules.json`, plus a `.bak` copy):
  `%LOCALAPPDATA%\LogExplorer\data` on Windows and
  `~/Library/Application Support/LogExplorer/data` on macOS (both kept on
  upgrade and uninstall), the `log-explorer-data` named volume with Docker
  Compose (kept across `docker compose down`; removed only by `down -v`),
  and a `log-explorer-data` PersistentVolumeClaim on OpenShift. The
  directory can be overridden with `LOGEXPLORER_DATA_DIR`.
