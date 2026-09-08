package com.logexplorer.source.docker;

import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.StreamType;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Collects a bounded number of log lines from one container's log stream.
 *
 * <p>Docker frame boundaries are not guaranteed to be line-aligned — a
 * single log line can arrive split across multiple {@link Frame}s, so
 * bytes are buffered per stream (stdout/stderr/raw) until a full line (or
 * end of stream) is available (IMPLEMENTATION_PLAN.md "Phase C" scope item
 * 4: "correct framing incl. Tty=true containers").
 *
 * <p>{@code Tty=true} containers are not multiplexed by Docker at all —
 * {@code docker-java} reports their frames as {@link StreamType#RAW}
 * rather than STDOUT/STDERR; those are treated as {@code "stdout"} here
 * since there is nothing to distinguish them by.
 *
 * <p>Bounded: stops accumulating (but keeps draining frames, so the
 * upstream call still completes cleanly) once {@code maxLines} is reached
 * — no unbounded buffers regardless of how noisy a container is.
 */
public class DockerFrameCollectingCallback extends ResultCallback.Adapter<Frame> {

  private final int maxLines;
  private final List<DockerLogLine> lines = new CopyOnWriteArrayList<>();
  private final ByteArrayOutputStream stdoutBuffer = new ByteArrayOutputStream();
  private final ByteArrayOutputStream stderrBuffer = new ByteArrayOutputStream();

  public DockerFrameCollectingCallback(int maxLines) {
    this.maxLines = maxLines;
  }

  @Override
  public void onNext(Frame frame) {
    String streamName = streamNameFor(frame.getStreamType());
    ByteArrayOutputStream buffer = frame.getStreamType() == StreamType.STDERR ? stderrBuffer : stdoutBuffer;
    buffer.write(frame.getPayload(), 0, frame.getPayload().length);
    drainCompleteLines(buffer, streamName);
  }

  @Override
  public void onComplete() {
    flushTrailingPartialLine(stdoutBuffer, "stdout");
    flushTrailingPartialLine(stderrBuffer, "stderr");
    super.onComplete();
  }

  public List<DockerLogLine> lines() {
    return List.copyOf(lines);
  }

  private String streamNameFor(StreamType type) {
    return type == StreamType.STDERR ? "stderr" : "stdout";
  }

  private void drainCompleteLines(ByteArrayOutputStream buffer, String streamName) {
    if (lines.size() >= maxLines) {
      buffer.reset();
      return;
    }
    byte[] bytes = buffer.toByteArray();
    int start = 0;
    List<String> completeLines = new ArrayList<>();
    for (int i = 0; i < bytes.length; i++) {
      if (bytes[i] == '\n') {
        completeLines.add(new String(bytes, start, i - start, StandardCharsets.UTF_8));
        start = i + 1;
      }
    }
    buffer.reset();
    if (start < bytes.length) {
      buffer.write(bytes, start, bytes.length - start);
    }
    for (String line : completeLines) {
      if (lines.size() >= maxLines) {
        break;
      }
      addLine(line, streamName);
    }
  }

  private void flushTrailingPartialLine(ByteArrayOutputStream buffer, String streamName) {
    if (lines.size() >= maxLines) {
      return;
    }
    byte[] remaining = buffer.toByteArray();
    if (remaining.length > 0) {
      addLine(new String(remaining, StandardCharsets.UTF_8), streamName);
    }
  }

  private void addLine(String rawLineWithDockerTimestamp, String streamName) {
    int spaceIdx = rawLineWithDockerTimestamp.indexOf(' ');
    Instant dockerTimestamp = null;
    String content = rawLineWithDockerTimestamp;
    if (spaceIdx > 0) {
      String prefix = rawLineWithDockerTimestamp.substring(0, spaceIdx);
      try {
        dockerTimestamp = Instant.parse(prefix);
        content = rawLineWithDockerTimestamp.substring(spaceIdx + 1);
      } catch (DateTimeParseException e) {
        // Not a timestamp prefix after all (shouldn't happen since every
        // call requests withTimestamps(true), but never let a parse
        // failure here corrupt or drop the line itself).
      }
    }
    lines.add(new DockerLogLine(dockerTimestamp, streamName, content));
  }
}
