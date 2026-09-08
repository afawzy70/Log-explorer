package com.logexplorer.api.dto;

import com.logexplorer.core.model.ResultCounts;
import java.util.List;

public record SearchResponseDto(
    List<EventDto> events,
    ResultCounts counts,
    String nextCursor
) {
}
