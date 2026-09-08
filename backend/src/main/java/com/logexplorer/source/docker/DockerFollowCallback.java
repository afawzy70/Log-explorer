package com.logexplorer.source.docker;

import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.StreamType;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.function.Consumer;

/**
 * Live-tail frame-to-line assembler (IMPLEMENTATION_PLAN.md "Phase J") -
 * the unbounded-duration counterpart to {@link DockerFrameCollectingCallback}:
 * emits each complete line to {@code onLine} as soon as it is assembled,
 * indefinitely, rather than collecting a bounded list and stopping. The
 * framing logic itself (frame boundaries are never line-aligned, incl.
 * {@code Tty=true} containers - IMPLEMENTATION_PLAN.md "Phase C" scope
 * item 4) mirrors that class's, since the wire format is identical
 * regardless of {@code follow} mode; kept as its own small, self-contained
 * class rather than an extraction, since the two callbacks' termination/
 * collection semantics genuinely differ (bounded list vs. indefinite push
 * to a live sink) and this framing logic is short enough that forcing a
 * shared abstraction over it would cost more than it saves.
 */
public class DockerFollowCallback extends ResultCallback.Adapter<Frame> {

  private final Consumer<DockerLogLine> onLine;
  private final Runnable onTerminate;
  private final ByteArrayOutputStream stdoutBuffer = new ByteArrayOutputStream();
  private final ByteArrayOutputStream stderrBuffer = new ByteArrayOutputStream();

  public DockerFollowCallback(Consumer<DockerLogLine> onLine, Runnable onTerminate) {
    this.onLine = onLine;
    this.onTerminate = onTerminate;
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
    onTerminate.run();
    super.onComplete();
  }

  @Override
  public void onError(Throwable throwable) {
    onTerminate.run();
    super.onError(throwable);
  }

  private String streamNameFor(StreamType type) {
    return type == StreamType.STDERR ? "stderr" : "stdout";
  }

  private void drainCompleteLines(ByteArrayOutputStream buffer, String streamName) {
    byte[] bytes = buffer.toByteArray();
    int start = 0;
    for (int i = 0; i < bytes.length; i++) {
      if (bytes[i] == '\n') {
        emitLine(new String(bytes, start, i - start, StandardCharsets.UTF_8), streamName);
        start = i + 1;
      }
    }
    buffer.reset();
    if (start < bytes.length) {
      buffer.write(bytes, start, bytes.length - start);
    }
  }

  private void emitLine(String rawLineWithDockerTimestamp, String streamName) {
    int spaceIdx = rawLineWithDockerTimestamp.indexOf(' ');
    Instant dockerTimestamp = null;
    String content = rawLineWithDockerTimestamp;
    if (spaceIdx > 0) {
      String prefix = rawLineWithDockerTimestamp.substring(0, spaceIdx);
      try {
        dockerTimestamp = Instant.parse(prefix);
        content = rawLineWithDockerTimestamp.substring(spaceIdx + 1);
      } catch (DateTimeParseException e) {
        // Not a timestamp prefix after all - keep content as-is, never drop the line.
      }
    }
    onLine.accept(new DockerLogLine(dockerTimestamp, streamName, content));
  }
}
