package com.logexplorer.core.search;

import java.util.Set;

/**
 * The exact JSON shape signed/verified inside an opaque pagination cursor
 * (see {@link PageCursorCodec}). Kept separate from {@link PageCursor} so
 * "bytes that came off the wire" and "a cursor this codec has already
 * verified" are two distinct types - nothing outside this codec ever
 * touches an unverified payload.
 *
 * <p>{@code boundaryEpochMillis} (not {@code java.time.Instant}) so this
 * type never depends on Jackson's {@code JavaTimeModule} being registered
 * on whatever {@code ObjectMapper} is injected - this codec's own
 * correctness must not depend on an external Jackson configuration choice.
 */
record PageCursorPayload(
    int version,
    String sourceId,
    long boundaryEpochMillis,
    Set<String> boundaryKeys,
    String direction,
    int pageIndex,
    String requestFingerprint
) {
}
