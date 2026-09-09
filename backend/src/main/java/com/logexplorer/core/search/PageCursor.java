package com.logexplorer.core.search;

import java.time.Instant;
import java.util.Set;

/**
 * The decoded, already-verified payload of an opaque pagination cursor
 * (Legacy Remediation Slice 1, {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md}
 * §"Slice 1 — Result-set completeness", recovery per the owner/reviewer's
 * mandatory architecture corrections). Never constructed directly from
 * untrusted input — only {@link PageCursorCodec#decodeAndValidate} produces
 * one, after verifying the HMAC and the request-binding fingerprint.
 *
 * <p>{@code boundarySourceTimestamp} is the previous page's boundary
 * event's *native adapter clock* position (Docker engine timestamp / Loki
 * stream-entry nanos / fixture's own deterministic instant — see {@link
 * com.logexplorer.core.model.CanonicalLogEvent#sourceTimestamp()}), never
 * the parsed application timestamp (which can be {@code null} for a
 * malformed/non-JSON line — the exact problem mandatory blocker #1 fixes).
 * {@code boundaryTieKeys} (keyed HMAC, mandatory blocker #3 — never a
 * plain/public hash) identifies exactly which events the previous page
 * already returned at that exact native instant, so the next page can
 * safely re-include that instant without silently skipping or duplicating
 * an event that shares it (mandatory blocker #1's "duplicate-timestamp
 * safety" carried over from the source-native clock, which can also
 * collide — e.g. two Loki entries pushed in the same nanosecond).
 */
public record PageCursor(
    int version,
    String sourceId,
    Instant boundarySourceTimestamp,
    Set<String> boundaryTieKeys,
    String direction,
    int pageIndex,
    String requestBindingHmac
) {
}
