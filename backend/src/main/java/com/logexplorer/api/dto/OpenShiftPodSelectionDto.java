package com.logexplorer.api.dto;

import jakarta.validation.constraints.Size;

/** Commits a pod selection (OS-1B §13). {@code null}/blank means "All pods". */
public record OpenShiftPodSelectionDto(@Size(max = 253) String pod) {}
