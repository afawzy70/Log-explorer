package com.logexplorer.core.mapping.scan;

/**
 * One bounded representative <b>actual original source event</b> (owner
 * mission §A3/§A5 — "Original Event Samples," real source JSON, unchanged,
 * NOT normalized into {@code CanonicalLogEvent} first).
 *
 * <p>{@code originalJson} is the real {@code
 * CanonicalLogEvent#originalRawJson()} text, verbatim — never re-serialized
 * or reshaped. {@code severity} is the normalized (uppercased, {@code
 * "UNKNOWN"} when absent) severity used to drive scan diversity, kept here
 * only for display grouping. {@code structuralFingerprint} identifies which
 * distinct JSON shape this sample represents (see {@link
 * StructuralSignature#fingerprint()}) — this is exactly why this event, and
 * not another with the same severity, was retained.
 */
public record OriginalEventSample(
    String originalJson,
    String severity,
    boolean malformed,
    String structuralFingerprint
) {
}
