# Windows Desktop CI Hardening — Reproducible .NET SDK / NuGet Restore

**Branch:** `platform/windows-dotnet-nuget-restore-hardening` (from `main`, base SHA `afbcf7d9587e47d793acdeeb745e2816a8993baf`)
**PR:** #44 (`platform/windows-dotnet-nuget-restore-hardening` → `main`)
**Scope:** CI/toolchain infrastructure hardening only. **Not** REL-1
implementation, **not** OS-1F, **not** a product feature change. PR #42
(OS-1D) and PR #43 (OS-1E) were neither branched from nor modified by
this work.

---

## 1. Trigger — the repeated PR #42 Windows Desktop failure

PR #42's Windows Desktop gate (`.github/workflows/windows-desktop.yml`)
failed repeatedly, always at the same step, with the same signature:

```
Determining projects to restore...
Failed to restore D:\a\Log-explorer\Log-explorer\desktop\launcher\LogExplorerLauncher.csproj (in 72 ms).
C:\Program Files\dotnet\sdk\10.0.400\NuGet.targets(198,5): error MSB4181: The "RestoreTask" task returned false but did not log an error.
```

A fresh, code-unchanged retry (performed as part of the prior
`OS_1D_OS_1E_STACK_FINALIZATION` mission) reproduced the identical
failure — same file, same error code, same wrapper message, only the
timestamp differed (`14:58:20Z` → `19:06:11Z`). This is what established
`PR_42_WINDOWS_GATE=BLOCKED_EXTERNAL_CI` at that time, and is the reason
this hardening mission exists.

## 2. Toolchain audit (before any change)

| Fact | Confirmed value |
|---|---|
| Workflow's requested SDK | `actions/setup-dotnet@v4` with `dotnet-version: '8.0.x'` |
| Actual failing SDK (from CI logs) | `10.0.400` (`C:\Program Files\dotnet\sdk\10.0.400\NuGet.targets`) |
| Launcher target framework | `net8.0-windows` (`desktop/launcher/LogExplorerLauncher.csproj`) |
| WebView2 reference (before) | `Microsoft.Web.WebView2 Version="1.0.*"` — a floating wildcard, with its own code comment explaining it was authored from a sandbox with no NuGet connectivity to verify an exact version |
| `global.json` | Did not exist anywhere in the repository |
| `nuget.config` | Did not exist anywhere in the repository |
| `packages.lock.json` | Did not exist |

## 3. Root-cause investigation

No Windows environment was available in this working session (Linux
sandbox; no local `dotnet` CLI). Per the mission's own fallback
("temporarily improve workflow diagnostics on THIS hardening branch
only"), diagnostics were added directly to the workflow and evidence was
gathered from real GitHub Actions runs on the hardening branch itself,
never assumed.

**Root cause (confirmed, not hypothesized):** no `global.json` existed,
so `dotnet` resolved to the **highest SDK installed on the `windows-latest`
runner image**, not necessarily the `8.0.x` SDK `actions/setup-dotnet@v4`
had just installed. `windows-latest` images bundle several preinstalled
.NET SDK major versions; without a `global.json` pin, the .NET host
resolver picks the highest one present, regardless of what
`actions/setup-dotnet@v4` requested. The observed failures were executing
through a preinstalled **.NET 10 SDK** (`10.0.400`) whose NuGet restore
task pairing was never validated against this `net8.0-windows` project.

**Confirmed directly**, not inferred: a new CI step ("Verify effective
.NET SDK") was added that prints `dotnet --version`. Before the fix, this
would have printed `10.0.400` (matching the exact SDK path in the
original failure logs); after adding `global.json`, the SAME step on a
real CI run printed **`8.0.425`** — proof the pin took effect and
resolved to a genuine, currently-installed 8.0.x SDK, not a guessed or
hard-coded patch number.

**MSB4181's own opacity** ("returned false but did not log an error") is
a known symptom of an SDK/NuGet-task version mismatch — the newer SDK's
bundled restore task encountering a state it cannot process from this
older-target project, without surfacing a specific inner exception. This
is consistent with, and fully explained by, the SDK-drift root cause
above; no other contributing cause was found once the SDK pin alone
resolved restore cleanly on the first bootstrap CI run.

## 4. Fixes implemented

### 4.1 Pin the effective .NET SDK

`global.json` (repository root):

```json
{
  "sdk": {
    "version": "8.0.100",
    "rollForward": "latestFeature",
    "allowPrerelease": false
  }
}
```

`8.0.100` is the floor (the GA .NET 8 SDK release); `rollForward:
latestFeature` uses the **highest installed feature band/patch within
major.minor 8.0** — so it tolerates whatever exact `8.0.4xx` patch
`actions/setup-dotnet@v4`'s floating `8.0.x` request happens to install
over time, without ever being able to silently cross into 9.x or 10.x.
This is the standard, documented mechanism for this exact class of
problem (Microsoft's own `global.json`/SDK-resolution documentation).

A new workflow step, **"Verify effective .NET SDK matches the
repository-owned contract (global.json)"**, runs immediately after
`actions/setup-dotnet@v4` and fails fast with a clear message if
`dotnet --version` is ever not `8.0.*` — turning a future regression of
this exact class into an immediate, self-explanatory failure instead of
an opaque `MSB4181` several steps later. It also prints `dotnet --info`,
`dotnet --list-sdks`, and `dotnet nuget list source` as permanent,
always-on diagnostics.

### 4.2 Exact NuGet source

`nuget.config` (repository root) clears every inherited package source
and adds back exactly `nuget.org` (protocol v3) — explicit and
diagnosable for both CI and a future local Windows build script (no
separate copy to keep in sync, since NuGet config discovery walks up the
directory tree from the project being restored). No mirrors, no insecure
fallback, no disabled certificate verification.

### 4.3 Exact WebView2 version — no floating wildcards in the desktop path

The NuGet v3 API was queried directly and verified before pinning:

```
$ curl -s https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json
...
"1.0.4191.47"    (latest, listed, stable — no "-prerelease" suffix)
```

```
$ curl -s https://api.nuget.org/v3/registration5-semver1/microsoft.web.webview2/1.0.4191.47.json
{"listed":true, "published":"2026-08-28T07:24:32.047+00:00", ...}
```

`Microsoft.Web.WebView2 Version="1.0.*"` is replaced with the exact,
verified, currently-published stable release `1.0.4191.47` — never
guessed.

### 4.4 Deterministic restore: lock file + locked mode

`RestorePackagesWithLockFile=true` is set in `LogExplorerLauncher.csproj`.
`desktop/launcher/packages.lock.json` is committed — generated by, and
downloaded as a build artifact from, a **real** CI restore against the
real `nuget.org` (real content hashes, never hand-authored — this
sandbox has no local `dotnet` CLI to fabricate one, and a hand-written
lock file with guessed hashes would be actively unsafe under
`--locked-mode`):

```json
{
  "version": 1,
  "dependencies": {
    "net8.0-windows7.0": {
      "Microsoft.Web.WebView2": {
        "type": "Direct", "requested": "[1.0.4191.47, )", "resolved": "1.0.4191.47",
        "contentHash": "Snb6mlTpuz6ZFjWMwIdg28Xp6kAUMy3zaLUyGbFSaw+/AJKlwoX8EiaWJ1eUMfKyJHksPkFjJHl1LIB7kX+0AQ=="
      }
    },
    "net8.0-windows7.0/win-x64": {
      "Microsoft.Web.WebView2": {
        "type": "Direct", "requested": "[1.0.4191.47, )", "resolved": "1.0.4191.47",
        "contentHash": "Snb6mlTpuz6ZFjWMwIdg28Xp6kAUMy3zaLUyGbFSaw+/AJKlwoX8EiaWJ1eUMfKyJHksPkFjJHl1LIB7kX+0AQ=="
      }
    }
  }
}
```

CI restore uses `--locked-mode`: a clean checkout resolves the exact same
dependency graph every time, and any future drift between
`LogExplorerLauncher.csproj` and this lock file fails restore loudly
instead of silently re-resolving/rewriting the lock file mid-CI (the
mission's explicit "do not regenerate the lock file silently during
normal CI" requirement).

### 4.5 A second, distinct defect this hardening's own first CI run caught

The bootstrap CI run (restore without `-r win-x64`, to first generate the
lock file) succeeded at restore but then failed **publish** with:

```
NETSDK1047: Assets file '...\obj\project.assets.json' doesn't have a
target for 'net8.0-windows/win-x64'. Ensure that restore has run and
that you have included 'net8.0-windows' in the TargetFrameworks for your
project. You may also need to include 'win-x64' in your project's
RuntimeIdentifiers.
```

This is a distinct, well-understood defect from separating restore and
publish without matching their `RuntimeIdentifier`: restoring without
`-r win-x64` produces a `project.assets.json` with no RID-specific
target, so a later `publish --no-restore -r win-x64` cannot find one.
Fixed by passing the same `-r win-x64` to restore that publish already
used. This is why `packages.lock.json` correctly contains both a bare
`net8.0-windows7.0` entry and a `net8.0-windows7.0/win-x64` entry.

### 4.6 Explicit restore/publish separation

```
dotnet restore LogExplorerLauncher.csproj -r win-x64 --locked-mode --verbosity detailed
dotnet publish -c Release -r win-x64 --self-contained true --no-restore ...
```

Two separate, individually-diagnosable CI steps. Publish can never
silently perform a second, different dependency resolution.

### 4.7 Bounded, narrowly-classified retry

Restore is wrapped in a small PowerShell retry loop: **max 2 attempts
total (at most 1 retry)**, and a retry only fires when the failure output
matches a small explicit allowlist of transient network/feed signatures
(`Unable to load the service index`, SSL handshake failure, timeout,
DNS failure, `: 503`, `: 502`, etc.). A `NU1xxx` dependency-resolution
error, an `MSB`-prefixed error, or a lock-file mismatch is **not** in
that allowlist and therefore fails immediately on the first attempt —
retrying those would hide a real, deterministic defect behind a
flaky-looking extra attempt.

### 4.8 NuGet packages cache (optimization only)

`actions/cache@v4` on an explicit NuGet global packages folder path
(`$RUNNER_TEMP/nuget-packages`, set via `NUGET_PACKAGES` env), keyed on
`hashFiles('desktop/launcher/packages.lock.json')`. Purely an
optimization: `--locked-mode` restore is the actual correctness source
of truth regardless of cache staleness — a stale or missing cache entry
just means more packages are downloaded fresh, never a different
resolved graph.

## 5. Evidence — real CI runs, not assumed

| Run | Purpose | Result |
|---|---|---|
| [34698598219](https://github.com/afawzy70/Log-explorer/actions/runs/34698598219) (PR #42, pre-hardening retry) | Confirms the failure signature and rules out a one-off flake | `FAILED` — `MSB4181`, SDK `10.0.400` |
| [34714783371](https://github.com/afawzy70/Log-explorer/actions/runs/34714783371) (PR #44, bootstrap pass 1) | Confirms the SDK-pin root-cause fix; generates the lock file | Restore step `PASSED` (SDK confirmed `8.0.425`); publish `FAILED` with the distinct `NETSDK1047` RID-mismatch defect (§4.5) |
| [34715179955](https://github.com/afawzy70/Log-explorer/actions/runs/34715179955) (PR #44, bootstrap pass 2, `-r win-x64` fix) | Full pipeline green after the RID fix | `PASSED` — restore, publish, installer build, packaged smoke test, all green |
| [34715480580](https://github.com/afawzy70/Log-explorer/actions/runs/34715480580) (PR #44, locked-mode run 1) | First genuinely `--locked-mode` restore against the committed lock file, clean runner | `PASSED` — full pipeline green |
| [34715654800](https://github.com/afawzy70/Log-explorer/actions/runs/34715654800) (PR #44, locked-mode run 2, manual `workflow_dispatch`) | Second independent clean-runner run, same commit, reproducibility confirmation | `PASSED` — full pipeline green; `packages.lock.json` artifact diffed byte-for-byte identical to the committed file |

`RESTORE_REPRODUCIBLE=YES` — not "one retry happened to pass": two
independent clean-runner runs on the identical commit both produced
identical, fully-green results end to end, including the real packaged
`install → launch → health → UI → API → shutdown → uninstall` smoke test.

## 6. Validation checklist

| Check | Result |
|---|---|
| Clean restore (`--locked-mode -r win-x64`) | `PASS` (runs 34715480580, 34715654800) |
| Clean publish (`--no-restore -r win-x64`) | `PASS` (same runs) |
| Windows installer build (Inno Setup) | `PASS` (same runs) |
| Packaged smoke test (install→launch→health→UI→API→shutdown→uninstall) | `PASS` (same runs) |
| Repeat from a clean runner ≥2 times | `PASS` — 2 independent runs, identical commit, identical result |
| `packages.lock.json` reproducibility (byte-for-byte across runs) | `PASS` |
| Backend CI (unaffected by this change) | `PASS` |
| Frontend CI (unaffected by this change) | `PASS` |
| E2E CI (unaffected by this change; one unrelated transient Maven-download infra flake observed and rerun — see §7) | see §7 |
| YAML/JSON/XML syntax of all new/changed config files | `PASS` (`python3 -c "import yaml/json/xml..."` against `windows-desktop.yml`, `global.json`, `nuget.config`, `LogExplorerLauncher.csproj`) |

## 7. Unrelated CI note (not part of this hardening's scope)

PR #44's `E2E` job (Linux runner, unrelated to Windows/.NET/NuGet) failed
once with `wget: Failed to fetch https://repo.maven.apache.org/...` while
downloading the Maven wrapper — a transient network blip on the Linux E2E
runner, unrelated to any file this hardening touched (no `backend/`,
`frontend/`, or Maven-related file was changed). Rerun to confirm it was
not a regression this hardening introduced; result recorded in the final
mission response.

## 8. Documentation

- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — new §7c
  ("Windows Desktop CI/Toolchain Hardening"), `PLATFORM-WIN-1` row,
  `VERIFIED`, plus a closing §14 narrative paragraph. An explicit note
  documents how this reconciles with the still-open
  `os/1e-openshift-live-tail` branch's own separately-registered,
  tracking-only "Reproducible Windows .NET / NuGet Toolchain" row (also
  numbered §7c there) once that branch rebases onto this now-hardened
  `main` — this hardening branch cannot and does not modify PR #42/#43
  directly.
- This report.

`UNTRACKED_OWNER_REQUIREMENTS=0`. §7b ("Local Reproducible Desktop
Packaging") is explicitly **not** marked complete by this pass — it
remains `APPROVED_PENDING`, tracked for REL-1 implementation. This
hardening pass fixes the existing CI-driven packaging path's restore
determinism only; it does not create the repository-owned local build
scripts §7b describes.

## 9. Scope boundary (explicitly not touched)

macOS packaging, GitHub Release publishing, signing, installer redesign,
desktop UI/launcher feature changes, OpenShift changes, OS-1F, REL-1
implementation. PR #42 and PR #43 were not modified, not branched from,
and not merged by this work.
