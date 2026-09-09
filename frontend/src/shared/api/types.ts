/** Mirrors backend/src/main/java/com/logexplorer/api/dto/**, field for field. */

export interface SourceCapabilities {
  historicalSearch: boolean;
  liveTail: boolean;
  rawLogQL: boolean;
  serviceDiscovery: boolean;
  queryStatistics: boolean;
  contextView: boolean;
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
export interface DockerConnectionSummary {
  mode: 'LOCAL' | 'REMOTE';
  host: string | null;
  port: number | null;
  tlsEnabled: boolean;
  composeProjectFilter: string | null;
  runtimeMutationSupported: boolean;
  settingsNote: string;
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
}

/** The exact four non-sensitive identifiers "Find this X" (IMPLEMENTATION_PLAN.md "Phase I") can search by - never a sensitive field, structurally. */
export type JourneyField = 'journeyId' | 'correlationId' | 'traceId' | 'eventId';

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
}
