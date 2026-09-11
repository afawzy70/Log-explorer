package com.logexplorer.api.dto;

import jakarta.validation.constraints.Size;

/** Commits the selected project. Safe, non-sensitive data (OS-1A §20). */
public record OpenShiftProjectSelectionDto(@Size(max = 253) String project) {}
