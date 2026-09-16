package com.logexplorer.api.dto;

import com.logexplorer.core.classify.ClassificationEngine;
import com.logexplorer.core.classify.ClassificationRule;
import com.logexplorer.core.classify.FieldRef;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The rules configuration as the Settings workspace sees it. {@code
 * storageFile} is the server-side location of the rules file (shown so an
 * operator can confirm persistence; never part of an exported pack).
 */
public record ClassificationRulesStateDto(
    long revision,
    Instant updatedAt,
    String status,
    String statusMessage,
    String storageFile,
    List<ClassificationRule> rules,
    List<String> tags,
    /** The one colour each tag is drawn in ({@code core.classify.TagColorPolicy}), as semantic palette names. */
    Map<String, String> tagColors,
    Map<String, Integer> limits,
    List<FieldRef.FieldOption> fields,
    ClassificationEngine.RuntimeStats runtime
) {
}
