#!/usr/bin/env node
'use strict';

/*
 * H1 (Phase A2a) — demo log generator.
 *
 * Emits canonical Spring Boot JSON log lines to stdout/stderr across several
 * fake services, deterministic given a seed. See README.md for the required
 * edge-case list this is built to guarantee, and the self-test that proves it.
 *
 * Zero npm dependencies on purpose — must run from a bare `node` install.
 *
 * Usage:
 *   node generate.js --seed 42 --count 200        # emit 200 lines then exit
 *   node generate.js --seed 42                     # run continuously (live mode)
 *   node generate.js --selftest                    # run the corpus self-test
 */

const SERVICES = ['gateway', 'accounts-api', 'payments-api', 'notification-worker'];
const LEVELS = ['INFO', 'INFO', 'INFO', 'WARN', 'ERROR', 'DEBUG'];
const LEVEL_VALUES = { TRACE: 5000, DEBUG: 10000, INFO: 20000, WARN: 30000, ERROR: 40000 };

// One repeating "cycle" of scripted scenario slots guarantees every required
// edge case appears at least once, deterministically, regardless of seed —
// not left to chance. Filler slots use the seeded RNG for realistic variety.
const CYCLE_LEN = 40;
const BURST_SIZE = 6;

// --- seeded PRNG (mulberry32) -------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

// --- fake value helpers (obviously fake, never real) --------------------------

function fakeCif(rng, i) {
  return `FAKE-CIF-${pad(1000 + (i % 900), 4)}`;
}
function fakeUserName(rng, i) {
  return `demo.user${i % 37}`;
}
function fakeCustomerId(rng, i) {
  return `DEMO-CUST-${pad(200000 + (i % 5000), 6)}`;
}
function fakeDeviceId(rng, i) {
  return `DEMO-DEVICE-${pad(i % 999, 3)}`;
}
function fakeDeviceIp(rng, i) {
  return `10.${i % 200}.${(i * 7) % 200}.${(i * 13) % 255}`;
}
function fakeServerIp(rng, i) {
  return `172.20.${i % 10}.${(i * 3) % 255}`;
}

// --- id helpers ----------------------------------------------------------------

function traceId(i) {
  return `demo-trace-${pad(i, 6)}`;
}
function spanId(i) {
  return `demo-span-${pad(i, 6)}`;
}
function journeyId(i) {
  return `demo-journey-${pad(i, 4)}`;
}
function eventId(i) {
  return `demo-event-${pad(i, 6)}`;
}
function correlationId(i) {
  return `demo-corr-${pad(i, 6)}`;
}

// --- event construction ----------------------------------------------------

function baseTimestamp(startMillis, offsetMillis) {
  const d = new Date(startMillis + offsetMillis);
  return d.toISOString().replace('Z', '+00:00');
}

function loggerFor(service) {
  const classes = {
    gateway: 'com.demo.gateway.RoutingFilter',
    'accounts-api': 'com.demo.accounts.AccountController',
    'payments-api': 'com.demo.payments.PaymentService',
    'notification-worker': 'com.demo.notify.NotificationListener',
  };
  return classes[service] || `com.demo.${service}.App`;
}

function threadFor(rng, service) {
  const n = Math.floor(rng() * 20);
  return service === 'notification-worker' ? `jms-listener-${n}` : `reactor-http-nio-${n}`;
}

function fullMdc(rng, i, opts) {
  opts = opts || {};
  const mdc = {
    traceId: opts.traceId || traceId(i),
    spanId: opts.spanId || spanId(i),
    eventId: eventId(i),
    'x-journey-trace-id': opts.journeyId || journeyId(Math.floor(i / 7)),
    stepName: pick(rng, ['validate-request', 'debit-account', 'credit-account', 'notify-customer', 'route-request']),
    UIIdentifier: pick(rng, ['screen.transfer.confirm', 'screen.login', 'screen.dashboard', 'screen.support.ticket']),
    ERROR_CODE: pick(rng, ['ERR_NONE', 'ERR_TIMEOUT', 'ERR_VALIDATION', 'ERR_UPSTREAM_5XX']),
    devicePlatformType: pick(rng, ['ANDROID', 'IOS', 'WEB']),
    language: pick(rng, ['en', 'ar']),
    serverIp: fakeServerIp(rng, i),
    serverHost: `demo-host-${(i % 6) + 1}`,
    cif: fakeCif(rng, i),
    UserName: fakeUserName(rng, i),
    CustomerId: fakeCustomerId(rng, i),
    deviceId: fakeDeviceId(rng, i),
    deviceIp: fakeDeviceIp(rng, i),
  };
  if (opts.correlationVariant === 'header') {
    mdc['X-Correlation-id'] = opts.correlationId || correlationId(i);
  } else if (opts.correlationVariant === 'literal') {
    mdc['event.correlationId'] = opts.correlationId || correlationId(i);
  } else if (opts.correlationVariant === 'both') {
    mdc['X-Correlation-id'] = opts.correlationId || correlationId(i);
    mdc['event.correlationId'] = opts.correlationId || correlationId(i);
  }
  if (opts.unknownField) {
    mdc.unknownDemoField = 'this-key-is-not-in-the-canonical-mdc-list';
  }
  return mdc;
}

function normalEvent(rng, i, startMillis, service, opts) {
  opts = opts || {};
  const level = opts.level || pick(rng, LEVELS);
  const evt = {
    '@timestamp': baseTimestamp(startMillis, i * 137),
    '@version': '1',
    message: opts.message !== undefined ? opts.message : `${opts.messagePrefix || ''}${describeStep(rng, service)}`,
    logger_name: loggerFor(service),
    thread_name: threadFor(rng, service),
    level,
    level_value: LEVEL_VALUES[level],
    application: service,
    mdc: fullMdc(rng, i, opts.mdcOpts || {}),
  };
  if (opts.exception) {
    evt.exception = opts.exception;
  }
  return evt;
}

function describeStep(rng, service) {
  const verbs = {
    gateway: ['Routed request to downstream service', 'Applied rate limit check', 'Forwarded response to client'],
    'accounts-api': ['Loaded account summary', 'Validated account status', 'Persisted account update'],
    'payments-api': ['Processed payment authorization', 'Reversed pending transaction', 'Settled batch payment'],
    'notification-worker': ['Dispatched customer notification', 'Retried failed notification delivery', 'Consumed JMS event'],
  };
  return pick(rng, verbs[service] || ['Handled request']);
}

function multilineException(rng, service) {
  const lines = [
    `java.lang.IllegalStateException: demo upstream failure in ${service}`,
    `\tat com.demo.${service}.Handler.handle(Handler.java:${42 + (Math.floor(rng() * 50))})`,
    `\tat com.demo.${service}.Handler.lambda$process$0(Handler.java:17)`,
    'Caused by: java.util.concurrent.TimeoutException: demo timeout after 5000ms',
    `\tat com.demo.${service}.UpstreamClient.call(UpstreamClient.java:88)`,
    '\t... 12 more',
  ];
  return lines.join('\n');
}

/**
 * Builds one cycle (CYCLE_LEN records) of {stream, text} entries.
 * cycleIndex selects which absolute cycle this is, so ids/timestamps keep
 * advancing across repeated cycles in continuous mode.
 */
function buildCycle(rng, cycleIndex, startMillis) {
  const records = [];
  const base = cycleIndex * CYCLE_LEN;

  const push = (stream, text) => records.push({ stream, text });
  const pushEvent = (stream, evt) => push(stream, JSON.stringify(evt));

  // Slot 0: normal event, correlation via X-Correlation-id header variant.
  pushEvent('stdout', normalEvent(rng, base + 0, startMillis, SERVICES[0], {
    mdcOpts: { correlationVariant: 'header' },
  }));

  // Slot 1: normal event, correlation via the literal dotted key
  // mdc["event.correlationId"] — a literal key containing a period, not a
  // nested path. Exercises the other branch of correlation precedence.
  pushEvent('stdout', normalEvent(rng, base + 1, startMillis, SERVICES[1], {
    mdcOpts: { correlationVariant: 'literal' },
  }));

  // Slots 2-4: one journey spanning three services and two distinct traceIds,
  // sharing a single x-journey-trace-id.
  const journey = journeyId(1000 + cycleIndex);
  const tA = traceId(base + 100);
  const tB = traceId(base + 101);
  pushEvent('stdout', normalEvent(rng, base + 2, startMillis, 'gateway', {
    mdcOpts: { journeyId: journey, traceId: tA, correlationVariant: 'header' },
    message: 'Journey step 1: gateway accepted transfer request',
  }));
  pushEvent('stdout', normalEvent(rng, base + 3, startMillis, 'accounts-api', {
    mdcOpts: { journeyId: journey, traceId: tA, correlationVariant: 'header' },
    message: 'Journey step 2: accounts-api validated balance',
  }));
  pushEvent('stdout', normalEvent(rng, base + 4, startMillis, 'payments-api', {
    mdcOpts: { journeyId: journey, traceId: tB, correlationVariant: 'literal' },
    message: 'Journey step 3: payments-api settled transfer under a new trace',
  }));

  // Slot 5: sensitive-fields event — values are obviously fake, present so
  // masking (Phase B) has something real to mask against in later phases.
  pushEvent('stdout', normalEvent(rng, base + 5, startMillis, 'accounts-api', {
    mdcOpts: { correlationVariant: 'header' },
    message: 'Customer profile lookup completed',
  }));

  // Slot 6: multiline exception with escaped newlines — one logical event.
  pushEvent('stderr', normalEvent(rng, base + 6, startMillis, 'payments-api', {
    level: 'ERROR',
    mdcOpts: { correlationVariant: 'header' },
    message: 'Payment authorization failed',
    exception: multilineException(rng, 'payments-api'),
  }));

  // Slot 7: empty message — preserved, never fabricated.
  pushEvent('stdout', normalEvent(rng, base + 7, startMillis, 'gateway', {
    message: '',
    mdcOpts: { correlationVariant: 'header' },
  }));

  // Slot 8: malformed / non-JSON line — must never be silently dropped by a
  // downstream parser; becomes a raw fallback event.
  push('stdout', `NOT-JSON demo-malformed-line service=${SERVICES[base % SERVICES.length]} ts=${new Date(startMillis + base).toISOString()}`);

  // Slot 9: unknown MDC field not in the canonical list.
  pushEvent('stdout', normalEvent(rng, base + 9, startMillis, 'notification-worker', {
    mdcOpts: { correlationVariant: 'header', unknownField: true },
    message: 'Notification worker processed unrecognized event shape',
  }));

  // Slot 10: stderr stream (well-formed event, just on the other fd).
  pushEvent('stderr', normalEvent(rng, base + 10, startMillis, 'gateway', {
    level: 'WARN',
    mdcOpts: { correlationVariant: 'header' },
    message: 'Upstream response slower than expected',
  }));

  // Slots 11..(11+BURST_SIZE-1): a burst — several events with identical or
  // near-identical timestamps and no inter-event delay, for backpressure /
  // truncation testing.
  for (let b = 0; b < BURST_SIZE; b++) {
    const idx = base + 11 + b;
    pushEvent('stdout', normalEvent(rng, idx, startMillis, pick(rng, SERVICES), {
      messagePrefix: '[burst] ',
      mdcOpts: { correlationVariant: 'header' },
    }));
  }

  // Remaining slots: filler normal events for realistic variety/volume.
  let idx = base + 11 + BURST_SIZE;
  while (records.length < CYCLE_LEN) {
    const service = pick(rng, SERVICES);
    pushEvent('stdout', normalEvent(rng, idx, startMillis, service, {
      mdcOpts: { correlationVariant: pick(rng, ['header', 'literal']) },
    }));
    idx++;
  }

  return records.slice(0, CYCLE_LEN);
}

/**
 * Pure function: builds `count` records deterministically from `seed`.
 * Shared by CLI bounded mode and the self-test so there is exactly one code
 * path producing the corpus.
 */
function generateCorpus(seed, count) {
  const rng = mulberry32(seed);
  const startMillis = Date.UTC(2026, 0, 1, 0, 0, 0);
  const out = [];
  let cycleIndex = 0;
  while (out.length < count) {
    const cycle = buildCycle(rng, cycleIndex, startMillis);
    for (const rec of cycle) {
      out.push(rec);
      if (out.length >= count) break;
    }
    cycleIndex++;
  }
  return out;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = { seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--selftest') args.selftest = true;
    else if (a === '--interval') args.interval = Number(argv[++i]);
  }
  return args;
}

// Piping into `head`/`wc -l` etc. closes the read end early; without this,
// the next process.stdout.write throws an unhandled EPIPE and crashes with
// a stack trace instead of exiting quietly like any well-behaved CLI tool.
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });

function emitRecord(rec) {
  if (rec.stream === 'stderr') process.stderr.write(rec.text + '\n');
  else process.stdout.write(rec.text + '\n');
}

async function runBounded(seed, count) {
  const corpus = generateCorpus(seed, count);
  for (const rec of corpus) emitRecord(rec);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runContinuous(seed, intervalMs) {
  const rng = mulberry32(seed);
  const startMillis = Date.now();
  let cycleIndex = 0;
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cycle = buildCycle(rng, cycleIndex, startMillis);
    for (const rec of cycle) {
      // Re-stamp with real wall-clock time for a genuinely live feed, but
      // keep the deterministic scenario script/values from buildCycle.
      let text = rec.text;
      try {
        const parsed = JSON.parse(text);
        parsed['@timestamp'] = new Date().toISOString().replace('Z', '+00:00');
        text = JSON.stringify(parsed);
      } catch (_e) {
        // malformed line stays malformed on purpose
      }
      emitRecord({ stream: rec.stream, text });
      const isBurst = text.includes('[burst]');
      // eslint-disable-next-line no-await-in-loop
      await sleep(isBurst ? 10 : intervalMs || 250);
    }
    cycleIndex++;
  }
}

// --- self-test ---------------------------------------------------------------

function assertTrue(cond, label, failures) {
  if (!cond) failures.push(label);
}

function selfTest() {
  const failures = [];
  const SEED = 42;
  const COUNT = 80; // >= 2 full cycles, well past every scripted slot

  const corpus = generateCorpus(SEED, COUNT);

  const jsonRecords = [];
  let malformedCount = 0;
  for (const rec of corpus) {
    try {
      jsonRecords.push({ stream: rec.stream, evt: JSON.parse(rec.text) });
    } catch (_e) {
      malformedCount++;
    }
  }

  assertTrue(malformedCount >= 1, 'at least one malformed/non-JSON line', failures);

  const topKeys = new Set();
  const mdcKeys = new Set();
  let sawException = false;
  let sawEmptyMessage = false;
  let sawStderr = false;
  let sawHeaderOnlyCorrelation = false;
  let sawLiteralOnlyCorrelation = false;
  let sawUnknownMdcField = false;
  let sawBurst = false;
  let sawFakeSensitiveValues = true;
  const journeyToTraceIds = new Map();
  const journeyToServices = new Map();

  for (const { stream, evt } of jsonRecords) {
    Object.keys(evt).forEach((k) => topKeys.add(k));
    if (stream === 'stderr') sawStderr = true;
    if (evt.exception && evt.exception.includes('\n')) sawException = true;
    if (evt.message === '') sawEmptyMessage = true;
    if (evt.message && evt.message.includes('[burst]')) sawBurst = true;

    const mdc = evt.mdc || {};
    Object.keys(mdc).forEach((k) => mdcKeys.add(k));
    if (mdc.unknownDemoField) sawUnknownMdcField = true;

    const hasHeader = Object.prototype.hasOwnProperty.call(mdc, 'X-Correlation-id');
    const hasLiteral = Object.prototype.hasOwnProperty.call(mdc, 'event.correlationId');
    if (hasHeader && !hasLiteral) sawHeaderOnlyCorrelation = true;
    if (hasLiteral && !hasHeader) sawLiteralOnlyCorrelation = true;

    if (mdc.cif && !String(mdc.cif).startsWith('FAKE-')) sawFakeSensitiveValues = false;
    if (mdc.CustomerId && !String(mdc.CustomerId).startsWith('DEMO-')) sawFakeSensitiveValues = false;
    if (mdc.UserName && !String(mdc.UserName).startsWith('demo.')) sawFakeSensitiveValues = false;
    if (mdc.deviceId && !String(mdc.deviceId).startsWith('DEMO-DEVICE-')) sawFakeSensitiveValues = false;

    const j = mdc['x-journey-trace-id'];
    if (j) {
      if (!journeyToTraceIds.has(j)) journeyToTraceIds.set(j, new Set());
      if (!journeyToServices.has(j)) journeyToServices.set(j, new Set());
      journeyToTraceIds.get(j).add(mdc.traceId);
      journeyToServices.get(j).add(evt.application);
    }
  }

  const REQUIRED_TOP_KEYS = [
    '@timestamp', '@version', 'message', 'logger_name', 'thread_name',
    'level', 'level_value', 'application', 'mdc', 'exception',
  ];
  const REQUIRED_MDC_KEYS = [
    'cif', 'UserName', 'CustomerId', 'X-Correlation-id', 'deviceId', 'deviceIp',
    'devicePlatformType', 'language', 'x-journey-trace-id', 'serverIp', 'serverHost',
    'stepName', 'UIIdentifier', 'traceId', 'spanId', 'event.correlationId', 'eventId', 'ERROR_CODE',
  ];

  for (const k of REQUIRED_TOP_KEYS) {
    assertTrue(topKeys.has(k), `top-level field present at least once: ${k}`, failures);
  }
  for (const k of REQUIRED_MDC_KEYS) {
    assertTrue(mdcKeys.has(k), `mdc field present at least once: ${k}`, failures);
  }

  assertTrue(sawException, 'at least one multiline exception (escaped newlines) as one logical event', failures);
  assertTrue(sawEmptyMessage, 'at least one empty message event', failures);
  assertTrue(sawStderr, 'at least one stderr line', failures);
  assertTrue(sawHeaderOnlyCorrelation, 'at least one event with only mdc["X-Correlation-id"]', failures);
  assertTrue(sawLiteralOnlyCorrelation, 'at least one event with only the literal mdc["event.correlationId"] key', failures);
  assertTrue(sawUnknownMdcField, 'at least one unknown MDC field not in the canonical list', failures);
  assertTrue(sawBurst, 'at least one burst of events', failures);
  assertTrue(sawFakeSensitiveValues, 'sensitive field values are obviously fake (FAKE-/DEMO- prefixed)', failures);

  let sawMultiTraceJourney = false;
  let sawMultiServiceJourney = false;
  for (const [, ids] of journeyToTraceIds) if (ids.size >= 2) sawMultiTraceJourney = true;
  for (const [, svcs] of journeyToServices) if (svcs.size >= 2) sawMultiServiceJourney = true;
  assertTrue(sawMultiTraceJourney, 'at least one journey (shared x-journey-trace-id) spanning multiple traceIds', failures);
  assertTrue(sawMultiServiceJourney, 'at least one journey (shared x-journey-trace-id) spanning multiple services', failures);

  // Determinism check: same seed + count must reproduce byte-identical output.
  const corpusAgain = generateCorpus(SEED, COUNT);
  const same = JSON.stringify(corpus) === JSON.stringify(corpusAgain);
  assertTrue(same, 'same seed + count reproduces byte-identical corpus (determinism)', failures);

  // Different seed must still satisfy every edge-case requirement (design
  // guarantees this by scenario position, not by chance) while producing
  // different filler content.
  const corpusOtherSeed = generateCorpus(SEED + 1, COUNT);
  const differs = JSON.stringify(corpus) !== JSON.stringify(corpusOtherSeed);
  assertTrue(differs, 'different seed produces different corpus content', failures);

  if (failures.length === 0) {
    console.log(`SELF-TEST PASS — ${jsonRecords.length} well-formed events, ${malformedCount} malformed line(s), seed=${SEED}, count=${COUNT}`);
    return 0;
  }
  console.log('SELF-TEST FAIL:');
  for (const f of failures) console.log(`  - ${f}`);
  return 1;
}

// --- entry point -------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    process.exit(selfTest());
    return;
  }
  if (args.count !== undefined) {
    await runBounded(args.seed, args.count);
    return;
  }
  await runContinuous(args.seed, args.interval);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
