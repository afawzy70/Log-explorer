package com.logexplorer.api.dto;

import java.util.List;

/**
 * One classification rule that matched an event, as sent to the browser.
 * Every extracted value has already passed the server-side masking and
 * redaction boundary ({@code core.mask.ExtractedValueRedactor}).
 */
public record ClassificationDto(String ruleId, String ruleName, List<String> tags, List<ExtractedFieldDto> extracted) {
}
