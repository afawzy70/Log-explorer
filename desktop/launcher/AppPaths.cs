namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §J: every mutable, per-user path the
/// launcher touches lives under <c>%LOCALAPPDATA%\LogExplorer</c> -
/// never inside the installed Program Files tree (which an installed
/// application cannot reliably write to, and never should). Currently
/// this is the backend's own log file and the backend's classification
/// rules configuration (<see cref="DataDirectory"/>). The backend still
/// has no local database (CLAUDE.md §8 - "no application database" is a
/// whole-project invariant, not just the server-side scope): the rules
/// are a small JSON configuration file, never log data.
/// </summary>
internal static class AppPaths
{
    public static string LocalAppDataRoot { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LogExplorer");

    public static string LogsDirectory { get; } = Path.Combine(LocalAppDataRoot, "logs");

    /// <summary>
    /// Passed to the backend as <c>LOGEXPLORER_DATA_DIR</c>; the backend
    /// writes <c>classification-rules.json</c> (plus its <c>.bak</c>) here
    /// on the first rule save and creates the directory itself. Deliberately
    /// outside the per-user install directory
    /// (<c>%LOCALAPPDATA%\Programs\Log Explorer</c>, replaced on upgrade and
    /// removed on uninstall), so rules survive upgrades and reinstalls.
    /// </summary>
    public static string DataDirectory { get; } = Path.Combine(LocalAppDataRoot, "data");

    public static string BackendLogFile { get; } = Path.Combine(LogsDirectory, "backend.log");

    public static void EnsureDirectoriesExist()
    {
        Directory.CreateDirectory(LogsDirectory);
    }
}
