package com.logexplorer.source.docker;

import java.time.Instant;

/**
 * One line read from a container's log stream, before parsing.
 *
 * @param dockerTimestamp Docker's own per-line receive timestamp (parsed
 *     from the {@code withTimestamps(true)} prefix) — used only for
 *     cross-container merge ordering, never as the event's own {@code
 *     timestamp} (that comes from {@code LogLineParser} parsing {@code
 *     content} itself). {@code null} if Docker didn't supply one.
 * @param stream {@code "stdout"} or {@code "stderr"} — {@code "stdout"} for
 *     {@code Tty=true} containers too, since Docker doesn't multiplex
 *     their output (reported as {@code StreamType.RAW}) and there is
 *     nothing to distinguish it by.
 */
public record DockerLogLine(Instant dockerTimestamp, String stream, String content) {
}
