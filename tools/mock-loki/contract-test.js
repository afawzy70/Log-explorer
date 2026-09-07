'use strict';

/*
 * H2 (Phase A2a) — mock-loki contract test.
 *
 * Proves the mock server's route, error scenarios, and configurability
 * actually work, by starting real HTTP servers on ephemeral ports and
 * issuing real requests — not by inspecting source code.
 */

const http = require('http');
const { createServer } = require('./server.js');

const failures = [];

function assertTrue(cond, label) {
  if (!cond) failures.push(label);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: headers || {},
      timeout: 800,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_e) { /* leave null */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: body });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('client timeout')); });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function main() {
  // --- Config A: defaults ---------------------------------------------
  const serverA = createServer({ gatewayPrefix: '/api/logs/v1', tenant: 'application' });
  const portA = await listen(serverA);

  const startA = String(BigInt(Date.UTC(2026, 0, 1, 0, 0, 0)) * 1000000n);
  const endA = String(BigInt(Date.UTC(2026, 0, 1, 0, 0, 10)) * 1000000n);

  const okA = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?query=%7Bapp%3D~%22.%2B%22%7D&start=${startA}&end=${endA}&limit=100&direction=forward`);
  assertTrue(okA.status === 200, 'success response is HTTP 200');
  assertTrue(okA.body && okA.body.status === 'success', 'success response has status:"success"');
  assertTrue(okA.body && okA.body.data && okA.body.data.resultType === 'streams', 'response data.resultType is "streams"');
  assertTrue(Array.isArray(okA.body.data.result) && okA.body.data.result.length > 0, 'response has at least one stream');
  const firstStream = okA.body.data.result[0];
  assertTrue(firstStream.stream && Object.prototype.hasOwnProperty.call(firstStream.stream, 'kubernetes_namespace_name'), 'default namespace label key used in stream labels');
  assertTrue(firstStream.stream && Object.prototype.hasOwnProperty.call(firstStream.stream, 'app'), 'default service label key ("app") used in stream labels');

  // Wrong path (different tenant) must 404, proving the route is not wide open.
  const wrongTenant = await request(portA, '/api/logs/v1/other-tenant/loki/api/v1/query_range');
  assertTrue(wrongTenant.status === 404, 'unconfigured tenant path returns 404');

  // limit enforcement
  const limited = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?limit=1&direction=forward`);
  const limitedCounts = limited.body.data.result.map((s) => s.values.length);
  assertTrue(limitedCounts.every((n) => n <= 1), 'limit=1 caps every stream to at most 1 value');

  // direction ordering: forward ascending, backward descending
  const fwd = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?direction=forward`);
  const bwd = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?direction=backward`);
  const fwdFirst = fwd.body.data.result[0].values;
  const bwdFirst = bwd.body.data.result[0].values;
  const fwdAscending = fwdFirst.every((v, i) => i === 0 || BigInt(v[0]) >= BigInt(fwdFirst[i - 1][0]));
  const bwdDescending = bwdFirst.every((v, i) => i === 0 || BigInt(v[0]) <= BigInt(bwdFirst[i - 1][0]));
  assertTrue(fwdAscending, 'direction=forward returns ascending timestamps');
  assertTrue(bwdDescending, 'direction=backward returns descending timestamps');
  assertTrue(JSON.stringify(fwdFirst) !== JSON.stringify(bwdFirst), 'forward and backward actually differ (not the same fixed order both times)');

  // start/end (nanosecond) filtering — request a range narrower than the
  // full fixture and confirm fewer entries come back.
  const fullRange = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?direction=forward`);
  const narrowStart = String(BigInt(Date.UTC(2026, 0, 1, 0, 0, 0)) * 1000000n);
  const narrowEnd = String(BigInt(Date.UTC(2026, 0, 1, 0, 0, 1)) * 1000000n);
  const narrowRange = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range?start=${narrowStart}&end=${narrowEnd}&direction=forward`);
  const fullCount = fullRange.body.data.result.reduce((n, s) => n + s.values.length, 0);
  const narrowCount = narrowRange.body.data.result.reduce((n, s) => n + s.values.length, 0);
  assertTrue(narrowCount < fullCount, 'narrower start/end (nanoseconds) returns fewer entries than the full range');
  assertTrue(narrowCount > 0, 'narrow range still returns some entries (sanity: filter is not just returning empty)');

  // error scenarios
  for (const [scenario, expectedStatus] of [['401', 401], ['403', 403], ['429', 429], ['5xx', 503]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await request(portA, `/api/logs/v1/application/loki/api/v1/query_range`, { 'X-Mock-Scenario': scenario });
    assertTrue(r.status === expectedStatus, `X-Mock-Scenario:${scenario} returns HTTP ${expectedStatus}`);
    assertTrue(r.body && r.body.status === 'error', `X-Mock-Scenario:${scenario} response body has status:"error"`);
    if (scenario === '429') {
      assertTrue(r.headers['retry-after'] === '1', 'X-Mock-Scenario:429 response includes a Retry-After header');
    }
  }

  // timeout scenario: client-side timeout must actually fire, proving the
  // mock genuinely never responds rather than responding fast by mistake.
  let timedOut = false;
  try {
    await request(portA, `/api/logs/v1/application/loki/api/v1/query_range`, { 'X-Mock-Scenario': 'timeout' });
  } catch (err) {
    timedOut = /timeout/i.test(err.message);
  }
  assertTrue(timedOut, 'X-Mock-Scenario:timeout causes the client to time out waiting for a response');

  await close(serverA);

  // --- Config B: different prefix/tenant/label keys, proving nothing is
  // hardcoded -------------------------------------------------------------
  const serverB = createServer({
    gatewayPrefix: '/gw/logging',
    tenant: 'tenant-b',
    namespaceLabel: 'ns',
    serviceLabel: 'svc',
  });
  const portB = await listen(serverB);

  const okB = await request(portB, '/gw/logging/tenant-b/loki/api/v1/query_range?direction=forward');
  assertTrue(okB.status === 200, 'config B: differently-shaped route returns 200');
  const streamB = okB.body.data.result[0].stream;
  assertTrue(Object.prototype.hasOwnProperty.call(streamB, 'ns'), 'config B: custom namespace label key ("ns") used in stream labels');
  assertTrue(Object.prototype.hasOwnProperty.call(streamB, 'svc'), 'config B: custom service label key ("svc") used in stream labels');
  assertTrue(!Object.prototype.hasOwnProperty.call(streamB, 'kubernetes_namespace_name'), 'config B: default label key is NOT present (proves it is not hardcoded)');

  // Config A's path must not resolve against config B's server.
  const crossCheck = await request(portB, '/api/logs/v1/application/loki/api/v1/query_range');
  assertTrue(crossCheck.status === 404, "config A's path 404s against config B's server (prefix/tenant genuinely configurable, not both accepted)");

  await close(serverB);

  if (failures.length === 0) {
    console.log('MOCK-LOKI CONTRACT TEST PASS — all checks green');
    process.exit(0);
  } else {
    console.log('MOCK-LOKI CONTRACT TEST FAIL:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('MOCK-LOKI CONTRACT TEST ERROR:', err);
  process.exit(1);
});
