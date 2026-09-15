package com.logexplorer.api.dto;

import com.logexplorer.core.classify.ClassificationRule;

/** Create/update body. {@code expectedRevision} is the rules revision the edit was based on (optimistic concurrency). */
public record ClassificationRuleWriteRequestDto(Long expectedRevision, ClassificationRule rule) {
}
