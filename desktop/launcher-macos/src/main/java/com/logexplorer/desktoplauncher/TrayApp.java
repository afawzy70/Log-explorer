package com.logexplorer.desktoplauncher;

import java.awt.AWTException;
import java.awt.Desktop;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.RenderingHints;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.geom.Ellipse2D;
import java.awt.image.BufferedImage;
import java.net.URI;

/**
 * REL-1: the macOS "shell" around the product - a menu-bar (SystemTray)
 * icon with "Open Log Explorer" (opens the system default browser to the
 * running backend's local origin) and "Quit" (graceful backend shutdown,
 * then exit). This is the deliberate v1 design difference from the
 * Windows launcher's embedded WebView2 window - see the module Javadoc
 * on {@link Main} and REL-1 §9 of the verification report for the full
 * rationale. {@link SystemTray} is part of the standard {@code
 * java.desktop} module and works on macOS without any native/Swift code.
 */
final class TrayApp {

    private final URI appOrigin;
    private final Runnable onQuit;

    TrayApp(URI appOrigin, Runnable onQuit) {
        this.appOrigin = appOrigin;
        this.onQuit = onQuit;
    }

    void show() throws AWTException {
        if (!SystemTray.isSupported()) {
            // No menu bar tray available (unusual, but must never crash
            // the app) - fall back to simply opening the browser once;
            // Quit is then just closing the browser tab / the process
            // itself is still reachable via normal OS process management.
            openBrowser();
            return;
        }

        SystemTray tray = SystemTray.getSystemTray();
        PopupMenu menu = new PopupMenu();

        MenuItem openItem = new MenuItem("Open Log Explorer");
        openItem.addActionListener(e -> openBrowser());
        menu.add(openItem);

        menu.addSeparator();

        MenuItem quitItem = new MenuItem("Quit Log Explorer");
        quitItem.addActionListener(e -> {
            tray.remove(tray.getTrayIcons()[0]);
            onQuit.run();
        });
        menu.add(quitItem);

        TrayIcon icon = new TrayIcon(renderIcon(), "Log Explorer", menu);
        icon.setImageAutoSize(true);
        icon.addActionListener(e -> openBrowser());
        tray.add(icon);

        // Same behavior as the Windows launcher opening its window
        // immediately on startup - the app is genuinely ready (this is
        // only called after BackendProcessManager confirms UP).
        openBrowser();
    }

    private void openBrowser() {
        try {
            Desktop.getDesktop().browse(appOrigin);
        } catch (Exception e) {
            // A failure to launch the system browser must never crash
            // the app or leave it in a stuck state - the tray icon
            // itself remains available for a retry.
        }
    }

    /**
     * A simple, programmatically-drawn tray icon - no external image
     * asset dependency for this v1. Replacing this with the product's
     * real designed icon (converted from desktop/launcher/Resources/app.ico
     * to a proper macOS asset) is tracked as a FUTURE_IMPROVEMENT, not
     * silently skipped.
     */
    private static Image renderIcon() {
        int size = 32;
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new java.awt.Color(0x2E, 0x5A, 0xAC));
        g.fill(new Ellipse2D.Double(2, 2, size - 4, size - 4));
        g.setColor(java.awt.Color.WHITE);
        g.setFont(g.getFont().deriveFont(java.awt.Font.BOLD, 16f));
        g.drawString("L", 11, 22);
        g.dispose();
        return image;
    }
}
