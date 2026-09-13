package com.logexplorer.desktoplauncher;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * REL-1 (mirrors desktop/launcher/SingleInstanceGuard.cs): an OS-level
 * advisory exclusive file lock on {@link AppPaths#INSTANCE_LOCK_FILE} is
 * the identity check - not "is port 3434 occupied?", which an unrelated
 * process could hold for reasons having nothing to do with Log Explorer.
 * The lock is released automatically by the OS the moment this process
 * exits for any reason (normal exit, kill, crash), so no explicit
 * "second instance asks the first to activate" signalling channel is
 * needed the way the Windows launcher's named EventWaitHandle provides -
 * there is no owned window to bring to the front in this launcher's
 * design (see the module Javadoc on {@code Main}); a second launch
 * simply opens the browser to the already-running instance's address
 * (read from {@link AppPaths#RUNNING_PORT_FILE}) and exits.
 */
final class SingleInstanceGuard implements AutoCloseable {

    private final RandomAccessFile file;
    private final FileChannel channel;
    private final FileLock lock;

    private SingleInstanceGuard(RandomAccessFile file, FileChannel channel, FileLock lock) {
        this.file = file;
        this.channel = channel;
        this.lock = lock;
    }

    /**
     * Attempts to acquire the single-instance lock. Returns {@code null}
     * (never throws for the ordinary "another instance is already
     * running" case) if another Log Explorer process already holds it.
     */
    static SingleInstanceGuard tryAcquire() throws IOException {
        AppPaths.ensureDirectoriesExist();
        RandomAccessFile raf = new RandomAccessFile(AppPaths.INSTANCE_LOCK_FILE.toFile(), "rw");
        FileChannel ch = raf.getChannel();
        FileLock lock = ch.tryLock();
        if (lock == null) {
            ch.close();
            raf.close();
            return null;
        }
        return new SingleInstanceGuard(raf, ch, lock);
    }

    /** Records the port the running instance is bound to, for a second launch to read. */
    void recordRunningPort(int port) throws IOException {
        Files.writeString(AppPaths.RUNNING_PORT_FILE, Integer.toString(port), StandardCharsets.UTF_8);
    }

    @Override
    public void close() {
        try {
            lock.release();
        } catch (IOException ignored) {
            // Best-effort - the OS releases it on process exit regardless.
        }
        try {
            channel.close();
        } catch (IOException ignored) {
            // Best-effort cleanup.
        }
        try {
            file.close();
        } catch (IOException ignored) {
            // Best-effort cleanup.
        }
    }
}
