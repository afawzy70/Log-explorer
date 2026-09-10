; Legacy Remediation Slice 9 §H/§I: the Windows installer. Built with Inno
; Setup (a single, maintainable script - no WiX XML verbosity, no extra
; build toolchain beyond ISCC.exe, which the Windows CI workflow installs)
; rather than jpackage: jpackage packages a *Java* application directly,
; but this product's actual entry point is the WinForms/WebView2 launcher
; (desktop/launcher) with the backend as a bundled child artifact, not the
; other way around - a plain installer script that lays out
; launcher.exe + runtime/ + app/*.jar side by side is the simpler,
; equally maintainable fit for that shape.
;
; Version, source paths, and the output filename are all passed in from
; the CI workflow via /D defines so this script never hardcodes a stale
; version number:
;   iscc /DMyAppVersion=1.2.3 /DPublishDir=..\build\launcher-publish
;        /DRuntimeDir=..\build\runtime /DAppJar=..\build\app\log-explorer-backend.jar
;        desktop\packaging\installer.iss

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#ifndef PublishDir
  #define PublishDir "..\build\launcher-publish"
#endif
#ifndef RuntimeDir
  #define RuntimeDir "..\build\runtime"
#endif
#ifndef AppJar
  #define AppJar "..\build\app\log-explorer-backend.jar"
#endif

#define MyAppName "Log Explorer"
#define MyAppPublisher "Log Explorer"
#define MyAppExeName "LogExplorerLauncher.exe"

[Setup]
AppId={{9F1B7C3E-4C7B-4F2C-9C1E-2A7B7D9C4B10}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install (no admin/UAC elevation required) - deliberate: this is
; a single-user desktop tool, not a machine-wide service, so there is no
; real need to write to Program Files, and a per-user install is what lets
; the packaged Windows smoke test (§AG) actually install and launch the
; real product headlessly in CI (an admin-elevated install would block on
; a UAC prompt with no interactive session to approve it). Uninstall
; support and a real Start Menu entry both still work identically at this
; scope - neither requires a machine-wide install location.
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build\installer
OutputBaseFilename=LogExplorer-{#MyAppVersion}-windows-x64
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
; Ready for a future signing certificate (mission §I: "Make the
; build/signing path ready... Do NOT require a real signing certificate
; if one is unavailable. Do NOT silently generate self-signed production
; trust claims.") - SignTool is only invoked when the CI workflow
; actually supplies SIGNTOOL_PATH/a real certificate; ISCC.exe silently
; skips signing entirely when no [SignTool] step is configured, which is
; exactly the "no cert available -> unsigned build, not a fake one" bar.
; See docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md for the actual
; current (unsigned) status.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RuntimeDir}\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#AppJar}"; DestDir: "{app}\app"; DestName: "log-explorer-backend.jar"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The launcher's own per-user data (backend logs, WebView2 user data
; folder) lives under %LOCALAPPDATA%\LogExplorer (see AppPaths.cs), never
; under the installed Program Files tree, so a normal uninstall - which
; only removes {app} - never needs to (and does not) touch it; a user's
; own logs survive an uninstall/reinstall, matching the documented
; per-user-data-directory policy (mission §J).
