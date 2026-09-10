namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §J: every mutable, per-user path the
/// launcher touches lives under <c>%LOCALAPPDATA%\LogExplorer</c> -
/// never inside the installed Program Files tree (which an installed
/// application cannot reliably write to, and never should). Currently
/// this is only the backend's own log file; the backend itself has no
/// local database or other persisted state (CLAUDE.md §8 - "no
/// application database" is a whole-project invariant, not just the
/// server-side scope).
/// </summary>
internal static class AppPaths
{
    public static string LocalAppDataRoot { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LogExplorer");

    public static string LogsDirectory { get; } = Path.Combine(LocalAppDataRoot, "logs");

    public static string BackendLogFile { get; } = Path.Combine(LogsDirectory, "backend.log");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(LogsDirectory);
    }
}
