package com.logexplorer.core.model;

/**
 * Holds the five sensitive fields (cif, userName, customerId, deviceId,
 * deviceIp) in their raw, unmasked form.
 *
 * <p>{@link #toString()} always returns a fixed redacted string, regardless
 * of the actual field values. This is deliberate defense-in-depth: an
 * accidental {@code log.info("{}", event)} anywhere in the codebase — now or
 * in a future phase — cannot leak these values via {@code toString()},
 * which is exactly the leak path CLAUDE.md's security rules call out by
 * name. Only {@link com.logexplorer.core.mask.MaskingService} is permitted
 * (via an ArchUnit rule enforced in the API layer, see the {@code arch}
 * test package) to read the real values out of an instance of this type.
 */
public record RawSensitiveFields(
    String cif,
    String userName,
    String customerId,
    String deviceId,
    String deviceIp
) {

  private static final RawSensitiveFields EMPTY = new RawSensitiveFields(null, null, null, null, null);

  public static RawSensitiveFields empty() {
    return EMPTY;
  }

  @Override
  public String toString() {
    return "RawSensitiveFields[REDACTED]";
  }
}
