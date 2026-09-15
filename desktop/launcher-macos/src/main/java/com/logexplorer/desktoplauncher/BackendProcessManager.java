package com.logexplorer.desktoplauncher;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSource;
import java.time.Duration;
import java.time.Instant;

/**
 * REL-1 (mirrors desktop/launcher/BackendProcessManager.cs): owns the
 * bundled Spring Boot process's whole lifecycle - start (with the SAME
 * bundled runtime this launcher itself is running on, via
 * {@code java.home} - never a system-installed Java), a bounded
 * health-poll wait, and a shutdown that leaves no orphan process behind.
 *
 * <p>Unlike the Windows launcher, this launcher IS itself a JVM process,
 * so {@code System.getProperty("java.home")} already points at the
 * bundled custom runtime jpackage packaged the whole app with - there is
 * no separate "find the bundled JRE" path-guessing step the way the
 * native Windows launcher needs.
 */
final class BackendProcessManager {

    private static final Duration STARTUP_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration POLL_INTERVAL = Duration.ofMillis(500);
    private static final Duration SHUTDOWN_GRACE = Duration.ofSeconds(10);

    private final int port;
    private Process process;

    BackendProcessManager(int port) {
        this.port = port;
    }

    int getPort() {
        return port;
    }

    /**
     * Starts the bundled backend and waits (bounded) until its health
     * endpoint reports UP. Throws {@link BackendStartupException} (never
     * returns a "maybe it's fine" false) if it exits early or the
     * timeout elapses first.
     */
    void startAndWaitForHealthy() throws BackendStartupException, IOException {
        AppPaths.ensureDirectoriesExist();

        Path javaHome = Path.of(System.getProperty("java.home"));
        Path javaExe = javaHome.resolve("bin").resolve("java");
        Path backendJar = launcherDirectory().resolve("log-explorer-backend.jar");

        if (!Files.exists(javaExe)) {
            throw new BackendStartupException("Bundled Java runtime not found at \"" + javaExe + "\" - this build is incomplete.");
        }
        if (!Files.exists(backendJar)) {
            throw new BackendStartupException("Backend application jar not found at \"" + backendJar + "\" - this build is incomplete.");
        }

        ProcessBuilder builder = new ProcessBuilder(javaExe.toString(), "-jar", backendJar.toString());
        builder.environment().put("SERVER_PORT", Integer.toString(port));
        // Classification rules configuration lives under
        // ~/Library/Application Support/LogExplorer/data - never relative to
        // the process working directory or inside the replaceable .app bundle.
        builder.environment().put("LOGEXPLORER_DATA_DIR", AppPaths.DATA_DIRECTORY.toString());
        // Never SERVER_ADDRESS=0.0.0.0 here - the desktop deployment is
        // exactly the "same machine, nothing else should reach it" case
        // application.yml's own default (127.0.0.1) already covers.
        builder.redirectErrorStream(true);
        builder.redirectOutput(ProcessBuilder.Redirect.appendTo(AppPaths.BACKEND_LOG_FILE.toFile()));

        Files.writeString(
            AppPaths.BACKEND_LOG_FILE,
            "--- Log Explorer launcher session started " + Instant.now() + ", port " + port + " ---" + System.lineSeparator(),
            java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);

        try {
            process = builder.start();
        } catch (IOException e) {
            throw new BackendStartupException("Failed to start the bundled backend process: " + e.getMessage());
        }

        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        URI healthUri = URI.create("http://127.0.0.1:" + port + "/actuator/health");
        Instant deadline = Instant.now().plus(STARTUP_TIMEOUT);

        while (Instant.now().isBefore(deadline)) {
            if (!process.isAlive()) {
                throw new BackendStartupException(
                    "The backend process exited early (code " + process.exitValue() + ") during startup. See " + AppPaths.BACKEND_LOG_FILE + " for details.");
            }
            try {
                HttpRequest request = HttpRequest.newBuilder(healthUri).timeout(Duration.ofSeconds(2)).GET().build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.body().contains("\"status\":\"UP\"")) {
                    return;
                }
            } catch (Exception notYetUp) {
                // Not up yet (connection refused / not listening yet) - expected during startup, keep polling.
            }
            sleepQuietly(POLL_INTERVAL);
        }

        throw new BackendStartupException(
            "The backend did not report healthy within " + STARTUP_TIMEOUT.toSeconds() + "s. See " + AppPaths.BACKEND_LOG_FILE + " for details.");
    }

    /** Terminates the backend process and waits (bounded) for it to actually exit. Safe to call more than once. */
    void shutdown() {
        if (process == null || !process.isAlive()) {
            return;
        }
        process.descendants().forEach(ProcessHandle::destroyForcibly);
        process.destroy();
        try {
            if (!process.waitFor(SHUTDOWN_GRACE.toSeconds(), java.util.concurrent.TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    private static Path launcherDirectory() {
        try {
            CodeSource source = BackendProcessManager.class.getProtectionDomain().getCodeSource();
            Path jarPath = Path.of(source.getLocation().toURI());
            return jarPath.getParent();
        } catch (Exception e) {
            throw new IllegalStateException("Could not determine the running launcher jar's own directory.", e);
        }
    }

    private static void sleepQuietly(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    static final class BackendStartupException extends Exception {
        BackendStartupException(String message) {
            super(message);
        }
    }
}
