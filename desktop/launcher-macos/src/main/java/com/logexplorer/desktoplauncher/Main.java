package com.logexplorer.desktoplauncher;

import java.awt.Desktop;
import java.io.IOException;
import java.net.URI;

/**
 * REL-1: the macOS desktop launcher entry point - the full startup
 * lifecycle in one place, in order, mirroring desktop/launcher/Program.cs
 * exactly except for the final "chrome" step: (1) single-instance
 * ownership, (2) port selection, (3) start the bundled backend, (4) wait
 * for a bounded health signal, (5) only then show the menu-bar tray icon
 * and open the system browser, (6) a clear failure dialog (never a
 * silent no-op) if any step before that fails.
 *
 * <p><b>Why no embedded native window on macOS (v1 design decision):</b>
 * the Windows launcher hosts the product inside a native WebView2
 * application window. Building the equivalent on macOS means either a
 * native Swift/AppKit WKWebView shell (a real Xcode project, outside
 * this repository's existing Java/C# toolchain, and not verifiable
 * without direct access to a macOS development environment) or a
 * JavaFX WebView (a large additional runtime dependency to bundle). This
 * v1 instead starts the same bundled backend and opens the system's
 * default browser, with a menu-bar (SystemTray) icon providing "Open"
 * and "Quit" - same product, same backend, same API, only the desktop
 * chrome differs. Recorded as a deliberate, documented v1 scope decision
 * (REL-1 §9 of the verification report), with an embedded native web
 * view tracked as a FUTURE_IMPROVEMENT, not silently dropped.
 */
public final class Main {

    private Main() {
    }

    public static void main(String[] args) {
        SingleInstanceGuard guard;
        try {
            guard = SingleInstanceGuard.tryAcquire();
        } catch (IOException e) {
            showFailure("Could not acquire the single-instance lock: " + e.getMessage());
            return;
        }

        if (guard == null) {
            // Another instance is already running - never start a second
            // backend. Read its recorded port and just open the browser
            // to it, then exit immediately.
            openBrowserToRunningInstance();
            return;
        }

        int port = PortSelector.selectPort();
        BackendProcessManager backend = new BackendProcessManager(port);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            backend.shutdown();
            guard.close();
        }, "LogExplorer-ShutdownHook"));

        try {
            backend.startAndWaitForHealthy();
        } catch (Exception e) {
            showFailure(e.getMessage());
            backend.shutdown();
            guard.close();
            return;
        }

        try {
            guard.recordRunningPort(port);
        } catch (IOException e) {
            // Non-fatal - a second launch just won't find the port file
            // and will show a "could not determine" message instead of
            // silently opening the wrong address; the running instance
            // itself is unaffected.
        }

        URI appOrigin = URI.create("http://127.0.0.1:" + port + "/");
        try {
            new TrayApp(appOrigin, () -> {
                backend.shutdown();
                guard.close();
                System.exit(0);
            }).show();
        } catch (Exception e) {
            showFailure("Could not create the menu-bar tray icon: " + e.getMessage());
            backend.shutdown();
            guard.close();
        }

        // The AWT event dispatch thread (started implicitly by
        // SystemTray/TrayIcon above) keeps the JVM alive; main() returning
        // here is expected and correct - shutdown happens via the Quit
        // menu item or the shutdown hook above, not by main() blocking.
    }

    private static void openBrowserToRunningInstance() {
        try {
            String portText = java.nio.file.Files.readString(AppPaths.RUNNING_PORT_FILE).trim();
            Desktop.getDesktop().browse(URI.create("http://127.0.0.1:" + portText + "/"));
        } catch (Exception e) {
            showFailure("Log Explorer is already running, but its address could not be determined. Look for the Log Explorer icon in the menu bar.");
        }
    }

    private static void showFailure(String message) {
        System.err.println("Log Explorer failed to start: " + message);
        try {
            if (java.awt.GraphicsEnvironment.isHeadless()) {
                return;
            }
            javax.swing.JOptionPane.showMessageDialog(
                null, message, "Log Explorer failed to start", javax.swing.JOptionPane.ERROR_MESSAGE);
        } catch (Exception ignored) {
            // A failure to even show the failure dialog must not throw further - the stderr line above is the fallback.
        }
    }
}
