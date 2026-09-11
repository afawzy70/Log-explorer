package com.logexplorer.api.dto;

/** One discovered workload (OS-1B §6). {@code kind} is the {@code WorkloadKind} enum name, e.g. {@code "DEPLOYMENT"}. */
public record OpenShiftWorkloadDto(String kind, String name, int desiredReplicas, int readyReplicas) {}
