package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import io.netty.buffer.PooledByteBufAllocator;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.NettyDataBufferFactory;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * OS-1E — mission §36's required streaming tests, in two layers matching
 * {@code OpenShiftApiClientByteBoundTest}'s own established convention:
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
 * <p><b>OS-1E review recovery (mission §5/§6/§7/§26)</b> — the overlong-
 * line tests below replace the original ones, which locked in the wrong
 * semantic: the original decoder emitted a NEW synthetic line every time
 * {@code maxLineBytes} was reached, so one real physical line larger than
 * the cap became several fake {@code CanonicalLogEvent}s. The corrected
 * decoder returns {@link OpenShiftApiClient.DecodedLine} (content +
 * {@code truncated} flag) and produces EXACTLY ONE {@code DecodedLine}
 * per physical upstream line, discarding (never buffering, never
 * emitting) every further byte of that same physical line until the real
 * terminating {@code \n} arrives.
 */
class OpenShiftApiClientLiveStreamTest {

  private static final NettyDataBufferFactory POOLED = new NettyDataBufferFactory(PooledByteBufAllocator.DEFAULT);

  // ------------------------------------------------------------ LiveLineDecoder (pure, unit)

  @Test
  void oneCompleteLineInOneChunkIsEmittedImmediately() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("2026-09-12T10:00:00.000000000Z hello world\n"));
    assertThat(lines).hasSize(1);
    assertThat(lines.get(0).content()).isEqualTo("2026-09-12T10:00:00.000000000Z hello world");
    assertThat(lines.get(0).truncated()).isFalse();
  }

  @Test
  void multipleLinesInOneChunkAreAllEmittedInOrder() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<OpenShiftApiClient.DecodedLine> lines = decoder.onChunk(bytes("line-one\nline-two\nline-three\n"));
    assertThat(contents(lines)).containsExactly("line-one", "line-two", "line-three");
    assertThat(lines).allMatch(l -> !l.truncated());
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
    // Mission §12's own worked example.
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

  // ------------------------------------------------------------ overlong physical line (OS-1E review recovery, mission §5/§6/§7/§26)

  @Test
  void aPhysicalOverlongLineProducesExactlyOneEventNeverMultipleFakeOnes() {
    // A 200,000-byte physical line (well over any realistic maxLineBytes),
    // terminated by exactly one real newline - mission §26's own worked
    // example. Must become AT MOST ONE DecodedLine, never several.
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
    // 40 bytes with no newline - crosses the cap once (at byte 16) and
    // must emit exactly ONE truncated DecodedLine, discarding bytes
    // 17-40 entirely (never a second/third fragment).
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
    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024).map(OpenShiftApiClient.DecodedLine::content))
        .expectNext("first", "second", "third")
        .verifyComplete();
  }

  @Test
  void everyConsumedDataBufferIsReleased_pooledRefCountProvesIt() {
    List<DataBuffer> tracked = List.of(pooled("a\n"), pooled("b\n"), pooled("c\n"));
    StepVerifier.create(OpenShiftApiClient.decodeLines(Flux.fromIterable(tracked), 1024))
        .expectNextCount(3)
        .verifyComplete();
    for (DataBuffer buffer : tracked) {
      assertThat(nettyRefCount(buffer)).as("every consumed buffer must be released").isZero();
    }
  }

  @Test
  void downstreamCancellationCancelsTheUnderlyingUpstreamSubscription() {
    // Mission §36 "browser cancellation cancels upstream" / "explicit
    // Stop cancels upstream" - both are, at this layer, "the downstream
    // consumer of decodeLines cancels", proven via a never-terminating
    // synthetic source (simulates an infinite follow=true stream).
    java.util.concurrent.atomic.AtomicBoolean sourceCancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
    Flux<DataBuffer> neverEndingSource = Flux.<DataBuffer>never().doOnCancel(() -> sourceCancelled.set(true));

    Disposable subscription = OpenShiftApiClient.decodeLines(neverEndingSource, 1024).subscribe();
    subscription.dispose();

    assertThat(sourceCancelled).as("the raw follow=true body subscription must be cancelled").isTrue();
  }

  @Test
  void noLineIsEmittedAfterDownstreamCancellation() {
    // "no event after Stop" - a line delivered right before cancel must
    // still have been emitted (already in flight), but nothing new after.
    java.util.concurrent.atomic.AtomicInteger emittedAfterCancel = new java.util.concurrent.atomic.AtomicInteger();
    Flux<DataBuffer> source = Flux.concat(Flux.just(pooled("before-stop\n")), Flux.never());

    java.util.concurrent.atomic.AtomicBoolean cancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
    Disposable subscription = OpenShiftApiClient.decodeLines(source, 1024)
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

    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024).map(OpenShiftApiClient.DecodedLine::content))
        .expectNext("partial-before-failure")
        .expectErrorMatches(e -> e == upstreamFailure)
        .verify(Duration.ofSeconds(2));

    assertThat(nettyRefCount(buffer)).isZero();
  }
}
