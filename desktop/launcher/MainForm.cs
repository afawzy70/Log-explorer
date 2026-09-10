using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §G: the WebView2 surface is an application
/// window, not a general browser - navigation stays scoped to the local
/// Log Explorer origin, external links open in the user's normal system
/// browser instead of turning this window into one, and devtools are off
/// in release builds. §E: never shown until the caller has already
/// confirmed the backend is healthy (see Program.cs), so this form's own
/// constructor never needs a "still loading" state of its own beyond
/// WebView2's normal (fast, same-machine) page load.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly Uri _appOrigin;
    private readonly WebView2 _webView;

    public MainForm(Uri appOrigin)
    {
        _appOrigin = appOrigin;

        Text = "Log Explorer";
        Width = 1440;
        Height = 900;
        StartPosition = FormStartPosition.CenterScreen;
        try
        {
            Icon = new Icon(Path.Combine(AppContext.BaseDirectory, "Resources", "app.ico"));
        }
        catch (Exception)
        {
            // A missing/unreadable icon file must never prevent the app from opening.
        }

        _webView = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeWebViewAsync().ConfigureAwait(true);
    }

    private async Task InitializeWebViewAsync()
    {
        var userDataFolder = Path.Combine(AppPaths.LocalAppDataRoot, "webview2");
        Directory.CreateDirectory(userDataFolder);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder).ConfigureAwait(true);
        await _webView.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

        var core = _webView.CoreWebView2;

#if !DEBUG
        // Production only - a Debug launcher build keeps devtools available for development.
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
#endif
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        // A target="_blank"/window.open() request never opens a second
        // WebView2 window - it is either the same local origin (rare, but
        // handled by simply redirecting this same window) or, far more
        // commonly, a genuine external link, which belongs in the user's
        // normal browser, never inside this application shell.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            var uri = new Uri(e.Uri);
            if (IsAppOrigin(uri))
            {
                _webView.CoreWebView2.Navigate(e.Uri);
            }
            else
            {
                OpenExternally(uri);
            }
        };

        // Any top-level navigation away from the local application origin
        // (a link inside the app pointing off-site, for example) is
        // redirected to the system browser instead of following it here -
        // this window only ever shows the Log Explorer application itself.
        core.NavigationStarting += (_, e) =>
        {
            var uri = new Uri(e.Uri);
            if (!IsAppOrigin(uri))
            {
                e.Cancel = true;
                OpenExternally(uri);
            }
        };

        core.Navigate(_appOrigin.ToString());
    }

    private bool IsAppOrigin(Uri uri) =>
        uri.Scheme == _appOrigin.Scheme && uri.Host == _appOrigin.Host && uri.Port == _appOrigin.Port;

    private static void OpenExternally(Uri uri)
    {
        try
        {
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
        catch
        {
            // A failure to launch the system browser must never crash the app or leave it in a stuck navigation state.
        }
    }
}
