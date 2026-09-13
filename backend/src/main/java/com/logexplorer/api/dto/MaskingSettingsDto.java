package com.logexplorer.api.dto;

/**
 * Pre-closure functional recovery (§11/§12): the current global,
 * source-independent masking policy for the five protected fields — never
 * a value, only whether each field is currently masked. Safe to serialize
 * as-is; there is nothing sensitive in a boolean.
 */
public record MaskingSettingsDto(boolean cif, boolean userName, boolean customerId, boolean deviceId, boolean deviceIp) {}
