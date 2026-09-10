using System.Diagnostics;
using System.Net.Http;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §E/§F: owns the bundled Spring Boot
/// process's whole lifecycle - start (with the bundled JRE, never a
/// system-installed Java), bounded health-poll wait, and a shutdown that
/// leaves no orphan process behind. One instance per launcher process;
/// disposed exactly once, from the UI thread's own form-closing handler.
/// </summary>
internal sealed class BackendProcessManager : IDisposable
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan ShutdownGrace = TimeSpan.FromSeconds(10);

    private Process? _process;

    public int Port { get; }

    public BackendProcessManager(int port)
    {
        Port = port;
    }

    /// <summary>
    /// Starts the bundled backend and waits (bounded) until its health
    /// endpoint reports UP. Throws <see cref="BackendStartupException"/>
    /// (never returns a "maybe it's fine" false) if it exits early or the
    /// timeout elapses first - the caller (Program.cs) turns that into a
    /// clear startup-failure dialog rather than opening a blank WebView2
    /// window against a backend that never came up (mission §E: "Do not
    /// open a blank WebView while Spring Boot is still unavailable").
    /// </summary>
    public async Task StartAndWaitForHealthyAsync(CancellationToken cancellationToken)
    {
        AppPaths.EnsureDirectoriesExist();

        var baseDir = AppContext.BaseDirectory;
        var javaExe = Path.Combine(baseDir, "runtime", "bin", "java.exe");
        var jarPath = Path.Combine(baseDir, "app", "log-explorer-backend.jar");

        if (!File.Exists(javaExe))
        {
            throw new BackendStartupException($"Bundled Java runtime not found at \"{javaExe}\" - this build is incomplete.");
        }
        if (!File.Exists(jarPath))
        {
            throw new BackendStartupException($"Backend application jar not found at \"{jarPath}\" - this build is incomplete.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = javaExe,
            ArgumentList = { "-jar", jarPath },
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = baseDir,
        };
        // Never SERVER_ADDRESS=0.0.0.0 here - the desktop deployment is
        // exactly the "same machine, nothing else should reach it" case
        // application.yml's own default (127.0.0.1) already covers, so
        // this is deliberately NOT overridden.
        startInfo.EnvironmentVariables["SERVER_PORT"] = Port.ToString();

        _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };

        var logWriter = new StreamWriter(new FileStream(AppPaths.BackendLogFile, FileMode.Append, FileAccess.Write, FileShare.Read))
        {
            AutoFlush = true,
        };
        logWriter.WriteLine($"--- Log Explorer launcher session started {DateTimeOffset.Now:O}, port {Port} ---");

        _process.OutputDataReceived += (_, e) => { if (e.Data != null) { logWriter.WriteLine(e.Data); } };
        _process.ErrorDataReceived += (_, e) => { if (e.Data != null) { logWriter.WriteLine(e.Data); } };

        if (!_process.Start())
        {
            throw new BackendStartupException("Failed to start the bundled backend process.");
        }
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var healthUrl = $"http://127.0.0.1:{Port}/actuator/health";
        var deadline = DateTimeOffset.UtcNow + StartupTimeout;

        while (DateTimeOffset.UtcNow < deadline)
        {
            if (_process.HasExited)
            {
                throw new BackendStartupException(
                    $"The backend process exited early (code {_process.ExitCode}) during startup. See {AppPaths.BackendLogFile} for details.");
            }

            try
            {
                var response = await http.GetStringAsync(healthUrl, cancellationToken).ConfigureAwait(false);
                if (response.Contains("\"status\":\"UP\"", StringComparison.Ordinal))
                {
                    return;
                }
            }
            catch
            {
                // Not up yet (connection refused / not listening yet) - expected during startup, keep polling.
            }

            await Task.Delay(PollInterval, cancellationToken).ConfigureAwait(false);
        }

        throw new BackendStartupException(
            $"The backend did not report healthy within {StartupTimeout.TotalSeconds:0}s. See {AppPaths.BackendLogFile} for details.");
    }

    /// <summary>
    /// Terminates the whole backend process tree and waits (bounded) for
    /// it to actually exit - mission §F: "Do not leave invisible orphan
    /// Java processes." Safe to call more than once and safe to call when
    /// the process never started.
    /// </summary>
    public void Shutdown()
    {
        if (_process is null)
        {
            return;
        }
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit((int)ShutdownGrace.TotalMilliseconds);
            }
        }
        catch (InvalidOperationException)
        {
            // Already exited between the HasExited check and Kill() - nothing left to do.
        }
    }

    public void Dispose()
    {
        Shutdown();
        _process?.Dispose();
    }
}

/// <summary>Thrown when the bundled backend cannot be started or does not become healthy in time.</summary>
internal sealed class BackendStartupException : Exception
{
    public BackendStartupException(string message) : base(message)
    {
    }
}
