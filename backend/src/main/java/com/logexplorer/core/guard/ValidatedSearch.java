package com.logexplorer.core.guard;

import java.time.Duration;

/** Output of {@link SearchGuardrails#validate} — the effective, enforced parameters to execute with. */
public record ValidatedSearch(int effectiveLimit, Duration timeout) {
}
