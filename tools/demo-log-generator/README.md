# demo-log-generator (H1)

Deterministic demo Spring Boot JSON log generator, built in Phase A2a of
`IMPLEMENTATION_PLAN.md` as verification-harness component H1. Zero npm
dependencies — runs from a bare `node` install.

Emits canonical log lines across four fake services (`gateway`,
`accounts-api`, `payments-api`, `notification-worker`) to stdout/stderr,
**deterministic given a seed** (same seed + count always reproduces the exact
same corpus).

Fake values only. Nothing here is real customer data.

## One documented command

```bash
# bounded run: emit exactly N lines then exit (used by Compose/tests)
node generate.js --seed 42 --count 200

# continuous run: emit forever at ~250ms/event, real wall-clock timestamps
# (used for `docker compose --profile demo up`)
node generate.js --seed 42

# self-test: proves the corpus contains every required edge case
node generate.js --selftest
# or: npm run selftest
```

## Required edge cases (guaranteed every cycle, not left to chance)

Every 40-record cycle deterministically includes, at a fixed position:

- every canonical top-level field (`@timestamp`, `@version`, `message`,
  `logger_name`, `thread_name`, `level`, `level_value`, `application`, `mdc`,
  `exception`) and every MDC field listed in `HANDOVER.md` §5;
- an event with `mdc["X-Correlation-id"]` only, and a separate event with
  the **literal dotted key** `mdc["event.correlationId"]` only — so
  correlation precedence (Phase B) has both branches to exercise;
- a journey (`x-journey-trace-id`) spanning three services and two distinct
  `traceId`s;
- sensitive fields (`cif`, `UserName`, `CustomerId`, `deviceId`, `deviceIp`)
  with obviously fake values (`FAKE-`/`DEMO-` prefixed);
- a multiline exception with escaped newlines, kept as one JSON event;
- an empty `message` value;
- a malformed / non-JSON line;
- an unknown MDC field not in the canonical list;
- a stderr line;
- a burst of 6 consecutive events (message-prefixed `[burst]`) with no
  inter-event delay.

`node generate.js --selftest` builds an 80-record corpus (two full cycles)
and asserts every one of the above is present, plus that the same seed+count
reproduces byte-identical output and a different seed changes the filler
content while still satisfying every required edge case.

## Docker

```bash
docker build -t demo-log-generator .
docker run --rm demo-log-generator --seed 42          # continuous
docker run --rm demo-log-generator --seed 42 --count 50  # bounded
```
