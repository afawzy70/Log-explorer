package com.logexplorer.core.mapping.scan;

/**
 * One bounded representative <b>actual original source event</b> (owner
 * mission "Field Mapping Schema Scan + Masking Policy Extension" §A3/§A5 —
 * "Original Event Samples," real source JSON, unchanged, NOT normalized
 * into {@code CanonicalLogEvent} first).
 *
 * <p>{@code originalJson} is the real {@code
 * CanonicalLogEvent#originalRawJson()} text, verbatim — never re-serialized
 * or reshaped. {@code severity} is the normalized (uppercased, {@code
 * "UNKNOWN"} when absent) severity used to drive scan diversity, kept here
 * only for display grouping. {@code structuralFingerprint} identifies which
 * distinct JSON shape this sample represents (see {@link
 * StructuralSignature#fingerprint()}) — this is exactly why this event, and
 * not another with the same severity, was retained.
 *
 * <p>{@code classification} (owner mission "Project-Scoped Schema Scan"
 * §5) is what determines whether this sample can ever appear among {@code
 * SchemaScanResult#representativeEvents()} (only {@code
 * STRUCTURED_JSON_APPLICATION_EVENT}) or only among {@code
 * SchemaScanResult#diagnosticNonJsonSamples()} (only {@code
 * NON_JSON_OR_MALFORMED_EVENT}) — {@link SchemaScanService} enforces this
 * split; the two lists are never mixed.
 */
public record OriginalEventSample(
    String originalJson,
    String severity,
    EventClassification classification,
    String structuralFingerprint
) {

  public boolean malformed() {
    return classification == EventClassification.NON_JSON_OR_MALFORMED_EVENT;
  }
}
