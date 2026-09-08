package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;

import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.StreamType;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Framing tests (IMPLEMENTATION_PLAN.md "Phase C" required automated test:
 * "framing, tty, ... truncation"). Docker frame boundaries are not
 * guaranteed to be line-aligned, so these deliberately exercise lines
 * split across multiple frames, not just one frame per line.
 */
class DockerFrameCollectingCallbackTest {

  private Frame frame(StreamType type, String text) {
    return new Frame(type, text.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void oneCompleteLineInOneFrameIsParsedWithItsDockerTimestampStripped() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z hello world\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).isEqualTo("hello world");
    assertThat(lines.get(0).stream()).isEqualTo("stdout");
    assertThat(lines.get(0).dockerTimestamp()).isEqualTo(Instant.parse("2026-01-01T00:00:00.000000000Z"));
  }

  @Test
  void aLineSplitAcrossMultipleFramesIsReassembledCorrectly() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z hel"));
    callback.onNext(frame(StreamType.STDOUT, "lo wor"));
    callback.onNext(frame(StreamType.STDOUT, "ld\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).isEqualTo("hello world");
  }

  @Test
  void multipleLinesInOneFrameAreAllExtracted() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.STDOUT,
        "2026-01-01T00:00:00.000000000Z line one\n2026-01-01T00:00:01.000000000Z line two\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(2);
    assertThat(lines.get(0).content()).isEqualTo("line one");
    assertThat(lines.get(1).content()).isEqualTo("line two");
  }

  @Test
  void stdoutAndStderrAreKeptInSeparateBuffersEvenWhenInterleaved() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    // A stdout line split across two frames, with a complete stderr frame
    // arriving in between - must not corrupt the still-buffered stdout partial.
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z stdout-par"));
    callback.onNext(frame(StreamType.STDERR, "2026-01-01T00:00:00.500000000Z stderr line\n"));
    callback.onNext(frame(StreamType.STDOUT, "tial\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(2);
    assertThat(lines).anySatisfy(l -> {
      assertThat(l.stream()).isEqualTo("stdout");
      assertThat(l.content()).isEqualTo("stdout-partial");
    });
    assertThat(lines).anySatisfy(l -> {
      assertThat(l.stream()).isEqualTo("stderr");
      assertThat(l.content()).isEqualTo("stderr line");
    });
  }

  @Test
  void rawStreamTypeFromTtyContainersIsTreatedAsStdout() {
    // Tty=true containers are not multiplexed by Docker at all - docker-java
    // reports their frames as StreamType.RAW.
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.RAW, "2026-01-01T00:00:00.000000000Z tty output line\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).stream()).isEqualTo("stdout");
    assertThat(lines.get(0).content()).isEqualTo("tty output line");
  }

  @Test
  void trailingPartialLineWithNoNewlineIsFlushedOnComplete() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z no trailing newline"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).isEqualTo("no trailing newline");
  }

  @Test
  void unparsableTimestampPrefixPreservesTheFullLineRatherThanCorruptingIt() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(100);
    callback.onNext(frame(StreamType.STDOUT, "not-a-timestamp this looks like a log line\n"));
    callback.onComplete();

    List<DockerLogLine> lines = callback.lines();
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).dockerTimestamp()).isNull();
    assertThat(lines.get(0).content()).isEqualTo("not-a-timestamp this looks like a log line");
  }

  @Test
  void truncatesAtMaxLinesWithoutFailingOrGrowingUnbounded() {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(3);
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 10; i++) {
      sb.append("2026-01-01T00:00:0").append(i).append(".000000000Z line ").append(i).append('\n');
    }
    callback.onNext(frame(StreamType.STDOUT, sb.toString()));
    callback.onComplete();

    assertThat(callback.lines()).hasSize(3);
  }
}
