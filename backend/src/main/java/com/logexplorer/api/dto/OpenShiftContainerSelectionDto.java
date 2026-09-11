package com.logexplorer.api.dto;

import jakarta.validation.constraints.Size;

/** Commits a container selection (OS-1B §13). {@code null}/blank means "All containers". */
public record OpenShiftContainerSelectionDto(@Size(max = 253) String container) {}
