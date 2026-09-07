'use strict';

/*
 * H2 (Phase A2a) — mock Loki server.
 *
 * A small standalone HTTP stub (zero npm dependencies) serving `query_range`
 * fixtures plus 401/403/429/timeout/5xx scenarios, with the OpenShift
 * LokiStack gateway path shape — {base}{gatewayPrefix}/{tenant}/loki/api/v1/query_range
 * — and its label keys fully configurable, per IMPLEMENTATION_PLAN.md §4
 * ("nothing dangerously hardcoded").
 *
 * Standalone on purpose: the real backend (Phase B onward) does not exist
 * yet, and this must not depend on it.
 */

const http = require('http');
const { URL } = require('url');

const DEFAULT_CONFIG = {
  gatewayPrefix: '/api/logs/v1',
  tenant: 'application',
  namespaceLabel: 'kubernetes_namespace_name',
  serviceLabel: 'app',
};

const FIXTURE_NAMESPACE = 'log-explorer-demo';
const FIXTURE_SERVICES = ['gateway', 'accounts-api', 'payments-api', 'notification-worker'];

function nanos(millis) {
  return (BigInt(millis) * 1000000n).toString();
}

/** Deterministic fixture streams, independent of demo-log-generator (H1) but
 * in the same canonical-JSON-per-line shape a real Loki entry would carry. */
function buildFixtureStreams(config, baseMillis) {
  const streams = [];
  FIXTURE_SERVICES.forEach((service, si) => {
    const labels = {
      [config.namespaceLabel]: FIXTURE_NAMESPACE,
      [config.serviceLabel]: service,
    };
    const values = [];
    for (let i = 0; i < 5; i++) {
      const tMillis = baseMillis + si * 1000 + i * 200;
      const line = JSON.stringify({
        '@timestamp': new Date(tMillis).toISOString(),
        '@version': '1',
        message: `mock-loki fixture line ${i} for ${service}`,
        logger_name: `com.demo.${service}.App`,
        thread_name: 'reactor-http-nio-1',
        level: i === 4 ? 'ERROR' : 'INFO',
        level_value: i === 4 ? 40000 : 20000,
        application: service,
        mdc: {
          traceId: `mock-trace-${si}-${i}`,
          spanId: `mock-span-${si}-${i}`,
        },
      });
      values.push([nanos(tMillis), line]);
    }
    streams.push({ stream: labels, values });
  });
  return streams;
}

function jsonResponse(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }, extraHeaders || {}));
  res.end(payload);
}

const ERROR_SCENARIOS = {
  401: (res) => jsonResponse(res, 401, { status: 'error', error: 'authentication required (mock)' }),
  403: (res) => jsonResponse(res, 403, { status: 'error', error: 'forbidden (mock)' }),
  429: (res) => jsonResponse(res, 429, { status: 'error', error: 'rate limited (mock)' }, { 'Retry-After': '1' }),
  '5xx': (res) => jsonResponse(res, 503, { status: 'error', error: 'upstream unavailable (mock)' }),
  // "timeout" is not a status code — it means: never respond within the
  // configured delay, so a real client's own timeout policy is what fires.
};

function applyDirectionAndLimit(streams, direction, limit) {
  return streams.map((s) => {
    let values = s.values.slice();
    if (direction === 'backward') values = values.reverse();
    if (Number.isFinite(limit) && limit > 0) values = values.slice(0, limit);
    return { stream: s.stream, values };
  });
}

function filterByRange(streams, startNanos, endNanos) {
  if (startNanos === undefined && endNanos === undefined) return streams;
  return streams.map((s) => ({
    stream: s.stream,
    values: s.values.filter(([tsStr]) => {
      const ts = BigInt(tsStr);
      if (startNanos !== undefined && ts < startNanos) return false;
      if (endNanos !== undefined && ts >= endNanos) return false;
      return true;
    }),
  })).filter((s) => s.values.length > 0 || streams.length === 0);
}

function createServer(userConfig) {
  const config = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
  const expectedPath = `${config.gatewayPrefix}/${config.tenant}/loki/api/v1/query_range`;
  const baseMillis = config.baseMillis || Date.UTC(2026, 0, 1, 0, 0, 0);

  const server = http.createServer((req, res) => {
    const scenario = req.headers['x-mock-scenario'];
    const delayMs = Number(req.headers['x-mock-delay-ms'] || 0);

    const handle = () => {
      let parsedUrl;
      try {
        parsedUrl = new URL(req.url, 'http://localhost');
      } catch (_e) {
        jsonResponse(res, 400, { status: 'error', error: 'bad request (mock)' });
        return;
      }

      if (req.method !== 'GET' || parsedUrl.pathname !== expectedPath) {
        jsonResponse(res, 404, {
          status: 'error',
          error: `mock-loki: no route for ${req.method} ${parsedUrl.pathname} (expected GET ${expectedPath})`,
        });
        return;
      }

      if (scenario && ERROR_SCENARIOS[scenario]) {
        ERROR_SCENARIOS[scenario](res);
        return;
      }
      if (scenario === 'timeout') {
        // Never respond. The caller is expected to enforce its own timeout.
        return;
      }

      const q = parsedUrl.searchParams;
      const direction = q.get('direction') || 'backward';
      const limit = q.has('limit') ? Number(q.get('limit')) : undefined;
      const start = q.has('start') ? BigInt(q.get('start')) : undefined;
      const end = q.has('end') ? BigInt(q.get('end')) : undefined;

      let streams = buildFixtureStreams(config, baseMillis);
      streams = filterByRange(streams, start, end);
      streams = applyDirectionAndLimit(streams, direction, limit);

      jsonResponse(res, 200, {
        status: 'success',
        data: {
          resultType: 'streams',
          result: streams,
          stats: { summary: { totalEntriesReturned: streams.reduce((n, s) => n + s.values.length, 0) } },
        },
      });
    };

    if (delayMs > 0) setTimeout(handle, delayMs);
    else handle();
  });

  server.mockConfig = config;
  server.expectedPath = expectedPath;
  return server;
}

function main() {
  const config = {
    gatewayPrefix: process.env.GATEWAY_PREFIX || DEFAULT_CONFIG.gatewayPrefix,
    tenant: process.env.TENANT || DEFAULT_CONFIG.tenant,
    namespaceLabel: process.env.NAMESPACE_LABEL || DEFAULT_CONFIG.namespaceLabel,
    serviceLabel: process.env.SERVICE_LABEL || DEFAULT_CONFIG.serviceLabel,
  };
  const port = Number(process.env.PORT || 3100);
  const server = createServer(config);
  server.listen(port, () => {
    console.log(`mock-loki listening on :${port}, route: GET ${server.expectedPath}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { createServer, DEFAULT_CONFIG };
