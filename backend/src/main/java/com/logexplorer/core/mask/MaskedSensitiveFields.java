package com.logexplorer.core.mask;

/**
 * The five sensitive fields after masking — safe to serialize to the
 * browser. This is the only form of that data the {@code api} package is
 * ever allowed to hold (enforced by an ArchUnit rule, see the {@code arch}
 * test package: no {@code api} class may depend on {@code
 * core.model.RawSensitiveFields}).
 */
public record MaskedSensitiveFields(
    String cif,
    String userName,
    String customerId,
    String deviceId,
    String deviceIp
) {
}
