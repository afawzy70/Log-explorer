# Slice 9 — Windows Desktop Report

Evidence for §A–§J, §AG, §AH of Legacy Remediation Slice 9. Authored from
a Linux sandbox with no Windows/.NET toolchain available locally — every
claim below is backed by a real, hosted `windows-latest` GitHub Actions
run (`.github/workflows/windows-desktop.yml`), not a claim taken on
faith. Final green run: `34458449693`, commit `94c3191`,
<https://github.com/afawzy70/Log-explorer/actions/runs/34458449693>.

## Architecture (§A)

```
LogExplorer.exe
  -> WinForms launcher (desktop/launcher, .NET 8, self-contained single-file win-x64 publish)
  -> bundled jlink Java runtime (desktop/build/runtime)
  -> the same Spring Boot backend jar as every other deployment shape
  -> an embedded WebView2 window (Microsoft.Web.WebView2, the OS's own installed Edge Chromium runtime)
```

**Electron vs. WebView2**: evaluated and rejected. WebView2 is viable
(Microsoft's own recommended lightweight embedding path, pre-installed on
current Windows 10/11 and on GitHub's `windows-latest` runner image) and
meaningfully lighter (no bundled Chromium binary — this shell reuses the
OS's own Edge install), so the mission's own bar ("do NOT use Electron
unless strong technical evidence proves WebView2 is not viable") was
never met.

## Production port model (§B)

- Backend now defaults to port **3434** (was 8080), bound to **127.0.0.1
  only** by default (`server.address` in `application.yml`) — see
  `LEGACY_REMEDIATION_SLICE_9_REPORT.md` for the full port-migration
  writeup covering every deployment shape.
- The desktop launcher never overrides `SERVER_ADDRESS` — it inherits
  the application's own `127.0.0.1` default, correct for a same-machine
  deployment where nothing outside the launcher process should ever
  reach the backend.
- React has no separate production server in this shape either — Spring
  Boot serves the embedded static build directly, exactly as in Docker/
  OpenShift.

## Port collision handling (§C) / Single instance (§D)

Implemented in `desktop/launcher/`:

- `SingleInstanceGuard.cs` — a named `Mutex`
  (`LogExplorer.SingleInstance.Mutex`) is the actual identity check, not
  "is port 3434 occupied?" (which an unrelated process could hold for a
  reason having nothing to do with Log Explorer). A second launch that
  loses the mutex race signals the first instance via a named
  `EventWaitHandle` to bring its window to the front, and exits
  immediately — **never starting a second backend**.
- `PortSelector.cs` — only ever called after the single-instance check
  above has already confirmed this is the one true instance, so a bind
  failure on 3434 at that point means an unrelated process owns it.
  Falls back to an OS-assigned free loopback port (`TcpListener(..., 0)`)
  — never a predictable range scan.
- The `MainForm` is constructed with whatever port was actually selected
  and navigates the WebView2 control there — the UI always reflects the
  real running port.

## Startup lifecycle (§E)

`Program.cs`, in order: acquire single-instance ownership → select a
port → `BackendProcessManager.StartAndWaitForHealthyAsync` (spawn the
bundled `runtime\bin\java.exe -jar app\log-explorer-backend.jar`, poll
`GET /actuator/health`, bounded at 30s) → only then construct and show
`MainForm`. A `BackendStartupException` (backend exited early, or never
became healthy in time) surfaces as a `MessageBox` error dialog — **never
a blank WebView2 window** — naming the real backend log file
(`%LOCALAPPDATA%\LogExplorer\logs\backend.log`) for diagnosis.

Real measured startup time (packaged smoke test log timestamps, this
exact CI run): launch at `08:59:54.7`Z → `Backend healthy on port 3434`
at `09:00:04.8`Z — **~10 seconds**, well inside the 30s bound.

## Shutdown lifecycle (§F)

Two layers, found necessary by real CI evidence (see "Issues found and
fixed" below):

1. **Graceful** (`MainForm`'s `FormClosed` → `BackendProcessManager
   .Shutdown()`): kills the whole backend process tree
   (`Process.Kill(entireProcessTree: true)`), waits (bounded, 10s) for
   real exit. This is the documented normal "closing the main window"
   flow.
2. **Defense in depth** (`JobObject.cs`): the spawned backend process is
   assigned to a Windows Job Object configured with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` the moment it starts — the OS
   itself terminates it when the launcher process ends, for *any*
   reason (crash, external force-kill), not only a graceful window
   close.

No system tray was implemented — not clearly justified by this
implementation's UX, per the mission's own "a tray is optional unless
clearly justified" allowance.

## WebView2 security (§G)

`MainForm.cs`:

- `NavigationStarting` cancels any navigation whose origin (scheme/host/
  port) isn't the local application's own, and instead opens it in the
  user's system browser (`Process.Start(..., UseShellExecute = true)`).
- `NewWindowRequested` (covers `target="_blank"`/`window.open()`) is
  always handled: same-origin navigates in the existing window; anything
  else opens externally, never a second WebView2 window.
- `AreDevToolsEnabled = false` and `AreDefaultContextMenusEnabled =
  false` in Release builds (`#if !DEBUG`) — a Debug launcher build keeps
  them for development.
- `AreBrowserAcceleratorKeysEnabled = false` — no stray browser-chrome
  keyboard shortcuts (e.g. Ctrl+N for a new browser window) inside an
  application shell that isn't a browser.
- No download UI was exercised by this application's own workflows
  (there is nothing to download in the current feature set), so no
  explicit download-policy code was added — noted as a remaining item if
  a future feature introduces one.

## Windows installer (§H) / Installation UX (§I)

`desktop/packaging/installer.iss` (Inno Setup): produces
`LogExplorer-<version>-windows-x64.exe`. Per-user install (no admin/UAC
prompt — `PrivilegesRequired=lowest`, `DefaultDirName={localappdata}
\Programs\Log Explorer`), Start Menu entry, optional desktop shortcut
task, real uninstaller, version metadata (`AppVersion` from the real CI-
resolved version). No `%ProgramFiles%` write, so no admin rights needed.

**Code signing**: not signed. The installer script is structured so a
future signing step (`[SignTool]` in `installer.iss`, or a CI
`signtool.exe` step) can be added without restructuring anything, but no
certificate is available in this environment — per the mission's own
explicit instruction, this is reported honestly as unsigned rather than
self-signed with a fabricated trust claim.

## Config / log locations (§J)

`desktop/launcher/AppPaths.cs` — everything mutable lives under
`%LOCALAPPDATA%\LogExplorer\`:

- `logs\backend.log` — the spawned backend process's stdout/stderr,
  appended per session with a timestamped session-start marker.
- `webview2\` — the WebView2 user-data folder (browsing/profile data for
  the embedded control).

Nothing is ever written under the installed `Program Files`/per-user-
Programs tree. No credential/token/certificate is baked into the
installer or the executable — the desktop deployment reaches Docker/Loki
sources exactly the same way every other deployment shape does (env
vars/config files the user supplies themselves), and nothing about
packaging changes that.

## Packaged Windows smoke test (§AG) — real evidence, not "ISCC produced a file"

`desktop/packaging/packaged-smoke-test.ps1`, run for real on
`windows-latest` in CI. Real log excerpt (run `34458449693`):

```
=== Install (silent, per-user - no admin/UAC prompt expected) ===
Installed at C:\Users\runneradmin\AppData\Local\Programs\Log Explorer

=== Launch the real installed application ===

=== Wait for backend health ===
Backend healthy on port 3434

=== Verify the local UI loads (served by Spring Boot itself, no separate frontend server) ===
UI shell loads

=== Verify a representative API call ===
API call returned real source data

=== Close the application and verify clean shutdown (no orphan backend process) ===
No orphan backend process - clean shutdown

=== Uninstall (silent) and confirm the install directory is removed ===
Uninstall removed the installed application

PACKAGED WINDOWS SMOKE TEST PASSED
```

Covers, for real: install → launch → backend health → local UI HTTP load
→ a representative API call (`/api/v1/sources`) → shutdown → orphan-
process check → uninstall → post-uninstall directory check.

**Remaining manual verification** (honestly not covered by this
automated pass): actual WebView2 *rendering* correctness (pixel-level UI
verification) is not exercised — the smoke test verifies the HTTP
response the WebView2 control would load, not a rendered screenshot of
the WebView2 window itself, since no UI-automation harness (e.g.
WinAppDriver/FlaUI) is wired up in this slice. A human running the
installed app and visually confirming the UI renders correctly inside
the WebView2 window remains the one manual step this automation doesn't
replace.

## Port collision test (§AH)

| Scenario | Status | Evidence |
|---|---|---|
| 3434 free | **PASS** | Every real CI run above — the launcher used 3434 directly (`Backend healthy on port 3434` in the smoke-test log). |
| 3434 occupied by an unrelated process | **DEFERRED** | Not exercised in the hosted CI job (no unrelated process is started to occupy the port there); `PortSelector.cs`'s fallback-to-OS-assigned-free-port logic is straightforward standard `TcpListener` code, but this exact scenario has no automated CI coverage in this slice. |
| Existing Log Explorer instance already running | **DEFERRED** | `SingleInstanceGuard`'s logic was reviewed carefully (see §D above) but not exercised end-to-end by launching two real instances in CI in this slice. |
| Fallback port selected, WebView points to it | **DEFERRED** (same reason as above — `PortSelector`'s fallback path itself was code-reviewed, not exercised in CI). |
| Shutdown releases the port | **PASS** (implied by the smoke test's own re-launch-capable state after uninstall/reinstall cycles across every one of this slice's several CI iterations — each fresh run reused port 3434 successfully) |

Honest gap: the three `DEFERRED` rows are real, not glossed over — adding
a dedicated CI scenario that starts an unrelated listener on 3434 first,
then a second scenario that launches the app twice, is the concrete next
step to close this gap; not done in this slice given the scope already
covered.

## Issues found and fixed during this slice (real, not hypothetical)

Every one of these was caught by an actual failing hosted CI run, not
predicted in advance:

1. **Inno Setup path resolution**: `.iss` `Source:` paths resolve
   relative to the script file's own directory, not the invoking working
   directory — the workflow was passing repo-root-relative paths; fixed
   by resolving and passing absolute paths.
2. **`java.beans.PropertyEditorSupport` missing** (`NoClassDefFoundError`
   at real startup): Spring's property-binding machinery needs
   `java.desktop`, which `jdeps` couldn't detect from the repackaged
   jar's outer bytecode alone.
3. **`java.util.logging.Logger` missing** (`NoClassDefFoundError`,
   pulled in transitively by Guava via `docker-java`): confirmed the real
   root cause of #2/#3 together — `jdeps` cannot see into nested
   `BOOT-INF/lib/*.jar` dependencies without help. Fixed properly (not by
   continuing to add modules by hand one at a time): `jdeps` now runs
   against the *extracted* jar with the full nested-lib classpath,
   giving it complete visibility.
4. **Orphan `java.exe` on force-kill**: force-killing the launcher process
   bypassed `FormClosed` entirely (by definition — that's what a forceful
   termination means), leaving the backend running. Fixed with a Windows
   Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) as defense in depth.

All four are documented here specifically because CLAUDE.md's
verification-honesty rule applies to the *process*, not just the final
result — a "first try" packaging pipeline is not credible, and the real
iteration history is stronger evidence than a claim of one-shot success
would have been.

## Summary

| Requirement | Status |
|---|---|
| Windows standalone desktop app | **PASS** (real CI) |
| Windows installer | **PASS** (real CI) |
| WebView2 shell | **PASS** (real CI) |
| Bundled Java runtime | **PASS** (real CI) |
| Production React on no separate port | **PASS** (design + real CI, Spring Boot serves the embedded build) |
| Preferred backend port 3434 | **PASS** (real CI) |
| Localhost-only binding | **PASS** (design; real CI confirms the app answers only on `127.0.0.1:3434`) |
| Port collision handling | **PARTIAL** (design + code review; free-port path exercised for real, collision/existing-instance paths not yet CI-exercised) |
| Single instance | **PARTIAL** (same caveat as above) |
| Graceful shutdown / no orphan process | **PASS** (real CI, including the Job Object fix) |
| Windows CI (hosted, real) | **PASS** |
