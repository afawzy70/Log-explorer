# mock-loki (H2)

Standalone mock OpenShift Loki gateway server, built in Phase A2a as
verification-harness component H2. Zero npm dependencies — runs from a bare
`node` install. Does not depend on the real backend (which does not exist
until Phase B) — it is a pure HTTP stub.

Serves the LokiStack gateway route shape used throughout
`IMPLEMENTATION_PLAN.md`:

```
GET {gatewayPrefix}/{tenant}/loki/api/v1/query_range?query=...&start=...&end=...&limit=...&direction=...
```

`gatewayPrefix`, `tenant`, and the two label keys used in returned stream
labels (`namespaceLabel`, `serviceLabel`) are all configurable — nothing is
hardcoded, matching the plan's requirement for the real Loki adapter.

## One documented command

```bash
# start the server (defaults: prefix=/api/logs/v1, tenant=application)
node server.js
# or: npm start

# configure everything via env vars
GATEWAY_PREFIX=/gw/logging TENANT=tenant-b NAMESPACE_LABEL=ns SERVICE_LABEL=svc PORT=3100 node server.js

# contract test — starts real servers on ephemeral ports, issues real
# HTTP requests, proves the route/config/error-scenario behavior actually
# works (not just that the source looks right)
node contract-test.js
# or: npm run contract-test
```

## Error scenarios

Send a `X-Mock-Scenario` request header to get a specific response instead
of the success fixture:

| Header value | Behavior |
|---|---|
| `401` | HTTP 401, `{status:"error", ...}` |
| `403` | HTTP 403 |
| `429` | HTTP 429, with a `Retry-After` header |
| `5xx` | HTTP 503 |
| `timeout` | Never responds — exercises the caller's own timeout policy |

An `X-Mock-Delay-Ms` header delays any response (including the success
fixture) by that many milliseconds, for testing slow-upstream handling
without the full `timeout` scenario.

## Success response semantics

- `direction=forward` returns ascending timestamps; `direction=backward`
  (the default, matching real Loki) returns descending.
- `limit=N` caps each stream to at most N values.
- `start`/`end` are **nanosecond** Unix timestamps (as strings), matching
  real Loki's `query_range` semantics, and filter the fixture data.

## Docker

```bash
docker build -t mock-loki .
docker run --rm -p 3100:3100 mock-loki
docker run --rm -p 3100:3100 -e GATEWAY_PREFIX=/gw -e TENANT=t2 mock-loki
```
