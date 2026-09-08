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

export interface SearchResponse {
  events: LogEvent[];
  counts: ResultCounts;
  nextCursor: string | null;
}

export type SearchDirection = 'FORWARD' | 'BACKWARD';

/**
 * Never persisted (localStorage or URL) as a whole - CLAUDE.md §2 rule 4.
 * `query`/`rawLogQl` (Phase E) are intentionally omitted: no UI control in
 * this phase's scope produces them.
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
