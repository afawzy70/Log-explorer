/*
 * Synthetic, anonymized prototype dataset. Every identifier, name, host and
 * value below is invented for design review; none comes from a real system.
 * One incident scenario is reused across every prototype state so screens can
 * be compared honestly: a card payment on the Docker Compose project
 * `payments-stack` times out in the ledger, the client retries and succeeds,
 * and the receipt notification then fails.
 */
window.LX_DATA = (function () {
  'use strict';

  const SCOPE = {
    sourceName: 'Local Docker',
    sourceKind: 'docker',
    project: 'payments-stack',
    zone: 'Asia/Kuwait (UTC+03:00)',
    offsetHours: 3,
    date: '15 Sep',
  };

  const SERVICES = [
    { name: 'api-gateway', running: 2, total: 2, lane: 1 },
    { name: 'auth-service', running: 1, total: 1, lane: 2 },
    { name: 'accounts-api', running: 2, total: 2, lane: 3 },
    { name: 'payments-api', running: 3, total: 3, lane: 4 },
    { name: 'ledger-service', running: 1, total: 2, lane: 5 },
    { name: 'notification-worker', running: 1, total: 1, lane: 6 },
    { name: 'audit-writer', running: 1, total: 1, lane: 7 },
  ];
  const LANE = Object.fromEntries(SERVICES.map((s) => [s.name, s.lane]));

  const TRACE = {
    t1: '4bf92f3577b34da6a3ce929d0e0e4736',
    t2: '9c2e7a41d8f64b1e8a3f5c07b2d9e615',
    t3: '1f7b3c9e24a84d6fb0e5a1c8d3b27f94',
    o1: 'b81d4e0f9a2c47d3be65f1a0c9e8d274',
    o2: 'e25c6a9b3f7d41c8a0b94d2e6f1a8c53',
    o3: '7a0d9e3c5b1f48e2a6c4d8b0f3e9a162',
    o4: 'd4f8a2c61e9b47a0b3d5c7e9f1a2b684',
    o5: '3c6e1a9f7b2d48e0a5c3f9d1b7e24a06',
  };
  const CORR = {
    c1: 'c7d1e0a2-5f3b-4c8e-9a61-2b7e8d4f1a90',
    c2: '5a9e3b71-c2d4-4f8a-b6e0-1d7c9f3a2e58',
    c3: '0e4b8d2a-7c1f-4a9e-8b3d-6f2c5a9e1b47',
  };
  const JOURNEY = 'jrn-7f3a9c21e4b8';

  function hex(seed, len) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    let out = '';
    while (out.length < len) { h = Math.imul(h ^ (h >>> 13), 1274126177); out += (h >>> 0).toString(16).padStart(8, '0'); }
    return out.slice(0, len);
  }
  const pad = (n, l = 2) => String(n).padStart(l, '0');

  // at = "HH:MM:SS.mmm" local (Asia/Kuwait)
  function secOf(at) {
    const [h, m, rest] = at.split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(rest);
  }
  function clockOf(sec) {
    const ms = Math.round((sec % 1) * 1000);
    let s = Math.floor(sec);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  }

  const ACTOR_MOBILE = { user: 'ra***07', customer: '84***31', cif: '55***19', deviceId: '7f***2c', deviceIp: '10***41', platform: 'ANDROID', language: 'en' };
  const ACTOR_WEB = { user: 'no***52', customer: '31***06', cif: '22***84', deviceId: 'c0***9a', deviceIp: '10***17', platform: 'WEB', language: 'ar' };

  let n = 0;
  function ev(at, level, service, message, extra = {}) {
    n += 1;
    const sec = secOf(at);
    const id = `e${pad(n, 3)}`;
    return Object.assign({
      id,
      at,
      sec,
      clock: clockOf(sec),
      utc: clockOf(sec - SCOPE.offsetHours * 3600),
      date: SCOPE.date,
      level,
      service,
      lane: LANE[service] || 5,
      message,
      trace: null,
      span: null,
      corr: null,
      journey: null,
      eventId: `evt-01JC8Q${hex(id + 'ev', 20).toUpperCase()}`,
      step: null,
      journeyName: null,
      errorCode: null,
      actor: null,
      logger: `com.example.${service.replace(/-/g, '')}.${level === 'ERROR' ? 'ErrorHandler' : 'RequestLogger'}`,
      thread: `http-nio-8080-exec-${(n % 9) + 1}`,
      container: `payments-stack-${service}-${(n % 2) + 1}`,
      containerId: hex(id + 'ctr', 12),
      stream: level === 'ERROR' ? 'stderr' : 'stdout',
      serverIp: `172.20.0.${10 + (LANE[service] || 5)}`,
      serverHost: `${service}-${(n % 2) + 1}`,
      malformed: false,
      raw: null,
      exception: null,
      unknown: {},
    }, extra);
  }
  function inTrace(t, corr, extra = {}) {
    return Object.assign({ trace: t, corr, journey: null }, extra);
  }

  const EXC = [
    'com.example.payments.ledger.LedgerTimeoutException: reservation rsv-7c1f9e did not complete within 5000 ms',
    '\tat com.example.payments.ledger.LedgerClient.reserve(LedgerClient.java:142)',
    '\tat com.example.payments.authorize.AuthorizationService.authorize(AuthorizationService.java:88)',
    '\tat com.example.payments.api.PaymentController.create(PaymentController.java:57)',
    'Caused by: java.net.SocketTimeoutException: Read timed out',
    '\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)',
    '\tat java.base/sun.nio.ch.NioSocketImpl.implRead(NioSocketImpl.java:314)',
    '\t... 41 more',
  ].join('\n');

  // ------------------------------------------------------------------ trace t1: the failing checkout
  const t1 = [
    ev('14:02:07.101', 'INFO', 'api-gateway', 'POST /api/v2/payments accepted', inTrace(TRACE.t1, CORR.c1, { step: 'RECEIVE_REQUEST', actor: ACTOR_MOBILE })),
    ev('14:02:07.118', 'INFO', 'auth-service', 'Access token validated for client mobile-app', inTrace(TRACE.t1, CORR.c1, { step: 'AUTHENTICATE', actor: ACTOR_MOBILE })),
    ev('14:02:07.164', 'INFO', 'accounts-api', 'Customer profile loaded', inTrace(TRACE.t1, CORR.c1, { step: 'LOAD_PROFILE', actor: ACTOR_MOBILE })),
    ev('14:02:07.203', 'INFO', 'payments-api', 'Authorization started for amount 42.500 KWD', inTrace(TRACE.t1, CORR.c1, { step: 'AUTHORIZE_PAYMENT', actor: ACTOR_MOBILE })),
    ev('14:02:07.219', 'DEBUG', 'ledger-service', 'Reservation request received for rsv-7c1f9e', inTrace(TRACE.t1, CORR.c1, { step: 'RESERVE_FUNDS' })),
    ev('14:02:09.742', 'WARN', 'ledger-service', 'Reservation rsv-7c1f9e still pending after 2500 ms (pool utilisation 96%)', inTrace(TRACE.t1, CORR.c1, { step: 'RESERVE_FUNDS' })),
    ev('14:02:12.209', 'ERROR', 'payments-api', 'Payment authorization failed: ledger reservation timed out after 5000 ms', inTrace(TRACE.t1, CORR.c1, {
      step: 'AUTHORIZE_PAYMENT', journeyName: 'CARD_PAYMENT', errorCode: 'PAY-4102', actor: ACTOR_MOBILE, exception: EXC,
      logger: 'com.example.payments.authorize.AuthorizationService', thread: 'http-nio-8080-exec-7', container: 'payments-stack-payments-api-2',
      unknown: { uiElement: 'checkout.pay-button', 'http.route': '/api/v2/payments', 'retry.attempt': 0, 'mdc.tenant': 'retail', 'mdc.channel': 'MOBILE' },
    })),
    ev('14:02:12.231', 'WARN', 'api-gateway', 'POST /api/v2/payments completed with 504 in 5130 ms', inTrace(TRACE.t1, CORR.c1, { step: 'RESPOND', actor: ACTOR_MOBILE })),
    ev('14:02:12.644', 'INFO', 'audit-writer', 'Audit record written for payment attempt', inTrace(TRACE.t1, CORR.c1, { step: 'AUDIT' })),
  ];
  const ROOT = t1[6];

  // ------------------------------------------------------------------ trace t2: the client retry succeeds
  const t2 = [
    ev('14:02:19.905', 'INFO', 'api-gateway', 'POST /api/v2/payments accepted (client retry 1)', inTrace(TRACE.t2, CORR.c2, { step: 'RECEIVE_REQUEST', actor: ACTOR_MOBILE })),
    ev('14:02:19.921', 'INFO', 'auth-service', 'Access token validated for client mobile-app', inTrace(TRACE.t2, CORR.c2, { step: 'AUTHENTICATE', actor: ACTOR_MOBILE })),
    ev('14:02:20.004', 'INFO', 'payments-api', 'Authorization started for amount 42.500 KWD', inTrace(TRACE.t2, CORR.c2, { step: 'AUTHORIZE_PAYMENT', actor: ACTOR_MOBILE })),
    ev('14:02:20.388', 'INFO', 'ledger-service', 'Funds reserved for rsv-91ad04', inTrace(TRACE.t2, CORR.c2, { step: 'RESERVE_FUNDS' })),
    ev('14:02:20.512', 'INFO', 'payments-api', 'Payment authorized', inTrace(TRACE.t2, CORR.c2, { step: 'AUTHORIZE_PAYMENT', actor: ACTOR_MOBILE })),
    ev('14:02:20.560', 'INFO', 'api-gateway', 'POST /api/v2/payments completed with 201 in 655 ms', inTrace(TRACE.t2, CORR.c2, { step: 'RESPOND', actor: ACTOR_MOBILE })),
  ];
  // ------------------------------------------------------------------ trace t3: async receipt notification fails
  const t3 = [
    ev('14:02:21.020', 'INFO', 'notification-worker', 'Payment receipt notification queued', inTrace(TRACE.t3, CORR.c2, { step: 'SEND_RECEIPT' })),
    ev('14:02:21.380', 'ERROR', 'notification-worker', 'Push provider rejected notification: device token expired', inTrace(TRACE.t3, CORR.c2, { step: 'SEND_RECEIPT', errorCode: 'NTF-2003' })),
  ];
  [...t1, ...t2, ...t3].forEach((e) => { e.journey = JOURNEY; e.journeyName = 'CARD_PAYMENT'; });

  // ------------------------------------------------------------------ unrelated traffic in the same window
  const other = [
    ev('14:02:17.330', 'INFO', 'accounts-api', 'GET /api/v2/accounts/summary returned 200 in 38 ms', inTrace(TRACE.o1, CORR.c3, { step: 'LOAD_SUMMARY', actor: ACTOR_WEB })),
    ev('14:02:15.002', 'WARN', 'ledger-service', null, { malformed: true, raw: 'ledger-service  | WARN  pool stats: active=48 idle=2 waiting=17 (non-JSON line)', eventId: null, logger: null, thread: null }),
    ev('14:02:14.870', 'WARN', 'auth-service', 'Token refresh throttled for client web-portal (12 requests/min)', inTrace(TRACE.o2, CORR.c3, { step: 'REFRESH_TOKEN', actor: ACTOR_WEB })),
    ev('14:02:05.640', 'INFO', 'accounts-api', 'GET /api/v2/accounts/summary returned 200 in 41 ms', inTrace(TRACE.o3, CORR.c3, { actor: ACTOR_WEB })),
    ev('14:02:03.118', 'ERROR', 'ledger-service', 'Connection pool exhausted: 50 of 50 connections in use, 17 waiting', inTrace(TRACE.o4, null, { errorCode: 'LED-1107', step: 'RESERVE_FUNDS' })),
    ev('14:02:02.907', 'INFO', 'api-gateway', 'GET /api/v2/accounts/summary accepted', inTrace(TRACE.o3, CORR.c3, { actor: ACTOR_WEB })),
    ev('14:02:01.455', 'INFO', 'payments-api', 'Payment authorized', inTrace(TRACE.o5, null, { step: 'AUTHORIZE_PAYMENT', actor: ACTOR_WEB })),
    ev('14:02:01.296', 'INFO', 'ledger-service', 'Funds reserved for rsv-5be210', inTrace(TRACE.o5, null, { step: 'RESERVE_FUNDS' })),
    ev('14:02:00.840', 'INFO', 'payments-api', 'Authorization started for amount 7.250 KWD', inTrace(TRACE.o5, null, { step: 'AUTHORIZE_PAYMENT', actor: ACTOR_WEB })),
    ev('14:01:59.771', 'INFO', 'auth-service', 'Access token validated for client web-portal', inTrace(TRACE.o5, null, { step: 'AUTHENTICATE', actor: ACTOR_WEB })),
    ev('14:01:59.760', 'INFO', 'api-gateway', 'POST /api/v2/payments accepted', inTrace(TRACE.o5, null, { step: 'RECEIVE_REQUEST', actor: ACTOR_WEB })),
    ev('14:01:58.112', 'WARN', 'payments-api', 'Idempotency key reused within 30 s; returning cached response', inTrace(TRACE.o2, CORR.c3, { errorCode: 'PAY-2010', actor: ACTOR_WEB })),
    ev('14:01:56.004', 'INFO', 'api-gateway', '', inTrace(TRACE.o2, CORR.c3, {})),
    ev('14:01:54.338', 'INFO', 'accounts-api', 'Customer profile loaded', inTrace(TRACE.o2, CORR.c3, { step: 'LOAD_PROFILE', actor: ACTOR_WEB })),
    ev('14:01:52.901', 'INFO', 'auth-service', 'Access token validated for client mobile-app', inTrace(TRACE.o2, CORR.c3, { step: 'AUTHENTICATE', actor: ACTOR_WEB })),
    ev('14:01:51.477', 'INFO', 'payments-api', 'Refund settlement batch acknowledged by ledger', inTrace(TRACE.o4, null, {})),
    ev('14:01:49.020', 'INFO', 'api-gateway', 'GET /actuator/health returned 200 in 3 ms', {}),
    ev('14:01:46.915', 'WARN', 'ledger-service', 'Slow query: reservation lookup took 1840 ms', inTrace(TRACE.o4, null, { step: 'RESERVE_FUNDS' })),
  ];

  // Search results: Last 1 hour, services EXCLUDE [audit-writer, notification-worker], severity Info/Warn/Error, newest first.
  const excluded = ['audit-writer', 'notification-worker'];
  const visibleLevels = ['INFO', 'WARN', 'ERROR'];
  const results = [...t1, ...t2, ...other]
    .filter((e) => !excluded.includes(e.service) && visibleLevels.includes(e.level))
    .sort((a, b) => b.sec - a.sec);

  // Trace capture (all levels, ascending) and journey capture (three traces).
  const traceCapture = [...t1].sort((a, b) => a.sec - b.sec);
  const journeyCapture = [...t1, ...t2, ...t3].sort((a, b) => a.sec - b.sec);

  // ±30 s surroundings, scoped to the root event's service (payments-api), all levels, oldest first.
  n = 500;
  const ctxExtra = [
    ev('14:01:45.310', 'INFO', 'payments-api', 'Scheduled reconciliation batch started', {}),
    ev('14:01:50.122', 'DEBUG', 'payments-api', 'Outbox poll: 0 messages', {}),
    ev('14:02:10.004', 'DEBUG', 'payments-api', 'Ledger client awaiting reservation response (attempt 1)', inTrace(TRACE.t1, CORR.c1, {})),
    ev('14:02:15.500', 'INFO', 'payments-api', 'Circuit breaker for ledger-service moved to half-open', {}),
    ev('14:02:23.210', 'DEBUG', 'payments-api', 'Outbox poll: 0 messages', {}),
    ev('14:02:26.901', 'INFO', 'payments-api', 'Authorization started for amount 3.000 KWD', inTrace('a91f3e7c2b5d48e6a0c7d9f2e4b1a835', null, {})),
    ev('14:02:27.340', 'INFO', 'payments-api', 'Payment authorized', inTrace('a91f3e7c2b5d48e6a0c7d9f2e4b1a835', null, {})),
    ev('14:02:39.118', 'INFO', 'payments-api', 'Outbox poll: 1 message published', {}),
  ];
  const context = [...t1, ...t2, ...other, ...ctxExtra]
    .filter((e) => e.service === 'payments-api' && Math.abs(e.sec - ROOT.sec) <= 30)
    .sort((a, b) => a.sec - b.sec);

  // Live: newest first, events received since Start.
  n = 800;
  const live = [
    ['14:06:44.918', 'INFO', 'api-gateway', 'POST /api/v2/payments completed with 201 in 612 ms'],
    ['14:06:44.866', 'INFO', 'payments-api', 'Payment authorized'],
    ['14:06:44.740', 'INFO', 'ledger-service', 'Funds reserved for rsv-a204c9'],
    ['14:06:44.301', 'INFO', 'payments-api', 'Authorization started for amount 12.000 KWD'],
    ['14:06:44.288', 'INFO', 'auth-service', 'Access token validated for client mobile-app'],
    ['14:06:44.270', 'INFO', 'api-gateway', 'POST /api/v2/payments accepted'],
    ['14:06:43.902', 'WARN', 'ledger-service', 'Reservation rsv-a1f0b2 still pending after 2500 ms (pool utilisation 91%)'],
    ['14:06:42.515', 'INFO', 'accounts-api', 'GET /api/v2/accounts/summary returned 200 in 36 ms'],
    ['14:06:41.077', 'INFO', 'notification-worker', 'Payment receipt notification delivered'],
    ['14:06:40.660', 'ERROR', 'payments-api', 'Payment authorization failed: ledger reservation timed out after 5000 ms'],
    ['14:06:40.638', 'INFO', 'audit-writer', 'Audit record written for payment attempt'],
    ['14:06:39.214', 'INFO', 'api-gateway', 'GET /actuator/health returned 200 in 2 ms'],
    ['14:06:38.940', 'INFO', 'auth-service', 'Access token validated for client web-portal'],
    ['14:06:38.101', 'WARN', 'auth-service', 'Token refresh throttled for client web-portal (11 requests/min)'],
    ['14:06:37.552', 'INFO', 'payments-api', 'Refund settlement batch acknowledged by ledger'],
    ['14:06:36.019', 'INFO', 'accounts-api', 'Customer profile loaded'],
    ['14:06:35.470', 'INFO', 'api-gateway', 'POST /api/v2/payments accepted'],
    ['14:06:34.806', 'INFO', 'ledger-service', 'Funds reserved for rsv-9e11d3'],
    ['14:06:33.330', 'INFO', 'payments-api', 'Payment authorized'],
    ['14:06:32.118', 'INFO', 'notification-worker', 'Payment receipt notification queued'],
    ['14:06:31.442', 'INFO', 'audit-writer', 'Audit record written for payment attempt'],
    ['14:06:30.905', 'INFO', 'api-gateway', 'POST /api/v2/payments completed with 201 in 588 ms'],
  ].map(([at, l, s, m]) => ev(at, l, s, m, inTrace(hex(at, 32), null, {})));

  // ------------------------------------------------------------------ field mapping (scope: Local Docker · payments-stack)
  const F = (field, key, paths, status, evidence, o = {}) => Object.assign({ field, key, paths, status, evidence, protected: false, source: 'default' }, o);
  const ob = (seen, of = 200) => ({ seen, of });
  const mapping = [
    F('Timestamp', 'timestamp', ['@timestamp'], 'VERIFIED', ob(200)),
    F('Service', 'service', ['application'], 'VERIFIED', ob(200)),
    F('Severity', 'severity', ['level'], 'VERIFIED', ob(200)),
    F('Message', 'message', ['message'], 'VERIFIED', ob(198)),
    F('Logger', 'logger', ['logger_name'], 'VERIFIED', ob(196)),
    F('Thread', 'thread', ['thread_name'], 'VERIFIED', ob(196)),
    F('Exception', 'exception', ['stack_trace'], 'VERIFIED', ob(14)),
    F('CIF', 'cif', ['cif'], 'VERIFIED', ob(61), { protected: true }),
    F('Username', 'userName', ['userName'], 'VERIFIED', ob(61), { protected: true }),
    F('Customer ID', 'customerId', ['customerId'], 'VERIFIED', ob(61), { protected: true }),
    F('Device ID', 'deviceId', ['deviceId'], 'VERIFIED', null, { protected: true }),
    F('Device IP', 'deviceIp', ['deviceIp'], 'VERIFIED', ob(58), { protected: true }),
    F('Correlation ID', 'correlationId', ['X-Correlation-id'], 'VERIFIED', ob(187)),
    F('Trace ID', 'traceId', ['traceId'], 'VERIFIED', ob(190)),
    F('Span ID', 'spanId', ['spanId'], 'VERIFIED', ob(190)),
    F('Journey ID', 'journeyId', ['journeyTraceId'], 'VERIFIED', ob(142), { source: 'custom' }),
    F('Journey Name', 'journeyName', ['journeyName'], 'VERIFIED', ob(142)),
    F('Event ID', 'eventId', ['mdc.eventId'], 'VERIFIED', ob(176)),
    F('Business Step', 'businessStep', ['stepName'], 'VERIFIED', ob(151)),
    F('UI Identifier', 'uiIdentifier', [], 'UNVERIFIED', null, { source: 'none' }),
    F('Error Code', 'errorCode', ['mdc.ERROR_CODE'], 'VERIFIED', ob(16)),
    F('Device Platform Type', 'devicePlatformType', ['devicePlatformType'], 'VERIFIED', ob(61)),
    F('Language', 'language', ['language'], 'VERIFIED', ob(61)),
    F('Server IP', 'serverIp', ['serverIp'], 'VERIFIED', ob(200)),
    F('Server Host', 'serverHost', ['serverHost'], 'VERIFIED', ob(200)),
  ];

  const schema = [
    ['@timestamp', 'string', 200], ['level', 'string', 200], ['application', 'string', 200], ['message', 'string', 198],
    ['logger_name', 'string', 196], ['thread_name', 'string', 196], ['traceId', 'string', 190], ['spanId', 'string', 190],
    ['X-Correlation-id', 'string', 187], ['mdc.eventId', 'string', 176], ['stepName', 'string', 151], ['journeyTraceId', 'string', 142],
    ['journeyName', 'string', 142], ['uiElement', 'string', 118], ['http.route', 'string', 118], ['mdc.businessStep', 'string', 96],
    ['cif', 'string', 61], ['userName', 'string', 61], ['customerId', 'string', 61], ['devicePlatformType', 'string', 61],
    ['language', 'string', 61], ['deviceIp', 'string', 58], ['serverIp', 'string', 200], ['serverHost', 'string', 200],
    ['mdc.ERROR_CODE', 'string', 16], ['stack_trace', 'string', 14], ['retry.attempt', 'number', 118], ['mdc.tenant', 'string', 200],
  ];

  // Original Event Sample: synthetic values; the real product shows real, unmasked samples that are never persisted.
  const sample = JSON.stringify({
    '@timestamp': '2026-09-15T11:02:12.209Z',
    level: 'ERROR',
    application: 'payments-api',
    logger_name: 'com.example.payments.authorize.AuthorizationService',
    thread_name: 'http-nio-8080-exec-7',
    message: 'Payment authorization failed: ledger reservation timed out after 5000 ms',
    traceId: TRACE.t1,
    spanId: '5d2a9f0c81e47b36',
    'X-Correlation-id': CORR.c1,
    journeyTraceId: JOURNEY,
    journeyName: 'CARD_PAYMENT',
    stepName: 'AUTHORIZE_PAYMENT',
    uiElement: 'checkout.pay-button',
    userName: 'user.2207',
    customerId: 'CUS-100488',
    cif: '900000219',
    deviceIp: '10.24.3.41',
    devicePlatformType: 'ANDROID',
    language: 'en',
    serverIp: '172.20.0.14',
    serverHost: 'payments-api-2',
    'http.route': '/api/v2/payments',
    'retry.attempt': 0,
    mdc: { eventId: 'evt-01JC8Q4M7R2K9V5T3X6Z0B1N8D', ERROR_CODE: 'PAY-4102', tenant: 'retail', businessStep: 'AUTHORIZE' },
    stack_trace: 'com.example.payments.ledger.LedgerTimeoutException: reservation rsv-7c1f9e did not complete within 5000 ms\n\tat com.example.payments.ledger.LedgerClient.reserve(LedgerClient.java:142)',
  }, null, 2);

  return { SCOPE, SERVICES, TRACE, CORR, JOURNEY, ROOT, results, traceCapture, journeyCapture, context, live, mapping, schema, sample, excluded };
})();
