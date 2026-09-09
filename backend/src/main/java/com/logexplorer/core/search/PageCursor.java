package com.logexplorer.core.search;

import java.time.Instant;
import java.util.Set;

/**
 * The decoded, already-verified payload of an opaque pagination cursor
 * (Legacy Remediation Slice 1, {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md}
 * §"Slice 1 — Result-set completeness"). Never constructed directly from
 * untrusted input — only {@link PageCursorCodec#decodeAndValidate} produces
 * one, after verifying the HMAC and the request-fingerprint binding.
 *
 * <p>{@code boundaryTimestamp}/{@code boundaryKeys} identify exactly which
 * events the previous page already returned at its oldest timestamp, so the
 * next page can safely re-include that exact instant (Loki/Docker have no
 * native "resume after this row" cursor — see {@link PageCursorCodec}'s own
 * javadoc) without silently skipping or duplicating an event that shares
 * that timestamp.
 */
public record PageCursor(
    int version,
    String sourceId,
    Instant boundaryTimestamp,
    Set<String> boundaryKeys,
    String direction,
    int pageIndex,
    String requestFingerprint
) {
}
