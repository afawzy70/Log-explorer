package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import io.netty.buffer.PooledByteBufAllocator;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.NettyDataBufferFactory;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * OS-1C review recovery — Defect A: true streaming byte-bounded pod-log
 * fetch. Two layers, matching the mission's own required proof:
 *
 * <ol>
 *   <li><b>Unit layer</b> — {@link OpenShiftApiClient#readBounded} and
 *   {@link OpenShiftApiClient#trimIncompleteUtf8Suffix} directly, with
 *   synthetic {@code Flux<DataBuffer>} sources under precise control
 *   (exact buffer boundaries, real pooled Netty buffers for genuine
 *   reference-count release proof, a source that would never terminate on
 *   its own to prove real cancellation).</li>
 *   <li><b>Integration layer</b> — {@link OpenShiftApiClient#fetchPodLog}
 *   end to end against {@link MockOpenShiftPodLogServer}, proving the
 *   whole HTTP-to-{@link PodLogFetchResult} path, not just the extraction
 *   helper in isolation.</li>
 * </ol>
 */
class OpenShiftApiClientByteBoundTest {

  private static final NettyDataBufferFactory POOLED = new NettyDataBufferFactory(PooledByteBufAllocator.DEFAULT);

  // ------------------------------------------------------------ trimIncompleteUtf8Suffix (pure unit)

  @Test
  void emptyArrayIsUnchanged() {
    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(new byte[0])).isEmpty();
  }

  @Test
  void plainAsciiIsNeverTrimmed() {
    byte[] bytes = "hello world".getBytes(StandardCharsets.UTF_8);
    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(bytes)).isEqualTo(bytes);
  }

  @Test
  void aCompleteTwoByteCharacterAtTheEndIsPreserved() {
    // "café" - the trailing é is U+00E9, a 2-byte UTF-8 sequence (0xC3 0xA9), complete.
    byte[] bytes = "café".getBytes(StandardCharsets.UTF_8);
    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(bytes)).isEqualTo(bytes);
  }

  @Test
  void aTwoByteCharacterCutAfterOnlyItsLeadByteIsDropped() {
    byte[] complete = "café".getBytes(StandardCharsets.UTF_8);
    byte[] cut = new byte[complete.length - 1]; // drops the final continuation byte of é, leaving a lone 0xC3 lead
    System.arraycopy(complete, 0, cut, 0, cut.length);

    byte[] trimmed = OpenShiftApiClient.trimIncompleteUtf8Suffix(cut);

    assertThat(new String(trimmed, StandardCharsets.UTF_8)).isEqualTo("caf"); // the incomplete é is gone entirely
    assertThat(trimmed).doesNotContain(0xC3); // the dangling lead byte itself was dropped, not left to decode as U+FFFD
  }

  @Test
  void aThreeByteCharacterCutAfterOneOrTwoBytesIsDropped() {
    // U+4E2D ("中") is E4 B8 AD - a 3-byte sequence.
    byte[] full = "中".getBytes(StandardCharsets.UTF_8);
    assertThat(full).hasSize(3);

    byte[] afterOneByte = java.util.Arrays.copyOfRange(full, 0, 1);
    byte[] afterTwoBytes = java.util.Arrays.copyOfRange(full, 0, 2);

    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(afterOneByte)).isEmpty();
    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(afterTwoBytes)).isEmpty();
  }

  @Test
  void aFourByteEmojiCutAtAnyPointIsDroppedNeverPartiallyDecoded() {
    // U+1F600 (😀) is F0 9F 98 80 - a 4-byte sequence.
    byte[] full = "😀".getBytes(StandardCharsets.UTF_8);
    assertThat(full).hasSize(4);

    for (int cutAt = 1; cutAt < 4; cutAt++) {
      byte[] cut = java.util.Arrays.copyOfRange(full, 0, cutAt);
      byte[] trimmed = OpenShiftApiClient.trimIncompleteUtf8Suffix(cut);
      assertThat(trimmed).as("cut at %d bytes", cutAt).isEmpty();
    }
  }

  @Test
  void onlyTheIncompleteTrailingCharacterIsDropped_everythingBeforeItSurvives() {
    String prefix = "line one: everything before the cut must survive verbatim — ";
    byte[] prefixBytes = prefix.getBytes(StandardCharsets.UTF_8);
    byte[] incompleteChar = java.util.Arrays.copyOfRange("中".getBytes(StandardCharsets.UTF_8), 0, 2);
    byte[] combined = new byte[prefixBytes.length + incompleteChar.length];
    System.arraycopy(prefixBytes, 0, combined, 0, prefixBytes.length);
    System.arraycopy(incompleteChar, 0, combined, prefixBytes.length, incompleteChar.length);

    byte[] trimmed = OpenShiftApiClient.trimIncompleteUtf8Suffix(combined);

    assertThat(new String(trimmed, StandardCharsets.UTF_8)).isEqualTo(prefix);
  }

  @Test
  void malformedTrailingBytesNeverThrow_deterministicNotCrash() {
    // Four raw continuation bytes with no lead byte at all - genuinely
    // malformed, never produced by a real truncation, but must never
    // throw - "malformed UTF-8 must have deterministic safe behavior".
    byte[] malformed = {(byte) 0x80, (byte) 0x81, (byte) 0x82, (byte) 0x83};
    assertThat(OpenShiftApiClient.trimIncompleteUtf8Suffix(malformed)).isNotNull();
  }

  // ------------------------------------------------------------ readBounded (unit, synthetic Flux<DataBuffer>)

  private DataBuffer pooled(String text) {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    DataBuffer buffer = POOLED.allocateBuffer(bytes.length);
    buffer.write(bytes);
    return buffer;
  }

  @Test
  void responseSmallerThanMaxBytesIsReturnedCompleteAndNeverFlaggedAsCapped() {
    DataBuffer buffer = pooled("short body, well under the cap");
    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(Flux.just(buffer), 10_000);

    StepVerifier.create(result)
        .assertNext(r -> {
          assertThat(r.body()).isEqualTo("short body, well under the cap");
          assertThat(r.byteCapReached()).isFalse();
        })
        .verifyComplete();
  }

  @Test
  void responseExactlyAtMaxBytesIsCompleteAndNeverFlaggedAsCapped() {
    String body = "x".repeat(64); // 64 real ASCII bytes
    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(Flux.just(pooled(body)), 64);

    StepVerifier.create(result)
        .assertNext(r -> {
          assertThat(r.body()).hasSize(64);
          assertThat(r.byteCapReached()).isFalse(); // nothing was actually cut off
        })
        .verifyComplete();
  }

  @Test
  void responseLargerThanMaxBytesStopsAccumulationAtExactlyTheCap() {
    String body = "y".repeat(1000);
    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(Flux.just(pooled(body)), 64);

    StepVerifier.create(result)
        .assertNext(r -> {
          assertThat(r.body()).hasSize(64).isEqualTo("y".repeat(64));
          assertThat(r.byteCapReached()).isTrue();
        })
        .verifyComplete();
  }

  @Test
  void theCapIsEnforcedAcrossMultipleSmallBuffersNotJustWithinOne() {
    // Ten buffers of 10 bytes each = 100 real bytes, capped at 25 - proves
    // the boundary-straddling buffer is sliced correctly, not just a
    // single-buffer special case.
    List<DataBuffer> buffers = new ArrayList<>();
    for (int i = 0; i < 10; i++) {
      buffers.add(pooled("0123456789"));
    }
    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(Flux.fromIterable(buffers), 25);

    StepVerifier.create(result)
        .assertNext(r -> {
          assertThat(r.body()).isEqualTo("0123456789012345678901234"); // exactly 25 bytes
          assertThat(r.byteCapReached()).isTrue();
        })
        .verifyComplete();
  }

  @Test
  void byteCountIsRealEncodedBytesNeverJavaCharCount() {
    // "中" is 1 UTF-16 char (String.length() == 1) but 3 encoded UTF-8
    // bytes - the pre-recovery bug used body.length() (chars) as if it
    // were a byte count. A cap of 3 must keep the whole character; a cap
    // of 2 must drop it entirely (an incomplete trailing sequence).
    String threeChineseChars = "中文字"; // 3 UTF-16 chars, 9 UTF-8 bytes
    assertThat(threeChineseChars.length()).isEqualTo(3);
    assertThat(threeChineseChars.getBytes(StandardCharsets.UTF_8)).hasSize(9);

    Mono<PodLogFetchResult> cappedAtSixBytes =
        OpenShiftApiClient.readBounded(Flux.just(pooled(threeChineseChars)), 6);

    StepVerifier.create(cappedAtSixBytes)
        .assertNext(r -> {
          // 6 bytes = exactly the first two complete 3-byte characters -
          // if this were char-counted (length() <= 6, i.e. "never
          // truncate a 3-char string against a cap of 6"), the whole
          // string would incorrectly survive. Byte-accurate truncation
          // correctly drops the third character.
          assertThat(r.body()).isEqualTo("中文");
          assertThat(r.byteCapReached()).isTrue();
        })
        .verifyComplete();
  }

  @Test
  void aVeryLargeUpstreamBodyNeverGetsFullyMaterialized_boundedRegardlessOfRealSize() {
    // 2,000 buffers of 10 KB each = ~20 MB of real upstream data, capped at
    // 1 KB - proves the client's own accumulator never grows anywhere near
    // the real response size, and completes quickly rather than reading
    // everything first.
    int chunkSize = 10_000;
    int chunkCount = 2000;
    AtomicInteger buffersActuallyConsumed = new AtomicInteger();
    Flux<DataBuffer> hugeSource = Flux.range(0, chunkCount)
        .map(i -> {
          buffersActuallyConsumed.incrementAndGet();
          return pooled("z".repeat(chunkSize));
        });

    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(hugeSource, 1_000);

    StepVerifier.create(result)
        .assertNext(r -> {
          assertThat(r.body()).hasSize(1_000);
          assertThat(r.byteCapReached()).isTrue();
        })
        .expectComplete()
        .verify(Duration.ofSeconds(5));

    // Real cancellation: nowhere near all 2000 chunks were pulled from the
    // upstream generator - only enough to reach the 1 KB cap (at most 1
    // chunk, since each chunk alone already exceeds it) plus a small,
    // bounded number of in-flight signals Reactive Streams allows after
    // cancel().
    assertThat(buffersActuallyConsumed.get()).isLessThan(10);
  }

  @Test
  void everyConsumedDataBufferIsReleased_pooledRefCountProvesIt() {
    List<DataBuffer> tracked = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      DataBuffer buffer = pooled("chunk-" + i + "-of-real-content");
      tracked.add(buffer);
    }
    Mono<PodLogFetchResult> result = OpenShiftApiClient.readBounded(Flux.fromIterable(tracked), 10_000);

    StepVerifier.create(result).expectNextCount(1).verifyComplete();

    for (DataBuffer buffer : tracked) {
      // NettyDataBuffer wraps a real pooled io.netty.buffer.ByteBuf -
      // refCnt() reaching 0 is the actual, verifiable proof of release
      // (not merely "release() was called and returned something"), the
      // same signal Netty's own leak detector relies on.
      assertThat(nettyRefCount(buffer)).as("buffer should have been released").isZero();
    }
  }

  @Test
  void everyDataBufferActuallyDeliveredIsReleasedEvenWhenTheCapIsHitMidStream() {
    List<DataBuffer> tracked = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      tracked.add(pooled("0123456789")); // 10 bytes each, 50 total
    }
    // Cap at 25 - buffers 0/1 fully consumed, buffer 2 sliced and triggers
    // cancel(). Reactor Netty's own cancellation is real: once cancel() is
    // requested, further buffers are never even read off the wire in
    // production, so there is nothing to release for them - the same
    // behavior Flux.fromIterable exhibits here (a well-behaved source
    // stops emitting promptly on cancel(), sometimes before every already-
    // constructed test fixture element is even delivered). This asserts
    // release for every buffer this subscriber's hookOnNext was ACTUALLY
    // given - tracked via a doOnNext probe - never for one the source
    // itself never emitted (that buffer was simply never touched by
    // anyone, so its untouched refCnt of 1 is not a leak).
    List<DataBuffer> delivered = new ArrayList<>();
    Flux<DataBuffer> probed = Flux.fromIterable(tracked).doOnNext(delivered::add);

    StepVerifier.create(OpenShiftApiClient.readBounded(probed, 25)).expectNextCount(1).verifyComplete();

    assertThat(delivered).as("at least the cap-triggering buffer must have been delivered").isNotEmpty();
    for (DataBuffer buffer : delivered) {
      assertThat(nettyRefCount(buffer)).as("every delivered buffer must be released").isZero();
    }
  }

  private static int nettyRefCount(DataBuffer buffer) {
    Object native_ = ((org.springframework.core.io.buffer.NettyDataBuffer) buffer).getNativeBuffer();
    return ((io.netty.buffer.ByteBuf) native_).refCnt();
  }

  @Test
  void anErrorFromTheUpstreamSourcePropagatesAndReleasesWhatWasAlreadyBuffered() {
    DataBuffer buffer = pooled("partial before the failure");
    RuntimeException upstreamFailure = new RuntimeException("connection reset");
    Flux<DataBuffer> source = Flux.concat(Flux.just(buffer), Flux.error(upstreamFailure));

    StepVerifier.create(OpenShiftApiClient.readBounded(source, 10_000))
        .expectErrorMatches(e -> e == upstreamFailure)
        .verify();

    assertThat(nettyRefCount(buffer)).isZero();
  }

  // ------------------------------------------------------------ end-to-end (real HTTP, real MockOpenShiftPodLogServer)

  private MockOpenShiftPodLogServer server;
  private OpenShiftApiClient client;
  private static final com.logexplorer.core.model.RawToken TOKEN =
      com.logexplorer.core.model.RawToken.of("sha256~byte-bound-test-token-0123456789");

  @BeforeEach
  void setUp() throws java.io.IOException {
    server = new MockOpenShiftPodLogServer("payments");
    client = new OpenShiftApiClient(java.util.Map.of());
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  private PodLogFetchResult fetch(long maxBytes) {
    return client
        .fetchPodLog(java.net.URI.create(server.baseUrl()), TOKEN, null, "payments", "pod-a", "app", null, 2000,
            maxBytes, Duration.ofSeconds(10))
        .block();
  }

  @Test
  void endToEnd_responseUnderTheCapArrivesWhole() {
    String body = "2026-09-12T10:00:00.000000000Z small real response\n";
    server.setFixture("pod-a", "app", MockOpenShiftPodLogServer.Fixture.ok(body));

    PodLogFetchResult result = fetch(1_000_000);

    assertThat(result.body()).isEqualTo(body);
    assertThat(result.byteCapReached()).isFalse();
  }

  @Test
  void endToEnd_responseOverTheCapIsTruncatedAndFlagged() {
    String line = "2026-09-12T10:00:00.000000000Z ";
    String body = line.repeat(2000); // well over any small cap
    server.setFixture("pod-a", "app", MockOpenShiftPodLogServer.Fixture.ok(body));

    PodLogFetchResult result = fetch(500);

    assertThat(result.body()).hasSize(500);
    assertThat(result.byteCapReached()).isTrue();
    assertThat(body.getBytes(StandardCharsets.UTF_8)).hasSizeGreaterThan(500); // genuinely was larger
  }

  @Test
  void endToEnd_aReallyLargeRealHttpResponseNeverHangsOrExceedsTheCap() {
    // ~5 MB real HTTP response body, capped at 4 KB - proves the whole
    // WebClient/Reactor Netty path (not just the extraction helper in
    // isolation) stays bounded end to end.
    String body = "0123456789".repeat(500_000); // 5,000,000 bytes
    server.setFixture("pod-a", "app", MockOpenShiftPodLogServer.Fixture.ok(body));

    Instant startedAt = Instant.now();
    PodLogFetchResult result = fetch(4096);
    Duration elapsed = Duration.between(startedAt, Instant.now());

    assertThat(result.body()).hasSize(4096);
    assertThat(result.byteCapReached()).isTrue();
    assertThat(elapsed).isLessThan(Duration.ofSeconds(10)); // bounded, not "read 5 MB then truncate"
  }
}
