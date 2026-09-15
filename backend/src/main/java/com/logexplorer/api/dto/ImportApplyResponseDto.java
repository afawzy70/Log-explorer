package com.logexplorer.api.dto;

/** Import outcome with the resulting rules state. */
public record ImportApplyResponseDto(ClassificationRulesStateDto state, int added, int replaced, int unchanged,
    int keptExisting, int removed) {
}
