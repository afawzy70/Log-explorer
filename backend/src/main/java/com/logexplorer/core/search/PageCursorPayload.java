package com.logexplorer.core.search;

import java.util.Set;

/**
 * The exact JSON shape signed/verified inside an opaque pagination cursor
 * (see {@link PageCursorCodec}). Kept separate from {@link PageCursor} so
 * "bytes that came off the wire" and "a cursor this codec has already
 * verified" are two distinct types - nothing outside this codec ever
 * touches an unverified payload.
 *
 * <p>{@code boundarySourceEpochNanos} (Legacy Remediation Slice 1 recovery,
 * mandatory blocker #1) is the previous page's boundary event's *native
 * adapter clock* position (Docker engine timestamp / Loki stream-entry
 * nanos / fixture's own deterministic instant - never the parsed
 * application timestamp, which can be {@code null}), as a plain {@code
 * long} - not {@code java.time.Instant}, so this codec's correctness never
 * depends on Jackson's {@code JavaTimeModule} being registered on whatever
 * {@code ObjectMapper} is injected. It is a plain, non-sensitive position
 * marker (comparable to a timestamp), not user data, so it is never hashed
 * or hidden - only the boundary-event *tie-break* keys ({@code
 * boundaryTieKeys}) and the request-binding fingerprint carry a keyed HMAC
 * (mandatory blocker #3), since those are derived from content that must
 * not be offline-guessable.
 */
record PageCursorPayload(
    int version,
    String sourceId,
    long boundarySourceEpochNanos,
    Set<String> boundaryTieKeys,
    String direction,
    int pageIndex,
    String requestBindingHmac
) {
}
