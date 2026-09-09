# Audit 11 — Data Fields

**Scope:** The complete data model exposed by the OLD app — the canonical `LogEvent` fields, origin metadata, raw fields, masked MDC, and the exact masking rules per sensitive field.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Canonical `LogEvent` / `LogEventFull` fields

The JSON response model `LogEventFull` (frontend `models/api.ts`) mirrors the backend `LogEvent`:

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | string (ISO) | event time. |
| `schemaVersion` | string | parser schema version. |
| `service` | string | from `application`/`app` label. |
| `severity` | string | level text (via `LogSeverity`). |
| `severityNumber` | number | numeric severity. |
| `message` | string | dominant message text. |
| `logger` | string | logger name. |
| `thread` | string | thread name. |
| `exception` | string \| null | formatted stack trace (rendered in `<pre>`). |
| `traceId` | string \| null | |
| `spanId` | string \| null | |
| `journeyId` | string \| null | |
| `correlationId` | string \| null | |
| `eventId` | string \| null | |
| `businessStep` | string \| null | |
| `uiIdentifier` | string \| null | |
| `errorCode` | string \| null | |
| `rawFields` | Record<string,string> | flattened snapshot of the whole log line; sensitive keys masked. |
| `maskedMdc` | Record<string,string> | MDC already **masked** server-side. |
| `origin` | `LogOriginMetadata` | see below. |

**Server-only (never serialized):** `searchTokens` (keyed HMAC) and `sensitiveOriginals` (raw values kept only server-side for per-field unmask), both `@JsonProperty(WRITE_ONLY)`.

## 2. `LogOriginMetadata`

| Field | Type |
|-------|------|
| `source` | string (e.g. `docker-compose`, `openshift-dev`, `fixture`) |
| `containerName` | string \| null |
| `podName` | string \| null |
| `namespace` | string \| null |
| `adapterMetadata` | Record<string,unknown> |

## 3. Masked MDC vs rawFields distinction

- **`maskedMdc`** — derived from merged MDC, keyed by plain names (`cif`, `CustomerId`, `UserName`, `deviceId`, `deviceIp`), always masked via `SensitiveFieldMasker.maskMdc`.
- **`rawFields`** — flattened RFC/JSON snapshot of the whole log line (incl. `mdc.*` prefixes and enriched `_loki_*`, `_composeProject`, `_composeService`, `_containerName`, `_source`, `_logSource`), with sensitive keys masked.
- Both are re-processed at the response boundary by `MaskingService.maskMap`, which honors per-field overrides by looking up raw originals by base field name.

## 4. Masking rules per sensitive field (`SensitiveFieldMasker`, `MaskingPolicy`)

| Field | Strategy | Rule |
|-------|----------|------|
| `cif` | FULL | `***` (fully masked). |
| `CustomerId` | PARTIAL | keep first `max(1, length/4)` chars then `***`. |
| `UserName` | PARTIAL | keep first `max(1, length/4)` chars then `***`. |
| `deviceId` | PREFIX2 | keep first 2 chars then `***`. |
| `deviceIp` | IP | IPv4: `a.b.*.*` (mask last two octets); otherwise partial mask. |

Frontend convenience mirror (`utils/format.ts` `maskSensitiveValue`-adjacent `SENSITIVE_FIELDS`): `cif, UserName, CustomerId, deviceId, deviceIp`.

### Free-text redaction (`MaskingPolicy.redactText`)
Text patterns redacted: Bearer tokens, credential assignments, emails, phone/card/account numbers, etc. — applied to `message`/`exception` at the response boundary when masking is active.

## 5. Canonical parser leading/top-level fields detected (Docker integration sample)

`@timestamp`, `@version`, `application`, `level`, `level_value`, `logger_name`, `message`, `thread_name`, `stack_trace`.

Mapped: `@timestamp`→timestamp, `application`→service, `level`→severity, `message`→message. Remaining canonical fields (`traceId`, `spanId`, correlation/journey/event IDs, `ERROR_CODE`, nested `mdc`) covered by unit tests; not present in the bounded live sample windows.

## 6. Inspector canonical field list (23 keys)

`timestamp, schemaVersion, service, severity, severityNumber, message, logger, thread, exception, traceId, spanId, correlationId, journeyId, eventId, businessStep, uiIdentifier, errorCode, source, composeProject, containerName, podName, namespace, stream`.

## 7. Live-tail payload fields (`LogTailController.eventPayload`)

`timestamp`, `receivedAt` (server ms), `service`, `severity`, `message`, `logger`, `thread`, `traceId`, `spanId`, `correlationId`, `journeyId`, `eventId`, `businessStep`, `errorCode`, `maskedMdc`, `droppedSinceLastEvent`. Frontend `LogTailEvent` additionally carries `clockSkew` and optional `receivedAt`.

---

## Data-field gaps / notes (OLD)

1. **SpanId** present but no backend span-follow handler exists (find not wired).
2. **`uiIdentifier`** is accepted and matched only by the Docker source (`matchesStructuredFields`); not used for filtering elsewhere.
3. **Exception/stack** rendered as text in `<pre>` (safe, no HTML).
4. **Sensitive values never leave the backend unmasked** unless a per-field/session unmask is active (dev-only, gated).
