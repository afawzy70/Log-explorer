import type {
  ProblemDetail,
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealth,
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

export async function fetchSourceHealth(sourceId: string, signal?: AbortSignal): Promise<SourceHealth> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/health`, { signal });
  return parseJsonOrThrow<SourceHealth>(response);
}

export async function fetchSourceServices(sourceId: string, signal?: AbortSignal): Promise<ServiceInfo[]> {
  const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/services`, { signal });
  return parseJsonOrThrow<ServiceInfo[]>(response);
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
