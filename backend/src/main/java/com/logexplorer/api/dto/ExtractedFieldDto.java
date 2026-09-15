package com.logexplorer.api.dto;

/**
 * One extracted value. {@code value} is {@code null} unless {@code status}
 * is {@code PRESENT} — an absent value is reported as absent, never
 * fabricated. {@code redacted} is true when the server replaced any part of
 * the value; {@code truncated} when it was cut to the returned length limit.
 */
public record ExtractedFieldDto(String name, String label, String value, String status, boolean redacted,
    boolean truncated) {
}
