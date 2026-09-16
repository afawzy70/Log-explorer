/** Mirrors backend/src/main/java/com/logexplorer/api/dto/**, field for field. */

export interface SourceCapabilities {
  historicalSearch: boolean;
  liveTail: boolean;
  rawLogQL: boolean;
  serviceDiscovery: boolean;
  queryStatistics: boolean;
  contextView: boolean;
  /** UX-R3 — whether this source has a real Docker Compose "investigation scope" concept at all (true only for `local-docker`). Never inferred from the source id/name. */
  composeProjectScoping: boolean;
  /**
   * Configurable Log Field Mapping mission §6 — whether this source can
   * safely supply bounded, ephemeral Original Source JSON samples for the
   * Log Schema & Field Mapping settings workflow. Gates the "Fetch sample
   * events" control there — never inferred from source id/name.
   */
  originalSchemaSampling: boolean;
}

export interface SourceInfo {
  id: string;
  displayName: string;
  capabilities: SourceCapabilities;
}

export interface ServiceInfo {
  name: string;
  runningCount: number;
  totalCount: number;
}

export type SourceHealthStatus = 'UP' | 'DOWN' | 'DEGRADED';

export interface SourceHealth {
  status: SourceHealthStatus;
  message: string | null;
  checkedAt: string;
  /** Legacy Remediation Slice 6 - sanitized, fixed-vocabulary degradation reasons (e.g. "no containers matched..."). Always present, empty when there is nothing to warn about - never fabricated. */
  warnings: string[];
}

/**
 * `GET /api/v1/sources/{id}/health` (Legacy Remediation Slice 6) - the
 * persistent health badge's own richer shape. `latencyMs` is genuinely
 * measured server-side (`Mono#elapsed()`), never estimated; `capabilities`
 * is the exact same {@link SourceCapabilities} `GET /api/v1/sources`
 * already returns for this source, attached here too so one fetch carries
 * a complete picture. The ephemeral Docker "Test Connection" probe
 * (`testDockerConnection`) intentionally still returns the plainer {@link
 * SourceHealth} - a candidate connection has no registered capabilities to
 * attach.
 */
export interface SourceHealthDetail extends SourceHealth {
  latencyMs: number | null;
  capabilities: SourceCapabilities | null;
}

/**
 * `GET /actuator/info` (UI Gap Closure Pass) - the `environment` detail
 * `EnvironmentInfoContributor` adds server-side: the real, non-guessed
 * Spring profile(s) this specific running instance has active
 * (`"default"` when none are). Every field is optional - actuator's own
 * base info response can genuinely omit this detail entirely (e.g. a
 * future deployment with actuator's `info` endpoint disabled), and the
 * frontend must render nothing rather than guess when that happens.
 */
export interface EnvironmentInfo {
  environment?: {
    activeProfiles?: string[];
    label?: string;
  };
}

/**
 * `GET /api/v1/sources/docker/connection` (Legacy Remediation Slice 3) -
 * the current effective Docker connection, sanitized. `host`/`port` are
 * `null` for LOCAL mode. `runtimeMutationSupported` is always `false` in
 * this deployment (no authenticated admin boundary) - `settingsNote`
 * explains why and what to do instead.
 */
/**
 * Pre-closure functional recovery (§11/§12) - the global, source-
 * independent masking policy for the five protected fields. `true` means
 * masked (the safe default); `false` means the server will return the raw
 * value in NEW results going forward. Never carries an actual value.
 */
export interface MaskingSettings {
  cif: boolean;
  userName: boolean;
  customerId: boolean;
  deviceId: boolean;
  deviceIp: boolean;
}

export type ProtectedFieldKey = keyof MaskingSettings;

export interface DockerConnectionSummary {
  mode: 'LOCAL' | 'REMOTE';
  host: string | null;
  port: number | null;
  tlsEnabled: boolean;
  composeProjectFilter: string | null;
  runtimeMutationSupported: boolean;
  settingsNote: string;
  /** UX-R3 §6 — REMOTE mode only, purely cosmetic (e.g. "QA Docker"); `null` for LOCAL or when unset. */
  connectionName: string | null;
}

/**
 * `POST /api/v1/sources/docker/test-connection` body - an ephemeral
 * candidate, never persisted, never applied to the running application.
 * Never placed in localStorage/sessionStorage/the URL (CLAUDE.md §2 rule 4
 * - the same standard every other search value already gets).
 */
export interface DockerConnectionCandidate {
  mode: 'LOCAL' | 'REMOTE';
  host?: string;
  port?: number;
  tls?: boolean;
  tlsCertPath?: string;
}

/** Already-masked - safe to render as-is, never a "reveal" action (CLAUDE.md §2 rule 5). */
export interface MaskedSensitiveFields {
  cif: string | null;
  userName: string | null;
  customerId: string | null;
  deviceId: string | null;
  deviceIp: string | null;
}

export interface LogEvent {
  timestamp: string | null;
  timestampRaw: string | null;
  schemaVersion: string | null;
  service: string | null;
  serviceSourceHint: string | null;
  severity: string | null;
  severityNumber: number | null;
  message: string | null;
  logger: string | null;
  thread: string | null;
  exception: string | null;
  traceId: string | null;
  spanId: string | null;
  journeyId: string | null;
  eventId: string | null;
  businessStep: string | null;
  uiIdentifier: string | null;
  errorCode: string | null;
  correlationId: string | null;
  protectedFields: MaskedSensitiveFields;
  devicePlatformType: string | null;
  language: string | null;
  serverIp: string | null;
  serverHost: string | null;
  unknownTopLevelFields: Record<string, unknown>;
  unknownMdcFields: Record<string, unknown>;
  malformed: boolean;
  rawLine: string | null;
  sourceId: string | null;
  composeProject: string | null;
  /** Legacy Remediation Slice 3's backend field, mirrored here in Slice 4 so it can be offered as an optional table column - not previously present on this type. */
  composeService: string | null;
  containerId: string | null;
  containerName: string | null;
  stream: string | null;
  namespace: string | null;
  pod: string | null;
  /**
   * OS-1D review recovery — an opaque, server-issued, HMAC-signed proof
   * that this event's own (source, connection generation, namespace, pod,
   * container) tuple was a real, legitimately-resolved search target.
   * `null` for every source except OpenShift. Treat as fully opaque:
   * never display it, never persist it (localStorage or otherwise), never
   * copy it to the clipboard, never log it — it exists solely to be
   * echoed back verbatim on a later "Show surrounding logs" call (see
   * `ContextRequestBody#contextTargetProof`).
   */
  contextTargetProof: string | null;
  /**
   * Event Classification & Extraction Rules - the union of every tag the
   * server's saved rules applied to this event. Empty when no rule matched.
   */
  tags: string[];
  /** One entry per matching rule, in server order. Values are already masked/redacted server-side. */
  classifications: RuleMatchDto[];
}

/** `PRESENT` is the only status that ever carries a `value`. */
export type ExtractedValueStatus = 'PRESENT' | 'ABSENT' | 'INVALID';

export interface ExtractedFieldValue {
  name: string;
  label: string | null;
  value: string | null;
  status: ExtractedValueStatus;
  redacted: boolean;
  truncated: boolean;
}

/** One saved rule that matched one event (named `RuleMatchDto` to avoid clashing with the schema-scan `EventClassification`). */
export interface RuleMatchDto {
  ruleId: string;
  ruleName: string;
  tags: string[];
  /** The rule's semantic palette entry, so the table and the inspector draw the same identity. */
  displayColor?: TagColor | null;
  extracted: ExtractedFieldValue[];
}

export interface ResultCounts {
  estimatedTotal: number | null;
  returned: number;
  visible: number;
  limit: number;
  truncated: boolean;
}

/**
 * Query-plan transparency (Legacy Remediation Slice 2). Every field is
 * already safe to render as-is - the backend (`core.query.QueryPlanBuilder`)
 * redacts every DSL/free-text literal and the five protected structured
 * filters before this DTO is ever built; `resolvedQuery`/`*Conditions` never
 * carry a raw sensitive value.
 */
export interface QueryPlan {
  resolvedQuery: string;
  rawLogQlMode: boolean;
  pushedDownConditions: string[];
  postFilterConditions: string[];
  notes: string[];
}

export interface SearchResponse {
  events: LogEvent[];
  counts: ResultCounts;
  nextCursor: string | null;
  queryPlan: QueryPlan;
}

export type SearchDirection = 'FORWARD' | 'BACKWARD';

/**
 * Never persisted (localStorage or URL) as a whole - CLAUDE.md §2 rule 4.
 * `query` (Legacy Remediation Slice 2 guided/text authoring) and
 * `rawLogQl` (Slice 2's capability-gated expert mode) are exactly the same
 * class of value as `text` - never persisted, never put in a URL.
 */
export interface SearchRequestBody {
  sourceId: string;
  start: string;
  end: string;
  direction?: SearchDirection;
  limit?: number;
  services?: string[];
  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §A — whether `services` is an allow-list (only these)
   * or a deny-list (all except these). Omitted/`'INCLUDE'` matches every
   * existing caller's current behavior unchanged.
   */
  serviceFilterMode?: 'INCLUDE' | 'EXCLUDE';
  levels?: string[];
  text?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  journeyId?: string;
  eventId?: string;
  errorCode?: string;
  businessStep?: string;
  uiIdentifier?: string;
  loggerContains?: string;
  devicePlatform?: string;
  language?: string;
  cif?: string;
  userName?: string;
  customerId?: string;
  deviceId?: string;
  deviceIp?: string;
  query?: string;
  rawLogQl?: string;
  cursor?: string;
  /** UX-R3 §7/§8/§9 — request/session-scoped Docker Compose project selection, never sensitive. */
  composeProject?: string;
  /**
   * Event Classification & Extraction Rules - an event matches when it has
   * ANY of these tags. Enforced server-side after classification, on the
   * events each source actually retrieved (no source pushdown).
   */
  tags?: string[];
}

/**
 * `POST /api/v1/logs/context` body - "Show ±30 seconds" (IMPLEMENTATION_PLAN.md
 * "Phase H"). There is no client-supplied window size: the backend always
 * computes exactly ±30 seconds around `timestamp` itself
 * (`RequestMapper#toContextDomain`), never trusting a wider range from
 * here - `service`/`containerId`/`pod` only narrow the window further.
 */
export interface ContextRequestBody {
  sourceId: string;
  timestamp: string;
  service?: string;
  containerId?: string;
  pod?: string;
  /** UX-R3 §9 — request-scoped Docker Compose project selection. */
  composeProject?: string;
  /**
   * OS-1D — generic container-name scope hint, parallel to `containerId`
   * (Docker's own hash-based identity). Only ever set for a source (like
   * OpenShift) with no short container-id concept of its own, so "Show
   * surrounding logs" narrows to the exact (pod, container) the selected
   * event came from rather than the source's full currently-resolved scope.
   */
  containerName?: string;
  /**
   * OS-1D review recovery — echoed verbatim from the originally-selected
   * event's own `LogEvent#contextTargetProof`. Required by the backend
   * only when `pod`/`containerName` name a target that is no longer in
   * its currently cached OS-1B scope (a pod that disappeared since the
   * original search) — a target still in scope needs no proof at all.
   * Opaque: never displayed, never persisted, never logged.
   */
  contextTargetProof?: string;
}

/**
 * The exact five non-sensitive identifiers the Investigation Workspace
 * (owner mission "Mapping Verification and Investigation Workspace") can
 * search by — never a sensitive field, structurally. {@code spanId} added
 * alongside the original four (IMPLEMENTATION_PLAN.md "Phase I") so "View
 * Span" reuses this exact generic mechanism rather than a duplicate one.
 */
export type JourneyField = 'journeyId' | 'correlationId' | 'traceId' | 'spanId' | 'eventId';

/**
 * `POST /api/v1/logs/journey` body - "Click actions on non-sensitive IDs"
 * (IMPLEMENTATION_PLAN.md "Phase I", HANDOVER.md §17). `start`/`end` are
 * always the caller's own currently-committed search window - this
 * endpoint never invents or widens a "bounded time window" of its own.
 */
export interface JourneyRequestBody {
  sourceId: string;
  start: string;
  end: string;
  field: JourneyField;
  value: string;
  /** UX-R3 §9 — request-scoped Docker Compose project selection. */
  composeProject?: string;
}

/** RFC 7807, as GlobalExceptionHandler produces it. */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  reason?: string;
  position?: number;
  /** Classification rules - `RULE_INVALID` / `IMPORT_HAS_INVALID_RULES` carry per-path validation errors. */
  errors?: RuleValidationError[];
  /** Classification rules - `RULES_REVISION_CONFLICT` carries the revision the server now holds. */
  currentRevision?: number;
}

/**
 * OS-1A - the OpenShift connection summary.
 *
 * Note what this type cannot carry, deliberately and permanently: the
 * bearer token, any prefix or hash of it, or the pasted `oc login`
 * command. The backend has no endpoint that returns them, and the token
 * never enters the browser's memory beyond the single submit that
 * establishes the connection - it is never stored in React state after
 * that, never in `localStorage`, never in the URL (CLAUDE.md §2 rule 4).
 */
export interface OpenShiftConnectionSummary {
  state: 'DISCONNECTED' | 'CONNECTED' | 'EXPIRED' | 'FAILED';
  connectionName: string | null;
  /** host:port only - never a URL carrying credentials. */
  server: string | null;
  username: string | null;
  projectCount: number;
  projects: string[];
  selectedProject: string | null;
  tlsVerified: boolean;
  usingPrivateCa: boolean;
  /** Sanitized "host:port" of the proxy in use, or null for a direct connection. */
  proxy: string | null;
  /** Which API answered discovery, so the UI can stay truthful about what it lists. */
  projectApi: 'PROJECTS' | 'NAMESPACES' | null;
}

/**
 * Pre-closure functional recovery 2 (§B2/§B16) - the user-configurable
 * OpenShift/Loki proxy mode. `host`/`port` are meaningful only for
 * `CUSTOM`; `null` for `SYSTEM`/`DIRECT`, mirrored exactly as the backend
 * returns them (never guessed or coerced on the frontend).
 */
export type ProxyMode = 'SYSTEM' | 'DIRECT' | 'CUSTOM';

export interface OpenShiftProxySettings {
  mode: ProxyMode;
  host: string | null;
  port: number | null;
}

/**
 * A failure category from the backend's `reason` property. The UI must
 * distinguish these rather than showing one generic "connection failed" -
 * OS-1A §15/§18, and in particular `FORBIDDEN` (you may not list
 * projects) is a different truth from an empty project list.
 */
export type OpenShiftFailureReason =
  | 'NOT_AN_OC_LOGIN_COMMAND'
  | 'SHELL_SYNTAX_PRESENT'
  | 'UNKNOWN_FLAG'
  | 'DUPLICATE_FLAG'
  | 'MISSING_SERVER'
  | 'MISSING_TOKEN'
  | 'MALFORMED_SERVER_URL'
  | 'SERVER_NOT_HTTPS'
  | 'INSECURE_TLS_REFUSED'
  | 'MALFORMED_TOKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'TLS'
  | 'NETWORK'
  | 'PROXY'
  | 'MALFORMED_RESPONSE'
  | 'NON_LOOPBACK_BINDING'
  | 'STALE_CONNECTION'
  | 'STALE_SCOPE';

export interface OpenShiftFailure {
  message: string;
  reason: OpenShiftFailureReason | null;
}

/**
 * OS-1B - the workload kinds this slice discovers, in the deterministic
 * order the backend always reports them. Jobs/CronJobs are deferred, not
 * present here yet.
 */
export type OpenShiftWorkloadKind = 'DEPLOYMENT' | 'DEPLOYMENT_CONFIG' | 'STATEFUL_SET' | 'DAEMON_SET';

export interface OpenShiftWorkload {
  kind: OpenShiftWorkloadKind;
  name: string;
  desiredReplicas: number;
  readyReplicas: number;
}

/**
 * One workload kind's own discovery outcome (OS-1B §17) - never collapsed
 * into a single pass/fail for the whole discovery. `UNAVAILABLE_RESOURCE_TYPE`
 * means the cluster genuinely does not expose this kind's API (a 404);
 * `FORBIDDEN` means this user may not list it (a 403); `ERROR` is any
 * other real failure.
 */
export interface OpenShiftWorkloadKindOutcome {
  kind: OpenShiftWorkloadKind;
  status: 'AVAILABLE' | 'UNAVAILABLE_RESOURCE_TYPE' | 'FORBIDDEN' | 'ERROR';
}

export interface OpenShiftWorkloadDiscovery {
  status: 'SUCCESS' | 'PARTIAL' | 'FORBIDDEN';
  workloads: OpenShiftWorkload[];
  kindOutcomes: OpenShiftWorkloadKindOutcome[];
}

/**
 * One discovered pod (OS-1B §10) - safe scope metadata only. `workloadKind`/
 * `workloadName` are null when this pod came from an unscoped "All
 * workloads" union listing.
 */
export interface OpenShiftPod {
  name: string;
  phase: string;
  readySummary: string;
  restartCount: number;
  containerNames: string[];
  workloadKind: OpenShiftWorkloadKind | null;
  workloadName: string | null;
}

/**
 * {@code GET /pods} response (OS-1B review recovery - "All workloads"
 * scope truthfulness). `status` is `PARTIAL` when the pod list may be
 * incomplete - a supported workload kind could not be listed, or one
 * specific workload's own pods could not be resolved - and is always
 * `COMPLETE` when a single specific workload is selected. The pod list
 * itself is never widened to compensate for a `PARTIAL` result; it is
 * exactly what could be proven to belong to a known, supported workload.
 */
export interface OpenShiftPodDiscovery {
  status: 'COMPLETE' | 'PARTIAL';
  pods: OpenShiftPod[];
}

/** The current workload/pod/container selection (OS-1B §12) - a null field genuinely means "All" at that level. */
export interface OpenShiftScopeSummary {
  selectedProject: string | null;
  discoveryApi: 'PROJECTS' | 'NAMESPACES' | null;
  selectedWorkloadKind: OpenShiftWorkloadKind | null;
  selectedWorkloadName: string | null;
  selectedPod: string | null;
  selectedContainer: string | null;
}

/* ------------------------------------------------------------------ */
/* Configurable Log Field Mapping + Original JSON Sampling             */
/* ------------------------------------------------------------------ */

/** Stable wire key for one of the 24 canonical fields (`core.mapping.CanonicalField#key()`), e.g. `"cif"`, `"journeyName"`. */
export type CanonicalFieldKey = string;

/**
 * Owner mission "Mapping Verification and Investigation Workspace" -
 * exactly three statuses, no invented extra complexity.
 * `DEFAULT_MAPPING != VERIFIED_MAPPING`: a field starts `UNVERIFIED` even
 * when it carries the built-in default candidate - it becomes `VERIFIED`
 * only through an explicit, evidence-gated verify action (server-checked,
 * never a client-only claim), and reverts to `UNVERIFIED` the moment its
 * candidates are edited (never silently promoted back by a save alone).
 * `NEEDS_CHANGE` is a deliberate owner flag, set explicitly, never inferred.
 */
export type FieldVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'NEEDS_CHANGE';

export interface CanonicalFieldMapping {
  field: CanonicalFieldKey;
  displayName: string;
  /** Mirrors the backend's `core.mask.ProtectedField` set (CIF/Username/Customer ID/Device ID/Device IP). */
  sensitive: boolean;
  /** Ordered candidate JSON paths, first usable non-empty value wins. Empty means "not yet mapped" (e.g. Journey Name by default). */
  candidatePaths: string[];
  /** Scoped identically to the mapping profile itself (same `sourceId`/`project`) - never implies verified for any other source/project/namespace. */
  verificationStatus: FieldVerificationStatus;
}

/**
 * `GET/PUT/POST` response shape for every `/api/v1/settings/field-mapping`
 * endpoint. `sourceId`/`scopeLabel` (owner mission "Project-Scoped Schema
 * Scan" §7/§8) echo back exactly which source + Compose project/OpenShift
 * namespace this profile belongs to — `null` for the legacy/global scope
 * (no `sourceId`/`project` query params supplied) or a source with no
 * sub-project concept.
 */
export interface FieldMappingProfileDto {
  sourceId: string | null;
  scopeLabel: string | null;
  fields: CanonicalFieldMapping[];
  modifiedFromDefault: boolean;
  /**
   * Whether `/api/v1/logs/search` will currently accept a request for THIS
   * scope - `false` the moment a field is edited, until a validate-and-
   * save round trip with a passing report completes. Recalculated per
   * scope (mission §8): changing the selected project/namespace changes
   * this value. See `useSearchState`'s `fieldMappingSearchReady` state,
   * which mirrors this value app-wide for the currently selected scope.
   */
  searchReady: boolean;
}

export interface FieldMappingFieldValidation {
  field: CanonicalFieldKey;
  displayName: string;
  candidatePaths: string[];
  invalidPaths: string[];
  sampleCount: number;
  foundCount: number;
  foundInAnySample: boolean;
  mappedButAbsent: boolean;
  structuredValueWarning: boolean;
  /** Real, unmasked resolved values from the fetched samples - owner-approved exception for this privileged setup surface only. Never persist, never log. */
  exampleValues: string[];
}

export interface FieldMappingConflict {
  pathRaw: string;
  fields: CanonicalFieldKey[];
}

export interface FieldMappingValidationReport {
  fields: FieldMappingFieldValidation[];
  conflicts: FieldMappingConflict[];
  sampleCount: number;
  malformedSampleCount: number;
  /** `true` iff no candidate path anywhere failed to parse - the value to pass to `saveFieldMappingProfile`. */
  passed: boolean;
}

/** `POST /api/v1/sources/{id}/field-mapping/samples` response - `samples` are real, unmasked Original Source JSON strings. Hold only in component state, never `localStorage`. */
export interface FieldMappingSampleResponse {
  sourceId: string;
  requestedLimit: number;
  actualCount: number;
  samples: string[];
}

/** Owner mission "Project-Scoped Schema Scan" §5 — the two classification buckets every scanned event falls into. */
export type EventClassification = 'STRUCTURED_JSON_APPLICATION_EVENT' | 'NON_JSON_OR_MALFORMED_EVENT';

/**
 * Owner mission "Field Mapping Schema Scan + Masking Policy Extension" §A
 * — one bounded, real, unmasked Original Event Sample from a Quick Schema
 * Scan. Never called "Original JSON" in the UI when referring to the
 * *union* — this type is the real per-event sample; {@link
 * DiscoveredSchemaPathEntry} is the generated union (mission §A5).
 * `classification` (owner mission "Project-Scoped Schema Scan" §5)
 * determines whether this sample can ever appear as a `representativeEvents`
 * entry (`STRUCTURED_JSON_APPLICATION_EVENT` only) or only a
 * `diagnosticNonJsonSamples` entry.
 */
export interface OriginalEventSample {
  originalJson: string;
  severity: string;
  classification: EventClassification;
}

/** One row of the "Discovered Source Schema" union (mission §A4/§A7) — schema metadata only, never a raw value. */
export interface DiscoveredSchemaPathEntry {
  path: string;
  observedTypes: string[];
  occurrenceCount: number;
  coveragePercentage: number;
}

/**
 * `POST /api/v1/sources/{id}/field-mapping/schema-scan` response (mission
 * §A, project-scoped per owner mission "Project-Scoped Schema Scan" §1/§6).
 * `scopeLabel` is the real, resolved Compose project/OpenShift namespace
 * this scan ran against — `null` for a source with no sub-project concept
 * or none selected. `servicesObserved` is the distinct set of services
 * seen strictly inside that scope (mission §4/§6). `representativeEvents`
 * are real, unmasked Original Event Samples, structured JSON only — hold
 * only in component state, never `localStorage`, exactly like {@link
 * FieldMappingSampleResponse}. `diagnosticNonJsonSamples` are non-JSON/
 * malformed lines shown for diagnostics only — never used for field
 * mapping (mission §5). The `*LimitReached` flags say truthfully which
 * bound (if any) ended the scan early — the UI must present this schema as
 * "Observed," never "Complete/Guaranteed" (mission §A11).
 */
export interface SchemaScanResponse {
  sourceId: string;
  scopeLabel: string | null;
  servicesObserved: string[];
  totalEventsInspected: number;
  structuredJsonEventCount: number;
  nonJsonEventCount: number;
  structuralVariantCount: number;
  totalBytesInspected: number;
  eventLimitReached: boolean;
  byteLimitReached: boolean;
  durationLimitReached: boolean;
  representativeEvents: OriginalEventSample[];
  diagnosticNonJsonSamples: OriginalEventSample[];
  discoveredSchema: DiscoveredSchemaPathEntry[];
  /** Saved mapping candidate paths (mission §A9) that this scan did not observe anywhere in the current source data. */
  mappedPathsNotObserved: string[];
}

/* ------------------------------------------------------------------ */
/* Event Classification & Extraction Rules                             */
/* ------------------------------------------------------------------ */

/**
 * The controlled palette a rule's tags are drawn in. Colour is identity only - never severity, success or failure -
 * and never the only signal: a chip always carries its tag text.
 */
export type TagColor = 'GRAY' | 'BLUE' | 'CYAN' | 'GREEN' | 'AMBER' | 'ORANGE' | 'RED' | 'PURPLE';

export const TAG_COLORS: TagColor[] = ['GRAY', 'BLUE', 'CYAN', 'GREEN', 'AMBER', 'ORANGE', 'RED', 'PURPLE'];

export type RuleMatchMode = 'ALL' | 'ANY';
export type RuleMatcher = 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'REGEX';
export type ExtractionType = 'REGEX' | 'JSON_POINTER';
export type ExtractionValueType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN';

/** `field` is a canonical key (see `ClassificationRulesState.fields`), `extra.<key>` or `mdc.<key>`. */
export interface RuleCondition {
  field: string;
  matcher: RuleMatcher;
  value: string;
  ignoreCase?: boolean;
}

/** REGEX uses RE2 syntax with named groups; JSON_POINTER expressions start with "/". */
export interface ExtractionDefinition {
  name: string;
  label?: string;
  sourceField: string;
  type: ExtractionType;
  expression: string;
  group?: string;
  valueType?: ExtractionValueType;
  sensitive?: boolean;
}

/** Nulls are omitted by the server. Defaults: enabled=true, priority=100, matchMode=ALL, description="". */
export interface ClassificationRule {
  id?: string;
  name: string;
  description?: string;
  tags: string[];
  /** Optional: the server fills in a deterministic default derived from the first tag when it is omitted. */
  displayColor?: TagColor;
  enabled?: boolean;
  priority?: number;
  matchMode?: RuleMatchMode;
  conditions: RuleCondition[];
  extractions?: ExtractionDefinition[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleValidationError {
  path: string;
  message: string;
}

export interface RuleValidationResult {
  valid: boolean;
  errors: RuleValidationError[];
}

export interface ClassificationRuleField {
  key: string;
  label: string;
}

export interface ClassificationRuntimeStats {
  eventsEvaluated: number;
  ruleMatches: number;
  evaluationFailures: number;
}

export interface ClassificationRulesState {
  revision: number;
  updatedAt: string | null;
  status: 'OK' | 'RECOVERED_FROM_BACKUP' | 'INVALID';
  statusMessage: string | null;
  storageFile: string;
  rules: ClassificationRule[];
  tags: string[];
  /** The one colour each tag resolves to, so every surface draws a tag the same way. */
  tagColors: Record<string, TagColor>;
  limits: Record<string, number>;
  fields: ClassificationRuleField[];
  runtime: ClassificationRuntimeStats;
}

/** The bounded sample a detect/test call reads - mirrors the committed search scope. */
/**
 * The committed search scope a bounded classification sample is read from.
 *
 * Mirrors `SearchRequestBody` field for field, apart from what a sample owns
 * itself: `direction`/`limit`/`cursor` (sampling is always one bounded
 * newest-first page) and `tags` - a classification tag filter is deliberately
 * not carried, because sampling through the tags of the saved rules while a
 * rule is being authored would make the evidence depend on the very
 * classification being created. Everything else the user actually searched
 * with is preserved, so Detect and Test sample the same population the
 * selected event is visible in.
 *
 * `anchorTimestamp` lets the server guarantee the selected event takes part
 * even when the bounded page would have stopped short of it.
 */
export interface ClassificationSampleScope {
  sourceId: string;
  composeProject?: string | null;
  start: string;
  end: string;
  services?: string[];
  serviceFilterMode?: 'INCLUDE' | 'EXCLUDE';
  levels?: string[];
  text?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  journeyId?: string;
  journeyName?: string;
  eventId?: string;
  errorCode?: string;
  businessStep?: string;
  uiIdentifier?: string;
  loggerContains?: string;
  devicePlatform?: string;
  language?: string;
  cif?: string;
  userName?: string;
  customerId?: string;
  deviceId?: string;
  deviceIp?: string;
  query?: string;
  rawLogQl?: string;
  anchorTimestamp?: string | null;
}

export interface PatternDetectionRequest {
  field: string;
  anchorValue: string;
  scope: ClassificationSampleScope;
  sampleSize?: number;
}

export interface DetectedVariableSegment {
  name: string;
  kind: string;
  example: string;
}

export interface DetectionCoverage {
  matchedSimilar: number;
  similar: number;
  matchedOther: number;
  other: number;
}

export interface SuggestedExtraction {
  definition: ExtractionDefinition;
  extracted: number;
  of: number;
}

/** A suggestion only - nothing is saved by `/detect`. */
export interface PatternDetectionResult {
  status: 'SUGGESTED' | 'NO_SAFE_PATTERN_SUGGESTION';
  reason: string | null;
  field: string;
  structure: 'TEXT' | 'JSON';
  sampledEvents: number;
  valuesWithField: number;
  similarEvents: number;
  stableSegments: string[];
  variableSegments: DetectedVariableSegment[];
  suggestedMatchMode: RuleMatchMode | null;
  suggestedConditions: RuleCondition[];
  suggestedPattern: string | null;
  coverage: DetectionCoverage | null;
  suggestedExtractions: SuggestedExtraction[];
  warnings: string[];
}

/**
 * "Suggest extractions" - mine the events a rule actually matches, inside the committed search scope, for values
 * worth pulling out. Send either a saved `ruleId` or the unsaved `rule` being authored.
 */
export interface ExtractionSuggestionRequest {
  ruleId?: string;
  rule?: ClassificationRule;
  field?: string;
  anchorValue?: string;
  scope: ClassificationSampleScope;
  sampleSize?: number;
}

export interface ExtractionSuggestionResult {
  status: 'SUGGESTED' | 'NO_SUGGESTION';
  reason: string | null;
  field: string;
  sampledEvents: number;
  matchedEvents: number;
  suggestions: SuggestedExtraction[];
  /** Output names the rule already extracts - offered as existing, never suggested again. */
  alreadyDefined: string[];
  warnings: string[];
}

export interface RuleTestRequest {
  rule: ClassificationRule;
  scope: ClassificationSampleScope;
  sampleSize?: number;
}

export interface ExtractionCoverage {
  name: string;
  label: string | null;
  extracted: number;
  invalid: number;
  of: number;
}

export interface RulePreviewEvent {
  timestamp: string | null;
  service: string | null;
  severity: string | null;
  field: string;
  fieldValue: string | null;
  fieldValueTruncated: boolean;
  conditionsMatched: number;
  conditionsTotal: number;
  extracted: ExtractedFieldValue[];
}

/** Nothing is persisted by `/test`. */
export interface RuleTestResult {
  sampledEvents: number;
  sampleLimitReached: boolean;
  matched: number;
  notMatched: number;
  extractionCoverage: ExtractionCoverage[];
  matchedPreview: RulePreviewEvent[];
  nearMissPreview: RulePreviewEvent[];
  reviewNote: string;
}

export type ImportItemStatus = 'NEW' | 'IDENTICAL' | 'CONFLICT' | 'INVALID';

export interface ImportPreviewItem {
  index: number;
  id: string | null;
  name: string | null;
  tags: string[];
  status: ImportItemStatus;
  existingName: string | null;
  errors: RuleValidationError[];
  /**
   * The pack rule's OWN colour (its deterministic default when it chose none) - never the existing/matched
   * rule's colour, so a reviewer can see what colour importing this rule would actually bring (owner mission
   * §22.11 A12). `null` only when the pack entry could not be parsed into a rule at all (a genuinely malformed
   * JSON entry, distinct from a rule that parsed but failed validation).
   */
  displayColor: TagColor | null;
}

/** `/import/preview` writes nothing. */
export interface ImportPreviewResult {
  pack: { name?: string; description?: string; version?: string | number; exportedAt?: string } | null;
  rulesInPack: number;
  newRules: number;
  identical: number;
  conflicts: number;
  invalid: number;
  items: ImportPreviewItem[];
  currentRevision: number;
  /**
   * Same-tag/different-colour conflicts applying this pack would create
   * (`TagColorPolicy`), reported before anything is written - neither
   * MERGE nor REPLACE_ALL may pick a winner (owner mission "Classification
   * real search scope, assisted extraction, and visual tagging" §22.11
   * A1a). Empty when the pack introduces no colour conflict.
   */
  tagColorConflicts: RuleValidationError[];
}

export type ImportMode = 'MERGE' | 'REPLACE_ALL';
export type ImportConflictResolution = 'KEEP_EXISTING' | 'USE_IMPORTED';

export interface ImportApplyRequest {
  packJson: string;
  mode: ImportMode;
  conflictResolution?: ImportConflictResolution;
  expectedRevision: number;
  confirmReplaceAll?: boolean;
}

export interface ImportApplyResult {
  state: ClassificationRulesState;
  added: number;
  replaced: number;
  unchanged: number;
  keptExisting: number;
  removed: number;
}
