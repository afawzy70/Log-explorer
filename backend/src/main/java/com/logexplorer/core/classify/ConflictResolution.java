package com.logexplorer.core.classify;

/** Explicit, required choice for MERGE when an imported rule has the same id as a different existing rule. */
public enum ConflictResolution { KEEP_EXISTING, USE_IMPORTED }
