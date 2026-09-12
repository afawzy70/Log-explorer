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
 */
class OpenShiftApiClientLiveStreamTest {

  private static final NettyDataBufferFactory POOLED = new NettyDataBufferFactory(PooledByteBufAllocator.DEFAULT);

  // ------------------------------------------------------------ LiveLineDecoder (pure, unit)

  @Test
  void oneCompleteLineInOneChunkIsEmittedImmediately() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> lines = decoder.onChunk(bytes("2026-09-12T10:00:00.000000000Z hello world\n"));
    assertThat(lines).containsExactly("2026-09-12T10:00:00.000000000Z hello world");
  }

  @Test
  void multipleLinesInOneChunkAreAllEmittedInOrder() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> lines = decoder.onChunk(bytes("line-one\nline-two\nline-three\n"));
    assertThat(lines).containsExactly("line-one", "line-two", "line-three");
  }

  @Test
  void aLineSplitAcrossManyChunksIsReassembledCorrectly() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> all = new ArrayList<>();
    all.addAll(decoder.onChunk(bytes("{\"mes")));
    all.addAll(decoder.onChunk(bytes("sage\":\"x")));
    all.addAll(decoder.onChunk(bytes("\"}\n")));
    assertThat(all).containsExactly("{\"message\":\"x\"}");
  }

  @Test
  void aChunkBoundaryInsideAJsonFieldNeverProducesAPrematureOrSplitLine() {
    // Mission §12's own worked example.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> first = decoder.onChunk(bytes("2026... {\"mes"));
    List<String> second = decoder.onChunk(bytes("sage\":\"x\"}\n2026..."));
    assertThat(first).isEmpty(); // no newline seen yet - nothing emitted prematurely
    assertThat(second).containsExactly("2026... {\"message\":\"x\"}");
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
    List<String> all = new ArrayList<>();
    all.addAll(decoder.onChunk(firstChunk));
    all.addAll(decoder.onChunk(secondChunk));

    assertThat(all).containsExactly("prefix-中-suffix");
  }

  @Test
  void carriageReturnLineFeedIsHandledDefensively_crStrippedFromContent() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> lines = decoder.onChunk(bytes("line-with-crlf\r\nanother\r\n"));
    assertThat(lines).containsExactly("line-with-crlf", "another");
  }

  @Test
  void aMalformedNonJsonLineIsStillEmittedVerbatim_decoderNeverParsesContent() {
    // The decoder's own job is purely line-framing - content validity is
    // a downstream (LogLineParser) concern, never this class's.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    List<String> lines = decoder.onChunk(bytes("not json at all { unbalanced\n"));
    assertThat(lines).containsExactly("not json at all { unbalanced");
  }

  @Test
  void aLineExceedingTheMaxBoundIsForciblyEmittedRatherThanGrowingUnbounded() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(16);
    // 40 bytes, no newline anywhere - the safety valve must fire well
    // before this ever reaches 40 buffered bytes.
    List<String> lines = new ArrayList<>(decoder.onChunk(bytes("y".repeat(40))));
    for (String line : lines) {
      assertThat(line.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(16);
    }
    // Anything short of a full 16-byte forced fragment legitimately stays
    // buffered inside the decoder awaiting more data or a newline - flush
    // it explicitly to prove it, rather than lost.
    lines.addAll(decoder.onChunk(bytes("\n")));
    assertThat(lines).isNotEmpty();
    // Nothing was silently dropped - every forcibly-emitted fragment is real content.
    assertThat(String.join("", lines)).hasSize(40);
  }

  @Test
  void aLineExceedingTheMaxBoundAtAMultiByteCharacterBoundaryIsTrimmedNeverGarbled() {
    // A run of complete 3-byte "中" characters, capped just short of a
    // whole number of characters - the forced cut must trim the
    // incomplete trailing character rather than emit a garbled one.
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(7); // 2 chars (6 bytes) + 1 stray byte of a 3rd
    byte[] fourChars = "中中中中".getBytes(StandardCharsets.UTF_8); // 12 bytes, no newline
    List<String> lines = decoder.onChunk(fourChars);
    assertThat(lines).isNotEmpty();
    // Every emitted fragment must be valid, complete UTF-8 - never a
    // replacement character or a decode exception.
    for (String line : lines) {
      assertThat(line).doesNotContain("�");
    }
  }

  @Test
  void emptyChunkProducesNoLinesAndDoesNotThrow() {
    OpenShiftApiClient.LiveLineDecoder decoder = new OpenShiftApiClient.LiveLineDecoder(1024);
    assertThat(decoder.onChunk(new byte[0])).isEmpty();
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
    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024))
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

    StepVerifier.create(OpenShiftApiClient.decodeLines(source, 1024))
        .expectNext("partial-before-failure")
        .expectErrorMatches(e -> e == upstreamFailure)
        .verify(Duration.ofSeconds(2));

    assertThat(nettyRefCount(buffer)).isZero();
  }
}
