package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;

import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.StreamType;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * Framing tests for the live-tail counterpart to {@link
 * DockerFrameCollectingCallback} (IMPLEMENTATION_PLAN.md "Phase J") -
 * proves the same framing correctness (never line-aligned frame
 * boundaries) holds for the unbounded/indefinite emission path too, plus
 * the two behaviors that differ from the bounded callback: emitting each
 * line immediately (not collecting) and notifying on termination.
 */
class DockerFollowCallbackTest {

  private Frame frame(StreamType type, String text) {
    return new Frame(type, text.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void emitsEachCompleteLineImmediatelyAsItArrivesRatherThanCollectingThem() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });

    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z first\n"));
    assertThat(emitted).hasSize(1); // visible before onComplete - unlike the bounded callback
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:01.000000000Z second\n"));
    assertThat(emitted).hasSize(2);

    assertThat(emitted.get(0).content()).isEqualTo("first");
    assertThat(emitted.get(1).content()).isEqualTo("second");
  }

  @Test
  void aLineSplitAcrossMultipleFramesIsReassembledCorrectly() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });

    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z hel"));
    assertThat(emitted).isEmpty(); // no complete line yet
    callback.onNext(frame(StreamType.STDOUT, "lo wor"));
    callback.onNext(frame(StreamType.STDOUT, "ld\n"));

    assertThat(emitted).hasSize(1);
    assertThat(emitted.get(0).content()).isEqualTo("hello world");
  }

  @Test
  void stdoutAndStderrAreKeptInSeparateBuffersEvenWhenInterleaved() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });

    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z stdout-par"));
    callback.onNext(frame(StreamType.STDERR, "2026-01-01T00:00:00.500000000Z stderr line\n"));
    callback.onNext(frame(StreamType.STDOUT, "tial\n"));

    assertThat(emitted).hasSize(2);
    assertThat(emitted).anySatisfy(l -> {
      assertThat(l.stream()).isEqualTo("stdout");
      assertThat(l.content()).isEqualTo("stdout-partial");
    });
    assertThat(emitted).anySatisfy(l -> {
      assertThat(l.stream()).isEqualTo("stderr");
      assertThat(l.content()).isEqualTo("stderr line");
    });
  }

  @Test
  void rawStreamTypeFromTtyContainersIsTreatedAsStdout() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });
    callback.onNext(frame(StreamType.RAW, "2026-01-01T00:00:00.000000000Z tty output line\n"));

    assertThat(emitted).hasSize(1);
    assertThat(emitted.get(0).stream()).isEqualTo("stdout");
  }

  @Test
  void unparsableTimestampPrefixPreservesTheFullLineRatherThanCorruptingIt() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });
    callback.onNext(frame(StreamType.STDOUT, "not-a-timestamp this looks like a log line\n"));

    assertThat(emitted).hasSize(1);
    assertThat(emitted.get(0).dockerTimestamp()).isNull();
    assertThat(emitted.get(0).content()).isEqualTo("not-a-timestamp this looks like a log line");
  }

  @Test
  void dockerTimestampIsParsedAndStrippedFromTheContent() {
    List<DockerLogLine> emitted = new ArrayList<>();
    DockerFollowCallback callback = new DockerFollowCallback(emitted::add, () -> { });
    callback.onNext(frame(StreamType.STDOUT, "2026-01-01T00:00:00.000000000Z hello\n"));

    assertThat(emitted.get(0).dockerTimestamp()).isEqualTo(Instant.parse("2026-01-01T00:00:00.000000000Z"));
    assertThat(emitted.get(0).content()).isEqualTo("hello");
  }

  @Test
  void onCompleteCallsTheTerminationCallbackExactlyOnce() {
    AtomicInteger terminations = new AtomicInteger();
    DockerFollowCallback callback = new DockerFollowCallback(line -> { }, terminations::incrementAndGet);
    callback.onComplete();
    assertThat(terminations.get()).isEqualTo(1);
  }

  @Test
  void onErrorCallsTheTerminationCallbackExactlyOnce() {
    AtomicInteger terminations = new AtomicInteger();
    DockerFollowCallback callback = new DockerFollowCallback(line -> { }, terminations::incrementAndGet);
    try {
      callback.onError(new RuntimeException("connection reset"));
    } catch (RuntimeException ignored) {
      // ResultCallback.Adapter#onError rethrows by default - irrelevant to this assertion
    }
    assertThat(terminations.get()).isEqualTo(1);
  }
}
