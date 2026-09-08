package com.logexplorer.source.docker;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.command.InspectContainerResponse;
import com.github.dockerjava.api.model.Container;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.Version;
import java.io.Closeable;
import java.io.IOException;
import java.util.List;

/**
 * Narrow, read-only facade over the real {@link DockerClient}
 * (IMPLEMENTATION_PLAN.md "Phase C" scope item 6: "Strictly read-only. No
 * API path may start/stop/create/remove/exec/mutate").
 *
 * <p>This is the enforcement mechanism, not a convention: {@link
 * DockerLogSource} and everything else in {@code source.docker} depends
 * only on this type, which exposes exactly five operations
 * (list/inspect/logs/ping/version) — mutating methods on the real {@link
 * DockerClient} (start/stop/create/remove/exec/...) are structurally
 * unreachable from this codebase, not merely unused. {@code
 * ReadOnlyDockerClientMethodSetTest} locks this class's own public method
 * set so it cannot quietly grow an unsafe one later.
 */
public class ReadOnlyDockerClient implements Closeable {

  private final DockerClient delegate;

  public ReadOnlyDockerClient(DockerClient delegate) {
    this.delegate = delegate;
  }

  public List<Container> listContainers(boolean includeStopped) {
    return delegate.listContainersCmd().withShowAll(includeStopped).exec();
  }

  public InspectContainerResponse inspectContainer(String containerId) {
    return delegate.inspectContainerCmd(containerId).exec();
  }

  /**
   * @param sinceEpochSeconds {@code null} for no lower bound
   * @param untilEpochSeconds {@code null} for no upper bound
   * @param tailLines {@code null} for "all" (still bounded by the caller's own limits)
   */
  public <T extends ResultCallback<Frame>> T readLogs(
      String containerId,
      boolean stdout,
      boolean stderr,
      boolean timestamps,
      Integer sinceEpochSeconds,
      Integer untilEpochSeconds,
      Integer tailLines,
      T callback) {
    var cmd = delegate.logContainerCmd(containerId)
        .withStdOut(stdout)
        .withStdErr(stderr)
        .withTimestamps(timestamps)
        .withFollowStream(false);
    if (sinceEpochSeconds != null) {
      cmd = cmd.withSince(sinceEpochSeconds);
    }
    if (untilEpochSeconds != null) {
      cmd = cmd.withUntil(untilEpochSeconds);
    }
    if (tailLines != null) {
      cmd = cmd.withTail(tailLines);
    } else {
      cmd = cmd.withTailAll();
    }
    return cmd.exec(callback);
  }

  public void ping() {
    delegate.pingCmd().exec();
  }

  public Version version() {
    return delegate.versionCmd().exec();
  }

  @Override
  public void close() throws IOException {
    delegate.close();
  }
}
