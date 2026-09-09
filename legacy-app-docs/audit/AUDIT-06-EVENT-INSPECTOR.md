# Audit 06 — Event Inspector

**Scope:** The OLD app's event-detail inspector (`EventInspector`), its tabs, fields, copy/find/context rules, masking, and navigation.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Overview

- A **resizable modal dialog** (320–640px) that renders alongside the results table (persistent; does not hide the list).
- Focus trap + inert background; **Escape closes and returns focus** to the originating row.
- Prev/next navigation (search results only; bounded by first/last).
- Answers the stakeholder "explain one event" task: what (title), when (local+UTC ms), where (overview/origin), who (masked actor), IDs (request flow), ±30s context.

---

## 2. Tabs

| Tab | Contents |
|-----|----------|
| **Overview** | canonical fields (timestamp, level, severity, logger, thread, message, exception). |
| **Actor** | protected sensitive actor fields (UserName, CustomerId, CIF/cif, deviceId, deviceIp) — **masked, no reveal/copy**. |
| **Flow** | request-flow IDs (journey/correlation/trace/span/event) with Copy (non-sensitive) + Find (only when handler wired). |
| **Business** | businessStep, uiIdentifier, errorCode. |
| **All fields** | canonical + extra raw fields + sanitized raw JSON. |

---

## 3. Field model (`utils/eventInspector.ts`)

- **Canonical fields** — ordered list of 23 keys: timestamp, schemaVersion, service, severity, severityNumber, message, logger, thread, exception, traceId, spanId, correlationId, journeyId, eventId, businessStep, uiIdentifier, errorCode, source, composeProject, containerName, podName, namespace, stream.
- **Actor fields** (`ACTOR_KEYS`): UserName, CustomerId, CIF, cif, deviceId, deviceIp — always `sensitive:true`, deduped by label.
- **Client fields**: devicePlatform / Platform, deviceLanguage / Language / language — `sensitive:false`.
- **Combined map** merges `rawFields` then `maskedMdc`.
- **Extra fields**: non-canonical from combined map, sorted, `sensitive` via `isSensitiveField`.
- **`sanitizedRawJson`**: JSON stringify with a replacer forcing sensitive string values to `"***"`.

## 4. Copy / Find / Context rules

| Element | Copy? | Find? | Rule |
|---------|-------|-------|------|
| Trace/correlation/journey/event ID | **Copy** | **Find** (when `onSearch*` provided) | non-sensitive. |
| Span ID | Copy | **no Find** (no span handler) | non-sensitive. |
| message / correlationId | Copy | — | non-sensitive. |
| Sensitive fields (actor/MDC) | **no Copy** | **no Find** | `Protected` badge; title "cannot be revealed or copied". |

- `renderField`: sensitive → Protected badge, no copy/reveal.
- Context: "Show surrounding logs (±30s)" button when `onShowContext` present; window `CONTEXT_WINDOW_SECONDS=30`, range = `timestamp ±30s` (`contextRange`).
- Find buttons appear only when the ID is present AND the matching handler is wired.

## 5. Masking tie-in

- Displays `maskedMdc` exactly as received from backend (never reconstructs raw values).
- Raw values only ever surfaced via per-field unmask (Settings, gated) for server-side original serving — client still renders returned masked/redacted values.
- `sanitizedRawJson` ensures raw JSON view never leaks sensitive values.

## 6. Navigation

| Action | Result |
|--------|--------|
| Open | click row / Enter / ⋯ menu "details". |
| Prev/Next | `handleInspectorPrevious/Next` (search-only). |
| Escape / click outside | close; focus restored to originating row. |

## 7. Accessibility

- Labeled dialog region; focus trap; Escape close.
- Rows keyboard-activatable; screen-reader safe (no per-event pings).
- Contrast per WCAG 2.2 AA tokens.

---

## Gaps / notes (OLD)

1. **Prev/next not available in live/context mode.**
2. **Span ID has no Find** (no backend span handler wired).
3. Dependent on backend masking being active; if masking is disabled, sensitive values could be returned unmasked (see Audit 10 Settings).
4. `InspectorProps` type is exported but only used by a test.
