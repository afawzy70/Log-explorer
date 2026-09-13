package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import io.netty.buffer.PooledByteBufAllocator;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.NettyDataBufferFactory;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * OS-1E — streaming decoder tests, in two layers matching {@code
 * OpenShiftApiClientByteBoundTest}'s own established convention:
 *
 * <ol>
 *   <li><b>Pure decoder layer</b> — {@link OpenShiftApiClient.LiveLineDecoder}
 *   directly, with plain byte arrays, independent of any reactive/HTTP
 *   machinery.</li>
 *   <li><b>Reactive layer</b> — {@link OpenShiftApiClient#decodeLines}
 *   against synthetic {@code Flux<DataBuffer>} sources, proving real
 *   pooled-buffer release and real cancellation propagation.</li>
 * </ol>
 *
 * <p><b>OS-1E final implementation</b> — two further corrections beyond
 * the review-recovery pass:
 *
 * <ul>
 *   <li>The overflow-detection boundary is now exact: a physical line of
 *   exactly {@code maxLineBytes} content bytes, terminated by a real
 *   {@code \n}, must never be reported {@code truncated=true} (the prior
 *   check fired on the write that reached the cap, before ever seeing
 *   whether a real newline was next).</li>
 *   <li>A stream ending without a final newline no longer silently drops
 *   its last buffered fragment — {@link OpenShiftApiClient.LiveLineDecoder#flushPartial()}
 *   / {@code decodeLines}'s clean-EOF-vs-error-vs-cancellation contract
 *   (see its own javadoc) makes this explicit and truthful.</li>
 * </ul>
 */
class OpenShiftApiClientLiveStreamTest {

  private static final NettyDataBufferFactory POOLED = new NettyDataBufferFactory(PooledByteBufAllocator.DEFAULT);

  private static Runnable noop() {
    return () -> { };
  }

  // ------------------------------------------------------------ LiveLineDecoder (pure, unit)

  @Test
  void oneCompleteLineInOneChunkIsEmittedImmediately() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("2026-09-12T10:00:00.000000000Z hello world\n"));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).isEqualTo("2026-09-12T10:00:00.000000000Z hello world");
    assertThat(lines.get(0).truncated()).isFalse();
    assertThat(lines.get(0).unterminated()).isFalse();
  }

  @Test
  void multipleLinesInOneChunkAreAllEmittedInOrder() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("line-one\nline-two\nline-three\n"));
    assertThat(contents(lines)).containsExactly("line-one", "line-two", "line-three");
    assertThat(lines).allMatch(l -> !l.truncated() && !l.unterminated());
  }

  @Test
  void aLineSplitAcrossManyChunksIsReassembledCorrectly() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> all = new ArrayList<>();
    all.addAll(decoder.onChunk(bytes("{\"mes")));
    all.addAll(decoder.onChunk(bytes("sage\":\"x")));
    all.addAll(decoder.onChunk(bytes("\"}\n")));
    assertThat(contents(all)).containsExactly("{\"message\":\"x\"}");
  }

  @Test
  void aChunkBoundaryInsideAJsonFieldNeverProducesAPrematureOrSplitLine() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> first = decoder.onChunk(bytes("2026... {\"mes"));
    List<OpenShiftApiClient.DecodedLine> second = decoder.onChunk(bytes("sage\":\"x\"}\n2026..."));
    assertThat(first).isEmpty(); // no newline seen yet - nothing emitted prematurely
    assertThat(contents(second)).containsExactly("2026... {\"message\":\"x\"}");
  }

  @Test
  void aChunkBoundaryInsideAMultiByteUtf8CharacterIsReassembledCorrectly() {
    // "中" (U+4E2D) is E4 B8 AD - a 3-byte UTF-8 sequence. Split the chunk
    // in the middle of it (after only 1 of its 3 bytes).
    byte[] full = "prefix-中-suffix\n".getBytes(StandardCharsets.UTF_8);
    byte[] marker = "prefix-".getBytes(StandardCharsets.UTF_8);
    int charStart = marker.length;
    byte[] firstChunk = java.util.Arrays.copyOfRange(full, 0, charStart + 1); // splits mid-character
    byte[] secondChunk = java.util.Arrays.copyOfRange(full, charStart + 1, full.length);

    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> all = new ArrayList<>();
    all.addAll(decoder.onChunk(firstChunk));
    all.addAll(decoder.onChunk(secondChunk));

    assertThat(contents(all)).containsExactly("prefix-中-suffix");
  }

  @Test
  void carriageReturnLineFeedIsHandledDefensively_crStrippedFromContent() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("line-with-crlf\r\nanother\r\n"));
    assertThat(contents(lines)).containsExactly("line-with-crlf", "another");
  }

  @Test
  void aMalformedNonJsonLineIsStillEmittedVerbatim_decoderNeverParsesContent() {
    // The decoder's own job is purely line-framing - content validity is
    // a downstream (LogLineParser) concern, never this class's.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("not json at all { unbalanced\n"));
    assertThat(contents(lines)).containsExactly("not json at all { unbalanced");
  }

  @Test
  void emptyChunkProducesNoLinesAndDoesNotThrow() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    assertThat(decoder.onChunk(new byte[0])).isEmpty();
  }

  // ------------------------------------------------------------ exact long-line boundary (OS-1E final implementation, mission §10/§25)

  @Test
  void lineBoundary1_shorterThanMaxIsNeverTruncated() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("y".repeat(15) + "\n"));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).truncated()).isFalse();
    assertThat(lines.get(0).content()).hasSize(15);
  }

  @Test
  void lineBoundary2_exactlyMaxLineBytesFollowedByRealNewlineIsNeverTruncated() {
    // THE fix under test: a physical line of EXACTLY maxLineBytes content
    // bytes, immediately followed by a real newline, must never be
    // reported truncated - every byte was genuinely captured, nothing
    // was ever lost.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("y".repeat(16) + "\n"));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).truncated()).isFalse();
    assertThat(lines.get(0).content()).hasSize(16);
  }

  @Test
  void lineBoundary3_maxLineBytesPlusOneProducesExactlyOneTruncatedEvent() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("y".repeat(17) + "\n"));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).truncated()).isTrue();
    assertThat(lines.get(0).content()).hasSize(16);
  }

  @Test
  void aPhysicalOverlongLineProducesExactlyOneEventNeverMultipleFakeOnes() {
    // A 200,000-byte physical line (well over any realistic maxLineBytes),
    // terminated by exactly one real newline. Must become AT MOST ONE
    // DecodedLine, never several.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(65_536);
    byte[] hugeLine = "y".repeat(200_000).getBytes(StandardCharsets.UTF_8);
    List<OpenShiftApiClient.DecodedLine> lines = new ArrayList<>(decoder.onChunk(hugeLine));
    lines.addAll(decoder.onChunk(bytes("\n")));

    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).truncated()).isTrue();
    assertThat(lines.get(0).content().getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(65_536);
  }

  @Test
  void overlongLineDiscardsEveryFurtherByteOfThatPhysicalLineUntilTheRealNewline() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    // 40 bytes with no newline - crosses the cap once and must emit
    // exactly ONE truncated DecodedLine, discarding the remainder
    // entirely (never a second/third fragment).
    List<OpenShiftApiClient.DecodedLine> lines = new ArrayList<>(decoder.onChunk(bytes("y".repeat(40))));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).truncated()).isTrue();

    // The real terminator for THIS physical line arrives in a later
    // chunk - must exit discard mode without emitting a second event for
    // the discarded remainder.
    List<OpenShiftApiClient.DecodedLine> afterNewline = decoder.onChunk(bytes("\n"));
    assertThat(afterNewline).isEmpty();
  }

  @Test
  void afterOverlongDiscardTheNextRealPhysicalLineParsesNormally() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    List<OpenShiftApiClient.DecodedLine> all = new ArrayList<>();
    all.addAll(decoder.onChunk(bytes("y".repeat(40)))); // overlong, 1 truncated event
    all.addAll(decoder.onChunk(bytes("\n"))); // real terminator for the overlong line - no event
    all.addAll(decoder.onChunk(bytes("next-real-line\n"))); // a normal, short, complete line

    assertThat(all).hasSize(2);
    assertThat(all.get(0).truncated()).isTrue();
    assertThat(all.get(1).truncated()).isFalse();
    assertThat(all.get(1).content()).isEqualTo("next-real-line");
  }

  @Test
  void utf8SafeAtOverlongTruncationBoundary_noReplacementCharacterNoFakeContinuationEvent() {
    // A run of complete 3-byte "中" characters, capped just short of a
    // whole number of characters - the forced cut must trim the
    // incomplete trailing character rather than emit a garbled one, and
    // must never emit a second event for the discarded remainder.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(7); // 2 chars (6 bytes) + 1 stray byte of a 3rd
    byte[] fourChars = "中中中中".getBytes(StandardCharsets.UTF_8); // 12 bytes, no newline
    List<OpenShiftApiClient.DecodedLine> lines = new ArrayList<>(decoder.onChunk(fourChars));
    lines.addAll(decoder.onChunk(bytes("\n")));

    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).doesNotContain("�");
  }

  // ------------------------------------------------------------ partial final line, pure decoder (OS-1E final implementation, mission §12/§26)

  @Test
  void flushPartial_emptyBufferReturnsEmpty() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    assertThat(decoder.flushPartial()).isEmpty();
    assertThat(decoder.hasPartialContent()).isFalse();
  }

  @Test
  void flushPartial_bufferedFragmentReturnedAsOneUnterminatedEvent() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    decoder.onChunk(bytes("no newline yet"));
    assertThat(decoder.hasPartialContent()).isTrue();

    List<OpenShiftApiClient.DecodedLine> flushed = decoder.flushPartial().map(List::of).orElse(List.of());
    assertThat(flushed).hasSize(1);
    assertThat(flushed.get(0).content()).isEqualTo("no newline yet");
    assertThat(flushed.get(0).unterminated()).isTrue();
    assertThat(flushed.get(0).truncated()).isFalse();
  }

  @Test
  void flushPartial_afterADiscardedOverlongRemainderReturnsEmpty() {
    // The overlong line already produced its own one truncated=true
    // event; the discarded remainder was never buffered, so there is
    // nothing further to flush for that physical line.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    decoder.onChunk(bytes("y".repeat(40))); // truncated event already emitted, now discarding
    assertThat(decoder.flushPartial()).isEmpty();
  }

  private static List<String> contents(List<OpenShiftApiClient.DecodedLine> lines) {
    return lines.stream().map(OpenShiftApiClient.DecodedLine::content).toList();
  }

  private static byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  // ------------------------------------------------------------ decodeLines (reactive, DataBuffer release + cancellation)

  private DataBuffer pooled(String text) {
    byte[] b = bytes(text);
    DataBuffer buffer = POOLED.allocateBuffer(b.length);
    buffer.write(b);
    return buffer;
  }

  private static int nettyRefCount(DataBuffer buffer) {
    Object native_ = ((org.springframework.core.io.buffer.NettyDataBuffer) buffer).getNativeBuffer();
    return ((io.netty.buffer.ByteBuf) native_).refCnt();
  }

  @Test
  void decodeLinesEmitsEveryLineFromAFiniteSourceAndCompletes() {
    Flux<DataBuffer> source = Flux.just(pooled("first\nsecond\nthird\n"));
    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024, noop()).map(OpenShiftApiClient.DecodedLine::content))
        .expectNext("first", "second", "third")
        .verifyComplete();
  }

  @Test
  void everyConsumedDataBufferIsReleased_pooledRefCountProvesIt() {
    List<DataBuffer> tracked = List.of(pooled("a\n"), pooled("b\n"), pooled("c\n"));
    StepVerifier.create(OpenShiftApiClient.decodeLines(Flux.fromIterable(tracked), 1024, noop()))
        .expectNextCount(3)
        .verifyComplete();
    for (DataBuffer buffer : tracked) {
      assertThat(nettyRefCount(buffer)).as("every consumed buffer must be released").isZero();
    }
  }

  @Test
  void downstreamCancellationCancelsTheUnderlyingUpstreamSubscription() {
    // Both "browser cancellation cancels upstream" and "explicit Stop
    // cancels upstream" are, at this layer, "the downstream consumer of
    // decodeLines cancels", proven via a never-terminating synthetic
    // source (simulates an infinite follow=true stream).
    AtomicBoolean sourceCancelled = new AtomicBoolean(false);
    Flux<DataBuffer> neverEndingSource = Flux.<DataBuffer>never().doOnCancel(() -> sourceCancelled.set(true));

    Disposable subscription = OpenShiftApiClient.decodeLines(neverEndingSource, 1024, noop()).subscribe();
    subscription.dispose();

    assertThat(sourceCancelled).as("the raw follow=true body subscription must be cancelled").isTrue();
  }

  @Test
  void noLineIsEmittedAfterDownstreamCancellation() {
    // "no event after Stop" - a line delivered right before cancel must
    // still have been emitted (already in flight), but nothing new after.
    AtomicInteger emittedAfterCancel = new AtomicInteger();
    Flux<DataBuffer> source = Flux.concat(Flux.just(pooled("before-stop\n")), Flux.never());

    AtomicBoolean cancelled = new AtomicBoolean(false);
    Disposable subscription = OpenShiftApiClient.decodeLines(source, 1024, noop())
        .doOnNext(line -> {
          if (cancelled.get()) {
            emittedAfterCancel.incrementAndGet();
          }
        })
        .subscribe();
    // Give the first (synchronous) line a chance to be delivered, then stop.
    try {
      Thread.sleep(20);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    cancelled.set(true);
    subscription.dispose();
    try {
      Thread.sleep(50);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }

    assertThat(emittedAfterCancel.get()).isZero();
  }

  @Test
  void aTransportErrorPropagatesAndReleasesWhatWasAlreadyBuffered() {
    DataBuffer buffer = pooled("partial-before-failure\n");
    RuntimeException upstreamFailure = new RuntimeException("connection reset");
    Flux<DataBuffer> source = Flux.concat(Flux.just(buffer), Flux.error(upstreamFailure));

    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024, noop()).map(OpenShiftApiClient.DecodedLine::content))
        .expectNext("partial-before-failure")
        .expectErrorMatches(e -> e == upstreamFailure)
        .verify(Duration.ofSeconds(2));

    assertThat(nettyRefCount(buffer)).isZero();
  }

  // ------------------------------------------------------------ partial final line, reactive (OS-1E final implementation, mission §12/§26)

  @Test
  void partialLineA_cleanEofWithBufferedFragmentEmitsOneUnterminatedEventAndTruthfullyReportsIt() {
    // Clean EOF (the upstream Flux<DataBuffer> completes normally) with a
    // buffered-but-never-terminated fragment - mission §26-A.
    Flux<DataBuffer> source = Flux.just(pooled("complete\n"), pooled("trailing-fragment-no-newline"));
    AtomicBoolean partialDropped = new AtomicBoolean(false);

    List<OpenShiftApiClient.DecodedLine> lines = OpenShiftApiClient
        .decodeLines(source, 1024, () -> partialDropped.set(true))
        .collectList()
        .block(Duration.ofSeconds(2));

    assertThat(lines).hasSize(2);
    assertThat(lines.get(0).content()).isEqualTo("complete");
    assertThat(lines.get(0).unterminated()).isFalse();
    assertThat(lines.get(1).content()).isEqualTo("trailing-fragment-no-newline");
    assertThat(lines.get(1).unterminated()).isTrue();
    // Clean EOF is not an "error" - the partial-dropped-by-error callback
    // must never fire for this path (it was not dropped, it was flushed).
    assertThat(partialDropped.get()).isFalse();
  }

  @Test
  void partialLineA_cleanEofWithNoBufferedFragmentEmitsNothingExtra() {
    Flux<DataBuffer> source = Flux.just(pooled("complete\n")); // ends exactly on a line boundary
    List<OpenShiftApiClient.DecodedLine> lines = OpenShiftApiClient
        .decodeLines(source, 1024, noop())
        .collectList()
        .block(Duration.ofSeconds(2));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).unterminated()).isFalse();
  }

  @Test
  void partialLineB_transportErrorWithBufferedFragmentNeverEmitsItAsAnEventButCountsItAsDropped() {
    // Mission §26-B: a genuine transport failure with a buffered fragment
    // - never re-emitted as if it were a complete line, but truthfully
    // counted.
    DataBuffer complete = pooled("complete\n");
    DataBuffer fragment = pooled("lost-fragment-no-newline");
    RuntimeException upstreamFailure = new RuntimeException("connection reset");
    Flux<DataBuffer> source = Flux.concat(Flux.just(complete, fragment), Flux.error(upstreamFailure));
    AtomicBoolean partialDropped = new AtomicBoolean(false);

    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024, () -> partialDropped.set(true)))
        .expectNextMatches(line -> line.content().equals("complete"))
        .expectErrorMatches(e -> e == upstreamFailure)
        .verify(Duration.ofSeconds(2));

    assertThat(partialDropped.get()).as("a genuine transport failure with a buffered fragment must be counted").isTrue();
  }

  @Test
  void partialLineC_explicitCancellationWithBufferedFragmentIsSilent_noPartialDroppedCallback() {
    // Mission §26-C: an explicit Stop/browser disconnect legitimately
    // loses its own last buffered fragment - expected, never a
    // truthfulness concern, so onPartialDroppedByError must NOT fire.
    Flux<DataBuffer> source = Flux.concat(Flux.just(pooled("lost-on-stop-no-newline")), Flux.never());
    AtomicBoolean partialDropped = new AtomicBoolean(false);

    Disposable subscription = OpenShiftApiClient.decodeLines(source, 1024, () -> partialDropped.set(true)).subscribe();
    try {
      Thread.sleep(20);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    subscription.dispose();
    try {
      Thread.sleep(50);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }

    assertThat(partialDropped.get()).as("an intentional cancellation must never be reported as a dropped-by-error partial").isFalse();
  }

  @Test
  void partialLineD_aFreshDecoderNeverInheritsAPreviousStreamsBufferedFragment() {
    // Each attempt gets its own fresh LiveLineDecoder instance (created
    // inside decodeLines) - structurally impossible for one stream's
    // leftover fragment to contaminate a later, independent stream.
    OpenShiftApiClient.LiveLineDecoder first = new OpenShiftApiClient.LiveLineDecoder(1024);
    first.onChunk(bytes("never terminated"));
    assertThat(first.hasPartialContent()).isTrue();

    OpenShiftApiClient.LiveLineDecoder second = new OpenShiftApiClient.LiveLineDecoder(1024);
    assertThat(second.hasPartialContent()).isFalse();
    List<OpenShiftApiClient.DecodedLine> lines = second.onChunk(bytes("clean-line\n"));
    assertThat(contents(lines)).containsExactly("clean-line");
  }
}
