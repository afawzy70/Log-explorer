package com.logexplorer.core.classify;

/**
 * Health of the rules configuration.
 * <ul>
 *   <li>{@code OK} — the rules file is valid, or does not exist yet (no rules);
 *   <li>{@code RECOVERED_FROM_BACKUP} — the primary file was missing or invalid and the last-known-good backup is active;
 *   <li>{@code INVALID} — neither file is usable; classification is off, search keeps working.
 * </ul>
 */
public enum ConfigurationStatus { OK, RECOVERED_FROM_BACKUP, INVALID }
