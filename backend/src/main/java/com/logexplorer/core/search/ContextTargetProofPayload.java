package com.logexplorer.core.search;

/**
 * The exact JSON shape signed/verified inside an opaque {@code
 * ContextTargetProofCodec} proof. Kept separate from any decoded/validated
 * concept the same way {@link PageCursorPayload} is kept separate from
 * {@link PageCursor} — nothing outside {@link ContextTargetProofCodec}
 * ever touches an unverified payload.
 *
 * <p>Every field here is structural (source id, connection generation,
 * namespace, pod, container name) — none of it is a sensitive value, so
 * none of it needs to be hashed the way {@link PageCursorCodec}'s
 * fingerprints hash raw filter values; the HMAC signature exists purely to
 * make the envelope non-forgeable (a caller cannot fabricate a proof for a
 * target the server itself never issued one for), not to hide these
 * field values, which are already visible in the same request anyway.
 */
record ContextTargetProofPayload(
    int version,
    String sourceId,
    long connectionGeneration,
    String namespace,
    String pod,
    String container
) {
}
