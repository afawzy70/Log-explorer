package com.logexplorer.desktoplauncher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * REL-1 (mirrors desktop/launcher/AppPaths.cs): every mutable, per-user
 * path this launcher touches lives under
 * {@code ~/Library/Application Support/LogExplorer} - never inside the
 * installed .app bundle (which a packaged application should not write
 * to). Currently this is only the backend's own log file, the launcher's
 * own single-instance lock file, and a small file recording the port the
 * running instance is bound to (so a second launch can open the browser
 * to the correct address instead of guessing).
 */
final class AppPaths {

    static final Path LOCAL_APP_DATA_ROOT =
        Path.of(System.getProperty("user.home"), "Library", "Application Support", "LogExplorer");

    static final Path LOGS_DIRECTORY = LOCAL_APP_DATA_ROOT.resolve("logs");

    static final Path BACKEND_LOG_FILE = LOGS_DIRECTORY.resolve("backend.log");

    static final Path INSTANCE_LOCK_FILE = LOCAL_APP_DATA_ROOT.resolve("instance.lock");

    static final Path RUNNING_PORT_FILE = LOCAL_APP_DATA_ROOT.resolve("running-port.txt");

    private AppPaths() {
    }

    static void ensureDirectoriesExist() throws IOException {
        Files.createDirectories(LOGS_DIRECTORY);
    }
}
