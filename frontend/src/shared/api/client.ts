import type {
  ContextRequestBody,
  DockerConnectionCandidate,
  DockerConnectionSummary,
  EnvironmentInfo,
  JourneyRequestBody,
  ProblemDetail,
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealth,
  SourceHealthDetail,
  SourceInfo,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail;

  constructor(status: number, problem: ProblemDetail) {
    super(problem.detail ?? problem.title ?? `Request failed with status ${status}`);
    this.status = status;
    this.problem = problem;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let problem: ProblemDetail = { status: response.status };
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Body wasn't JSON (or empty) - fall back to the bare status.
    }
    throw new ApiError(response.status, problem);
  }
  return response.json() as Promise<T>;
}

export async function fetchSources(signal?: AbortSignal): Promise<SourceInfo[]> {
  const response = await fetch('/api/v1/sources', { signal });
  return parseJsonOrThrow<SourceInfo[]>(response);
}

export async function fetchSourceHealth(sourceId: string, signal?: AbortSignal): Promise<SourceHealthDetail> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/health`, { signal });
  return parseJsonOrThrow<SourceHealthDetail>(response);
}

/** UX-R3 §7/§8 — `composeProject`, when supplied, scopes discovery to that one project's own hard boundary (never a frontend-only filter). */
export async function fetchSourceServices(
  sourceId: string,
  composeProject?: string,
  signal?: AbortSignal,
): Promise<ServiceInfo[]> {
  const query = composeProject ? `?composeProject=${encodeURIComponent(composeProject)}` : '';
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/services${query}`, { signal });
  return parseJsonOrThrow<ServiceInfo[]>(response);
}

/**
 * UX-R3 §7 — real, currently-visible Docker Compose projects on this
 * source's own connection (canonical `com.docker.compose.project` label,
 * never a container-name guess, never fabricated). Empty for a source
 * with no real Compose-project concept - callers gate on {@link
 * SourceCapabilities.composeProjectScoping}, never this list's emptiness
 * alone, to tell "unsupported" apart from "supported, currently empty."
 */
export async function fetchComposeProjects(sourceId: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/compose-projects`, { signal });
  return parseJsonOrThrow<string[]>(response);
}

/** UI Gap Closure Pass - the real, running instance's active Spring profile(s), never a guess (`EnvironmentInfoContributor`). */
export async function fetchEnvironmentInfo(signal?: AbortSignal): Promise<EnvironmentInfo> {
  const response = await fetch('/actuator/info', { signal });
  return parseJsonOrThrow<EnvironmentInfo>(response);
}

/**
 * Search values never appear in the URL (CLAUDE.md §2 rule 4) - this is
 * the only place the frontend ever sends them, as a POST body, never as
 * query-string parameters.
 */
export async function runSearch(body: SearchRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * "Show ±30 seconds" (IMPLEMENTATION_PLAN.md "Phase H") - a distinct
 * endpoint from `runSearch` because the window itself is never
 * client-supplied (see `ContextRequestBody`'s own comment); the backend
 * computes it from `timestamp` alone.
 */
export async function fetchContext(body: ContextRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * "Find this trace/correlation/journey/event" (IMPLEMENTATION_PLAN.md
 * "Phase I") - a distinct endpoint from `runSearch` because the backend
 * enforces ascending order here (no `LogSource` implementation this
 * project has honors `direction` consistently - see `SearchController#journey`'s
 * own comment), which the general search endpoint does not guarantee.
 */
export async function fetchJourney(body: JourneyRequestBody, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/v1/logs/journey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseJsonOrThrow<SearchResponse>(response);
}

/**
 * Docker connection settings (Legacy Remediation Slice 3) - the current
 * effective configuration, sanitized, read-only.
 */
export async function fetchDockerConnectionSummary(signal?: AbortSignal): Promise<DockerConnectionSummary> {
  const response = await fetch('/api/v1/sources/docker/connection', { signal });
  return parseJsonOrThrow<DockerConnectionSummary>(response);
}

/**
 * Test Connection (Legacy Remediation Slice 3) - `candidate` is ephemeral,
 * sent as a POST body only, never persisted anywhere by this client and
 * never applied to the running application's actual Docker connection.
 */
export async function testDockerConnection(candidate: DockerConnectionCandidate, signal?: AbortSignal): Promise<SourceHealth> {
  const response = await fetch('/api/v1/sources/docker/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
    signal,
  });
  return parseJsonOrThrow<SourceHealth>(response);
}
