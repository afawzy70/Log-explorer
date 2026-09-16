# Classification rule file formats

Log Explorer uses two versioned JSON formats for classification rules. Both start at `schemaVersion` 1.

- **Unsupported versions.** A file with a newer `schemaVersion` than this build supports is rejected with a clear
  message. It is never read partially.
- **Unknown properties.** Unknown properties are errors, not silently ignored.
- **Migrations.** Future schema versions are upgraded by registered migrations (`RulesSchemaMigrator`).

| Format | `format` value | Purpose |
|---|---|---|
| Internal rules file | `log-explorer-classification-rules` | The server's own configuration (`classification-rules.json`). Includes a `revision` for conflict detection. Do not copy it between installations — use a pack. |
| Portable rule pack | `log-explorer-classification-pack` | Import / export between installations. Rule definitions only. |

## Rule

| Property | Type | Required | Notes |
|---|---|---|---|
| `id` | string | in packs; generated on create | `^[a-z0-9][a-z0-9-]{0,63}$`. Identity for import conflicts. |
| `name` | string | yes | ≤ 80 characters |
| `description` | string | no | ≤ 500 characters |
| `tags` | string[] | yes, 1–5 | Stored lowercase. `^[a-z0-9][a-z0-9._-]{0,39}$` |
| `displayColor` | `GRAY` \| `BLUE` \| `CYAN` \| `GREEN` \| `AMBER` \| `ORANGE` \| `RED` \| `PURPLE` | no | How this rule's tags are drawn. A semantic name, never a CSS value. Omitted means a deterministic default derived from the first tag, so a file or pack written before this field existed still loads. Two rules that share a tag must give it the same colour; a conflict is reported and refused, never resolved silently. |
| `enabled` | boolean | no | Default `true` |
| `priority` | integer | no | 0–10000, default 100. Lower runs first; ties are broken by `id`. |
| `matchMode` | `ALL` \| `ANY` | no | Default `ALL` |
| `conditions` | Condition[] | yes, 1–10 | |
| `extractions` | Extraction[] | no, ≤ 20 | |
| `createdAt`, `updatedAt` | ISO-8601 instant | internal file only | Never exported |

### Condition

| Property | Type | Notes |
|---|---|---|
| `field` | string | One of the following (protected identifiers are not addressable):<br>• a canonical field: `message`, `service`, `severity`, `logger`, `thread`, `exception`, `businessStep`, `errorCode`, `uiIdentifier`, `journeyName`, `traceId`, `spanId`, `correlationId`, `journeyId`, `eventId`, `devicePlatformType`, `language`, `serverHost`, `serverIp`, `rawLine`<br>• `extra.<key>`<br>• `mdc.<key>` |
| `matcher` | `EXACT` \| `CONTAINS` \| `STARTS_WITH` \| `REGEX` | `REGEX` is RE2 syntax. It is found anywhere in the value. |
| `value` | string | ≤ 1,000 characters. Leading and trailing spaces are kept. |
| `ignoreCase` | boolean | Default `false` |

### Extraction

| Property | Type | Notes |
|---|---|---|
| `name` | string | Output name, `^[A-Za-z][A-Za-z0-9_]{0,39}$`, unique within the rule |
| `label` | string | Optional display label, ≤ 60 characters |
| `sourceField` | string | Same references as `Condition.field` |
| `type` | `REGEX` \| `JSON_POINTER` | |
| `expression` | string | `REGEX`: an RE2 expression with a capture group. `JSON_POINTER`: an RFC 6901 pointer starting with `/`. |
| `group` | string | `REGEX` only: a group name or 1-based index. When omitted, a named group equal to `name` is used, or the only group. |
| `valueType` | `STRING` \| `INTEGER` \| `DECIMAL` \| `BOOLEAN` | Default `STRING`. A value that cannot be converted is reported as invalid, never guessed. |
| `sensitive` | boolean | Default `false`. When `true`, the value is never shown — only `[REDACTED]`. |

## Internal rules file

```json
{
  "format" : "log-explorer-classification-rules",
  "schemaVersion" : 1,
  "revision" : 3,
  "updatedAt" : "2026-09-15T10:00:00Z",
  "rules" : [ ]
}
```

- **Revision.** `revision` increases on every successful write. A save or import based on an older revision is
  rejected with HTTP 409.
- **Rule order.** Rules are stored in evaluation order.

## Portable rule pack — synthetic example

```json
{
  "format" : "log-explorer-classification-pack",
  "schemaVersion" : 1,
  "pack" : {
    "name" : "Example middleware rules",
    "version" : "1",
    "exportedAt" : "2026-09-15T10:00:00Z"
  },
  "rules" : [ {
    "id" : "middleware-http-call",
    "name" : "Middleware HTTP Call",
    "description" : "Outbound webhook calls made by the gateway",
    "tags" : [ "middleware" ],
    "enabled" : true,
    "priority" : 100,
    "matchMode" : "ALL",
    "conditions" : [
      { "field" : "message", "matcher" : "STARTS_WITH", "value" : "Make webhook call to", "ignoreCase" : false },
      { "field" : "message", "matcher" : "CONTAINS", "value" : "responseCode=", "ignoreCase" : false }
    ],
    "extractions" : [
      { "name" : "url", "label" : "URL", "sourceField" : "message", "type" : "REGEX",
        "expression" : "\\bto\\s+(?P<url>\\S+)", "valueType" : "STRING", "sensitive" : false },
      { "name" : "responseCode", "label" : "Response code", "sourceField" : "message", "type" : "REGEX",
        "expression" : "responseCode=(?P<responseCode>\\d+)", "valueType" : "INTEGER", "sensitive" : false },
      { "name" : "durationMs", "label" : "Duration (ms)", "sourceField" : "message", "type" : "REGEX",
        "expression" : "duration=(?P<durationMs>\\d+)ms", "valueType" : "INTEGER", "sensitive" : false }
    ]
  } ]
}
```

Everything in the example is made up. A pack never contains:
- log events or samples
- extracted runtime values
- credentials or tokens
- source connection settings
- local paths
- the internal revision

## Import rules

- **Allowed top-level properties:** only `format`, `schemaVersion`, `pack`, `rules`.
- **Size limits:** ≤ 256 KB and ≤ 200 rules.
- **Validation:**
  - every rule is validated exactly like a saved rule, including RE2 compilation;
  - duplicate ids in one pack are invalid.
- **Preview classification:** each rule is shown as
  - `NEW` — the id does not exist,
  - `IDENTICAL` — same content, ignoring timestamps,
  - `CONFLICT` — same id, different content,
  - `INVALID`.
- **Apply modes:**
  - `MERGE` requires `conflictResolution` (`KEEP_EXISTING` or `USE_IMPORTED`) whenever there are conflicts.
  - `REPLACE_ALL` requires `confirmReplaceAll: true`.
  - A pack with any invalid rule is not applied.
