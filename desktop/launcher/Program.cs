using System.Windows.Forms;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §E: the full startup lifecycle in one
/// place, in order - (1) single-instance ownership, (2) port selection,
/// (3) start the bundled backend, (4) wait for a bounded health signal,
/// (5) only then open the WebView2 window, (6) a clear failure dialog
/// (never a blank window) if any step before that fails.
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using var guard = SingleInstanceGuard.Acquire();
        if (!guard.IsFirstInstance)
        {
            // §C/§D: another Log Explorer instance is already running -
            // never start a second backend. Ask it to bring itself to the
            // front and exit immediately.
            guard.RequestActivationOfExistingInstance();
            return;
        }

        using var cts = new CancellationTokenSource();
        var port = PortSelector.SelectPort();
        using var backend = new BackendProcessManager(port);

        try
        {
            backend.StartAndWaitForHealthyAsync(cts.Token).GetAwaiter().GetResult();
        }
        catch (BackendStartupException ex)
        {
            // §E: a clear failure dialog, never an empty/blank WebView2 window.
            MessageBox.Show(ex.Message, "Log Explorer failed to start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var form = new MainForm(new Uri($"http://127.0.0.1:{port}/"));

        guard.WatchForActivationRequests(
            () =>
            {
                if (form.IsHandleCreated)
                {
                    form.BeginInvoke(new Action(() =>
                    {
                        if (form.WindowState == FormWindowState.Minimized)
                        {
                            form.WindowState = FormWindowState.Normal;
                        }
                        form.Activate();
                    }));
                }
            },
            cts.Token);

        form.FormClosed += (_, _) =>
        {
            // §F: graceful shutdown - cancel the activation watcher and
            // terminate the whole backend process tree before this
            // process itself exits, so nothing is left orphaned.
            cts.Cancel();
            backend.Shutdown();
        };

        Application.Run(form);
    }
}
