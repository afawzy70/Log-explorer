/*
 * Modern Developer Console — Event classification design sync (PR #59, main 51f06e5).
 * Synthetic, anonymised data plus state renderers for classification rules, the
 * create-from-event rule builder, extraction, rule test, import/export, tag filter
 * and the unavailable OpenShift Loki source. Loaded after data.js and before app.js;
 * app.js calls window.LX_EXT(api) to register the states. Static: nothing is wired.
 *
 * Every number shown is the kind of value the real API returns (measured sample
 * counts, extracted/of coverage). No confidence percentages, no false-positive claims.
 */
(function () {
  'use strict';
  const D = window.LX_DATA;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const secOf = (at) => { const [h, m, r] = at.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(r); };
  const clockOf = (sec) => { const ms = Math.round((sec % 1) * 1000); let s = Math.floor(sec); const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60; return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`; };
  const base = D.results.find((e) => e.service === 'payments-api' && e.level === 'INFO' && e.trace);
  let n = 900;
  function mk(at, level, service, message, extra = {}) {
    n += 1;
    const sec = secOf(at);
    return Object.assign({}, base, {
      id: `c${n}`, at, sec, clock: clockOf(sec), utc: clockOf(sec - 3 * 3600), level, service, message,
      eventId: `evt-01JC8R${String(n).padStart(4, '0')}K2M9V5T3X6Z0B`, step: 'CALL_PARTNER', errorCode: null, exception: null,
      logger: `com.example.${service.replace(/-/g, '')}.integration.WebhookClient`, stream: level === 'ERROR' ? 'stderr' : 'stdout',
      container: `payments-stack-${service}-1`, tags: [], classifications: [], malformed: false, raw: null,
    }, extra);
  }

  // ------------------------------------------------------------------ middleware-like events (same incident window)
  const W1 = mk('14:02:11.884', 'WARN', 'payments-api', 'Make webhook call to /partners/acquirer/authorize method=POST requestId=req-4f1c20 responseCode=502 duration=5012ms', { trace: D.TRACE.t1, corr: D.CORR.c1, unknown: { 'http.route': '/partners/acquirer/authorize', 'mdc.channel': 'MOBILE' } });
  const W2 = mk('14:02:20.450', 'INFO', 'payments-api', 'Make webhook call to /partners/acquirer/authorize method=POST requestId=req-4f1c31 responseCode=201 duration=388ms', { trace: D.TRACE.t2, corr: D.CORR.c2 });
  const W3 = mk('14:01:58.930', 'INFO', 'accounts-api', 'Make webhook call to /partners/kyc/verify method=GET requestId=req-4f1b88 responseCode=200 duration=142ms', { trace: D.TRACE.o2, corr: D.CORR.c3, step: 'VERIFY_CUSTOMER' });
  const QUEUED = mk('14:01:49.118', 'WARN', 'payments-api', 'Make webhook call to /partners/kyc/verify method=GET requestId=req-4f1b77 (queued, no response yet)', { trace: null, corr: null });
  const NEAR = mk('14:01:55.210', 'INFO', 'payments-api', 'Make webhook configuration reload requestId=req-4f1b80', { trace: null, corr: null, step: null });

  // ------------------------------------------------------------------ saved rules (generic: none is special-cased)
  const X = (name, label, from, type, expr, valueType = 'STRING', o = {}) => Object.assign({ name, label, sourceField: from, type, expression: expr, valueType, sensitive: false }, o);
  const RULES = [
    { id: 'middleware-http-call', name: 'Middleware HTTP call', description: 'Outbound calls made through the integration middleware', tags: ['middleware', 'external-api'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'Make webhook call to' }, { field: 'message', matcher: 'CONTAINS', value: 'method=' }, { field: 'message', matcher: 'CONTAINS', value: 'requestId=' }, { field: 'message', matcher: 'CONTAINS', value: 'responseCode=' }, { field: 'message', matcher: 'CONTAINS', value: 'duration=' }],
      extractions: [X('url', 'URL', 'message', 'REGEX', '\\bto\\s+(?P<url>\\S+)'), X('method', 'Method', 'message', 'REGEX', 'method=(?P<method>[^\\s,;]+)'), X('requestId', 'Request ID', 'message', 'REGEX', 'requestId=(?P<requestId>[^\\s,;]+)'), X('responseCode', 'Response code', 'message', 'REGEX', 'responseCode=(?P<responseCode>[-+]?\\d+)', 'INTEGER'), X('durationMs', 'Duration (ms)', 'message', 'REGEX', 'duration=(?P<durationMs>\\d+(?:\\.\\d+)?)ms', 'INTEGER'), X('requestBody', 'Request body', 'extra.request', 'JSON_POINTER', '/body', 'STRING', { sensitive: true })] },
    { id: 'acquirer-partner-call', name: 'Acquirer partner call', description: 'Card acquirer requests, with request and response payloads', tags: ['external-api', 'partner'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'message', matcher: 'CONTAINS', value: '/partners/acquirer/' }, { field: 'service', matcher: 'EXACT', value: 'payments-api' }],
      extractions: [X('partner', 'Partner', 'message', 'REGEX', '/partners/(?P<partner>[^/]+)/'), X('customerId', 'Customer ID', 'extra.request', 'JSON_POINTER', '/customer/id'), X('authorization', 'Authorization header', 'extra.request', 'JSON_POINTER', '/headers/Authorization', 'STRING', { sensitive: true }), X('requestBody', 'Request body', 'extra.request', 'JSON_POINTER', '/body'), X('responseBody', 'Response body', 'extra.response', 'JSON_POINTER', '/body'), X('retryAfter', 'Retry-After (s)', 'extra.response', 'JSON_POINTER', '/headers/Retry-After', 'INTEGER')] },
    { id: 'acquirer-decline', name: 'Acquirer decline', description: 'Marks declined acquirer authorizations', tags: ['partner'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'Acquirer rejected authorization' }], extractions: [] },
    { id: 'acquirer-response-details', name: 'Acquirer response details', description: 'Response payloads of declined authorizations', tags: ['external-api', 'partner'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'message', matcher: 'CONTAINS', value: 'Acquirer rejected authorization' }, { field: 'service', matcher: 'EXACT', value: 'payments-api' }],
      extractions: [X('responseBody', 'Response body', 'extra.response', 'JSON_POINTER', '/body'), X('callbackUrl', 'Callback URL', 'extra.request', 'JSON_POINTER', '/callbackUrl'), X('errorDetail', 'Error detail', 'extra.response', 'JSON_POINTER', '/detail')] },
    { id: 'gateway-http-response', name: 'Gateway HTTP response', description: '', tags: ['gateway-response'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'service', matcher: 'EXACT', value: 'api-gateway' }, { field: 'message', matcher: 'CONTAINS', value: ' completed with ' }],
      extractions: [X('method', 'Method', 'message', 'REGEX', '^(?P<method>[A-Z]+) '), X('path', 'Path', 'message', 'REGEX', ' (?P<path>/\\S+) '), X('status', 'Status', 'message', 'REGEX', 'with (?P<status>\\d{3})', 'INTEGER'), X('durationMs', 'Duration (ms)', 'message', 'REGEX', 'in (?P<durationMs>\\d+) ms', 'INTEGER')] },
    { id: 'slow-ledger-reservation', name: 'Slow ledger reservation', description: 'Ledger waits longer than normal for the database', tags: ['database-call'], enabled: true, matchMode: 'ALL',
      conditions: [{ field: 'service', matcher: 'EXACT', value: 'ledger-service' }, { field: 'message', matcher: 'REGEX', value: '(pending after|took) \\d+ ms' }],
      extractions: [X('waitMs', 'Wait (ms)', 'message', 'REGEX', '(?:after|took) (?P<waitMs>\\d+) ms', 'INTEGER')] },
    { id: 'mobile-client-call', name: 'Mobile client call', description: 'Paused while the channel field is remapped', tags: ['mobile-call'], enabled: false, matchMode: 'ALL',
      conditions: [{ field: 'mdc.channel', matcher: 'EXACT', value: 'MOBILE' }], extractions: [] },
    { id: 'frontend-call', name: 'Frontend call', description: '', tags: ['frontend-call'], enabled: true, matchMode: 'ANY',
      conditions: [{ field: 'extra.uiElement', matcher: 'STARTS_WITH', value: 'checkout.' }, { field: 'extra.uiElement', matcher: 'STARTS_WITH', value: 'login.' }], extractions: [X('uiElement', 'UI element', 'extra.uiElement', 'REGEX', '^(?P<uiElement>.+)$')] },
  ];
  // Server order: priority, then id. The rule editor sets no priority (all 100), so rules are listed and evaluated in id order.
  RULES.sort((a, b) => a.id.localeCompare(b.id));
  const TAGS = [...new Set(RULES.flatMap((r) => r.tags))].sort();

  // ------------------------------------------------------------------ what the server concluded about individual events
  const P = (name, label, value, o = {}) => Object.assign({ name, label, value, status: 'PRESENT', redacted: false, truncated: false }, o);
  const REQUEST_BODY = JSON.stringify({ merchantId: 'm-100245', amount: { value: '42.500', currency: 'KWD' }, card: { token: '[REDACTED]', brand: 'VISA' }, captureMode: 'AUTO', reference: 'rsv-7c1f9e', callbackUrl: 'https://payments.example.internal/api/v2/payments/callbacks/acquirer?reference=rsv-7c1f9e&attempt=0&channel=MOBILE&tenant=retail&signatureVersion=2' }, null, 2);
  const W1_CLS = [
    { ruleId: 'middleware-http-call', ruleName: 'Middleware HTTP call', tags: ['middleware', 'external-api'], extracted: [P('url', 'URL', '/partners/acquirer/authorize'), P('method', 'Method', 'POST'), P('requestId', 'Request ID', 'req-4f1c20'), P('responseCode', 'Response code', '502'), P('durationMs', 'Duration (ms)', '5012'), P('requestBody', 'Request body', '[REDACTED]', { redacted: true })] },
    { ruleId: 'acquirer-partner-call', ruleName: 'Acquirer partner call', tags: ['external-api', 'partner'], extracted: [
      P('partner', 'Partner', 'acquirer'),
      P('customerId', 'Customer ID', '84***31', { redacted: true }),
      P('authorization', 'Authorization header', '[REDACTED]', { redacted: true }),
      P('requestBody', 'Request body', REQUEST_BODY, { json: true, redacted: true }),
      P('responseBody', 'Response body', null, { status: 'ABSENT' }),
      P('retryAfter', 'Retry-After (s)', null, { status: 'INVALID' }),
    ] },
  ];
  W1.classifications = [W1_CLS[1], W1_CLS[0]]; W1.tags = ['external-api', 'partner', 'middleware'];
  W2.classifications = [{ ruleId: 'middleware-http-call', ruleName: 'Middleware HTTP call', tags: ['middleware', 'external-api'], extracted: [P('url', 'URL', '/partners/acquirer/authorize'), P('method', 'Method', 'POST'), P('requestId', 'Request ID', 'req-4f1c31'), P('responseCode', 'Response code', '201'), P('durationMs', 'Duration (ms)', '388'), P('requestBody', 'Request body', null, { status: 'ABSENT' })] }, { ruleId: 'acquirer-partner-call', ruleName: 'Acquirer partner call', tags: ['external-api', 'partner'], extracted: [P('partner', 'Partner', 'acquirer'), P('customerId', 'Customer ID', null, { status: 'ABSENT' }), P('authorization', 'Authorization header', null, { status: 'ABSENT' }), P('requestBody', 'Request body', null, { status: 'ABSENT' }), P('responseBody', 'Response body', null, { status: 'ABSENT' }), P('retryAfter', 'Retry-After (s)', null, { status: 'ABSENT' })] }];
  W2.classifications.reverse();
  W2.tags = ['external-api', 'partner', 'middleware'];
  W3.classifications = [{ ruleId: 'middleware-http-call', ruleName: 'Middleware HTTP call', tags: ['middleware', 'external-api'], extracted: [P('url', 'URL', '/partners/kyc/verify'), P('method', 'Method', 'GET'), P('requestId', 'Request ID', 'req-4f1b88'), P('responseCode', 'Response code', '200'), P('durationMs', 'Duration (ms)', '142'), P('requestBody', 'Request body', null, { status: 'ABSENT' })] }];
  W3.tags = ['middleware', 'external-api'];
  const ERROR_DETAIL = Array.from({ length: 40 }, (_, i) => `attempt ${i + 1}: issuer ISS-0442 did not answer within 2500 ms; acquirer AQ-5301 scheduled retry ${i + 2};`).join(' ').slice(0, 2000);
  const LONG = mk('14:02:12.020', 'ERROR', 'payments-api', 'Acquirer rejected authorization for reference rsv-7c1f9e', { trace: D.TRACE.t1, corr: D.CORR.c1, errorCode: 'PAY-4107' });
  LONG.classifications = [
    { ruleId: 'acquirer-decline', ruleName: 'Acquirer decline', tags: ['partner'], extracted: [] },
    { ruleId: 'acquirer-response-details', ruleName: 'Acquirer response details', tags: ['external-api', 'partner'], extracted: [
    P('responseBody', 'Response body', JSON.stringify({ status: 'DECLINED', code: 'AQ-5301', message: 'Issuer unavailable', retryable: true, diagnostics: { issuer: 'ISS-0442', window: '2026-09-15T11:02:07Z/2026-09-15T11:02:12Z', attempts: [{ at: '11:02:07.221Z', result: 'TIMEOUT' }, { at: '11:02:09.735Z', result: 'TIMEOUT' }, { at: '11:02:12.004Z', result: 'DECLINED' }] } }, null, 2), { json: true }),
    P('callbackUrl', 'Callback URL', 'https://payments.example.internal/api/v2/payments/callbacks/acquirer?reference=rsv-7c1f9e&attempt=0&channel=MOBILE&tenant=retail&signatureVersion=2&correlation=c7d1e0a2-5f3b-4c8e-9a61-2b7e8d4f1a90&returnTo=%2Fcheckout%2Fresult%3Fsession%3Dcs_91f0c2a7e4b84d1f', { long: true }),
    P('errorDetail', 'Error detail', ERROR_DETAIL, { truncated: true, long: true }),
  ] }];
  LONG.tags = ['partner', 'external-api'];

  // The root event carries uiElement "checkout.pay-button"; the enabled Frontend call rule tags it and extracts it.
  D.ROOT.tags = ['frontend-call'];
  D.ROOT.classifications = [{ ruleId: 'frontend-call', ruleName: 'Frontend call', tags: ['frontend-call'], extracted: [P('uiElement', 'UI element', 'checkout.pay-button')] }];
  // Search results with tags applied by the server. Existing states keep their own data; only new states use these lists.
  const tagFor = (e) => {
    if (e.unknown && typeof e.unknown.uiElement === 'string' && /^(checkout|login)\./.test(e.unknown.uiElement)) return ['frontend-call'];
    if (/ completed with /.test(e.message || '') && e.service === 'api-gateway') return ['gateway-response'];
    if (e.service === 'ledger-service' && /(pending after|took) \d+ ms/.test(e.message || '')) return ['database-call'];
    return [];
  };
  const tagged = D.results.map((e) => Object.assign({}, e, { tags: tagFor(e) }));
  const clsResults = [...tagged, W1, W2, W3, NEAR, QUEUED, LONG].sort((a, b) => b.sec - a.sec);
  const tagFiltered = clsResults.filter((e) => (e.tags || []).some((t) => ['middleware', 'gateway-response'].includes(t)));

  // ------------------------------------------------------------------ pattern detection (anchored on W1, bounded sample)
  const DETECT = {
    status: 'SUGGESTED', field: 'message', structure: 'TEXT', sampledEvents: 200, valuesWithField: 198, similarEvents: 17,
    segments: [['fixed', 'Make webhook call to '], ['var', '/partners/acquirer/authorize', 'url', 'PATH'], ['fixed', ' method='], ['var', 'POST', 'method', 'TEXT'], ['fixed', ' requestId='], ['var', 'req-4f1c20', 'requestId', 'ID'], ['fixed', ' responseCode='], ['var', '502', 'responseCode', 'NUMBER'], ['fixed', ' duration='], ['var', '5012ms', 'duration', 'DURATION']],
    variables: [['url', 'Path', '/partners/acquirer/authorize'], ['method', 'Text', 'POST'], ['requestId', 'Identifier', 'req-4f1c20'], ['responseCode', 'Number', '502'], ['duration', 'Duration', '5012ms']],
    conditions: RULES.find((r) => r.id === 'middleware-http-call').conditions, matchMode: 'ALL', coverage: { matchedSimilar: 17, similar: 17, matchedOther: 0, other: 181 },
    suggestedExtractions: [['URL', 17, 17], ['Method', 17, 17], ['Request ID', 17, 17], ['Response code', 17, 17], ['Duration (ms)', 16, 17]],
    warnings: [],
  };
  const NO_SAFE = { status: 'NO_SAFE_PATTERN_SUGGESTION', reason: 'Only 2 similar value(s) were found among 198 sampled value(s); at least 3 are needed to suggest a pattern safely. Widen the time range or create the rule manually.', sampledEvents: 200, valuesWithField: 198, similarEvents: 2 };

  // ------------------------------------------------------------------ rule test (bounded real sample, nothing saved)
  const pv = (at, service, level, value, extracted, o = {}) => Object.assign({ at, service, level, value, extracted, matched: 5, of: 5 }, o);
  const TEST = {
    sampledEvents: 200, sampleLimitReached: true, matched: 17, notMatched: 183,
    coverage: [['URL', 17, 0, 17], ['Method', 17, 0, 17], ['Request ID', 17, 0, 17], ['Response code', 17, 0, 17], ['Duration (ms)', 16, 0, 17], ['Request body', 1, 0, 17]],
    matchedPreview: [
      pv('14:02:20.450', 'payments-api', 'INFO', W2.message, [['URL', '/partners/acquirer/authorize'], ['Method', 'POST'], ['Request ID', 'req-4f1c31'], ['Response code', '201'], ['Duration (ms)', '388']]),
      pv('14:02:11.884', 'payments-api', 'WARN', W1.message, [['URL', '/partners/acquirer/authorize'], ['Method', 'POST'], ['Request ID', 'req-4f1c20'], ['Response code', '502'], ['Duration (ms)', '5012']]),
      pv('14:01:58.930', 'accounts-api', 'INFO', W3.message, [['URL', '/partners/kyc/verify'], ['Method', 'GET'], ['Request ID', 'req-4f1b88'], ['Response code', '200'], ['Duration (ms)', '142']]),
      pv('14:01:41.302', 'payments-api', 'INFO', 'Make webhook call to /partners/acquirer/capture method=POST requestId=req-4f1b61 responseCode=200 duration=n/a', [['URL', '/partners/acquirer/capture'], ['Method', 'POST'], ['Request ID', 'req-4f1b61'], ['Response code', '200'], ['Duration (ms)', null]]),
      pv('14:01:12.775', 'payments-api', 'INFO', 'Make webhook call to /partners/push/send method=POST requestId=req-4f1a09 responseCode=202 duration=61ms payload=%7B%22reference%22%3A%22rsv-7c1f9e%22%2C%22amount%22%3A%2242.500%22%2C%22currency%22%3A%22KWD%22%2C%22channel%22%3A%22MOBILE%22%2C%22template%22%3A%22payment-receipt-v4%22%2C%22locale%22%3A%22en-GB%22%2C%22devic'.slice(0, 300), [['URL', '/partners/push/send'], ['Method', 'POST'], ['Request ID', 'req-4f1a09'], ['Response code', '202'], ['Duration (ms)', '61']], { truncated: true }),
    ],
    nearMissPreview: [
      pv('14:01:55.210', 'payments-api', 'INFO', 'Make webhook configuration reload requestId=req-4f1b80', [], { matched: 1, of: 5 }),
      pv('14:01:49.118', 'payments-api', 'WARN', 'Make webhook call to /partners/kyc/verify method=GET requestId=req-4f1b77 (queued, no response yet)', [], { matched: 3, of: 5 }),
      pv('14:01:30.640', 'accounts-api', 'INFO', 'Webhook call to /partners/kyc/verify returned responseCode=409 duration=90ms', [], { matched: 2, of: 5 }),
    ],
    reviewNote: 'Review these matches for false positives. Counts describe this bounded sample only, not the whole source.',
  };
  // The server reports every extraction on every matched event, including values that were not found.
  TEST.matchedPreview.forEach((p) => p.extracted.push(['Request body', p.at === '14:02:11.884' ? '[REDACTED]' : null]));

  // ------------------------------------------------------------------ import previews
  const item = (index, id, name, tags, status, o = {}) => Object.assign({ index, id, name, tags, status, existingName: null, errors: [] }, o);
  const IMPORTS = {
    clean: { file: 'payments-team-rules.json', pack: { name: 'Payments team rules', version: 3, exportedAt: '2026-09-12' }, rulesInPack: 2, newRules: 2, identical: 0, conflicts: 0, invalid: 0,
      items: [item(0, 'card-issuer-callback', 'Card issuer callback', ['external-api', 'issuer'], 'NEW'), item(1, 'mobile-login', 'Mobile login', ['mobile-call'], 'NEW')] },
    conflicts: { file: 'shared-integration-rules.json', pack: { name: 'Shared integration rules', version: 7, exportedAt: '2026-09-14' }, rulesInPack: 5, newRules: 1, identical: 3, conflicts: 1, invalid: 0,
      items: [item(0, 'middleware-http-call', 'Middleware HTTP call', ['middleware', 'external-api'], 'IDENTICAL'), item(1, 'acquirer-partner-call', 'Acquirer partner call', ['external-api', 'partner', 'pci'], 'CONFLICT', { existingName: 'Acquirer partner call' }), item(2, 'gateway-http-response', 'Gateway HTTP response', ['gateway-response'], 'IDENTICAL'), item(3, 'slow-ledger-reservation', 'Slow ledger reservation', ['database-call'], 'IDENTICAL'), item(4, 'card-issuer-callback', 'Card issuer callback', ['external-api', 'issuer'], 'NEW')] },
    invalid: { file: 'partner-rules-draft.json', pack: { name: 'Partner rules (draft)', version: 1, exportedAt: '2026-09-15' }, rulesInPack: 3, newRules: 1, identical: 1, conflicts: 0, invalid: 1,
      items: [item(0, 'middleware-http-call', 'Middleware HTTP call', ['middleware', 'external-api'], 'IDENTICAL'), item(1, 'card-issuer-callback', 'Card issuer callback', ['external-api', 'issuer'], 'NEW'), item(2, 'lookahead-partner', 'Lookahead partner rule', ['partner'], 'INVALID', { errors: [{ path: 'rules[2].conditions[0].value', message: 'Invalid or unsupported regular expression: invalid or unsupported Perl syntax' }] })] },
  };

  D.CLS = { RULES, TAGS, tags: TAGS, W1, W2, W3, NEAR, LONG, clsResults, tagFiltered, DETECT, NO_SAFE, TEST, IMPORTS, REVISION: 13, STORAGE_FILE: 'classification-rules.json', RUNTIME: { eventsEvaluated: 4812, ruleMatches: 1207, evaluationFailures: 0 } };
})();

window.LX_EXT = function (api) {
  'use strict';
  const { D, I, esc, sev, page, queryBar, scopeStrip, searchChrome, resultsTable, results, inspector, compactScope, settingsNav, filtersPanel, capture, live, highlightJson, LOAD_MORE } = api;
  const C = D.CLS;
  const fmt = (x) => Number(x).toLocaleString('en-US');

  // ------------------------------------------------------------------ shared primitives (DESIGN_SYSTEM §21)
  const tagChip = (t, lg) => `<span class="tag-chip${lg ? ' lg' : ''}">${I('tag', 'ic-xs')}<span class="t">${esc(t)}</span></span>`;
  const tagList = (tags, lg, label = 'Tags') => `<ul class="tag-list" aria-label="${label}">${tags.map((t) => `<li>${tagChip(t, lg)}</li>`).join('')}</ul>`;
  const tagFilterChip = (t) => `<span class="chip is-tag">${I('tag')}Tag <b>${esc(t)}</b><button class="x" aria-label="Remove tag filter ${esc(t)}">${I('x')}</button></span>`;
  const MATCHER = { EXACT: 'is', CONTAINS: 'contains', STARTS_WITH: 'starts with', REGEX: 'matches pattern' };
  const FIELD = { message: 'Message', service: 'Service', logger: 'Logger' };
  const fieldName = (f) => FIELD[f] || f;
  const banner = (kind, icon, text, act) => `<div class="ws-banner is-${kind}" role="${kind === 'danger' ? 'alert' : 'status'}">${I(icon)}<div class="txt">${text}</div>${act ? `<div class="act">${act}</div>` : ''}</div>`;
  const sw = (on, name) => `<button class="switch" role="switch" aria-checked="${on}" aria-label="Enabled: ${esc(name)}"><span class="track"></span><span class="word">${on ? 'On' : 'Off'}</span></button>`;
  const box = (on, label) => `<span class="box${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" aria-label="${esc(label)}">${on ? I('check') : ''}</span>`;

  // ------------------------------------------------------------------ Inspector: generic classification section
  function xvalue(x, o = {}) {
    // The server sets redacted=true whenever redaction changed a value. Only a value that is exactly [REDACTED] is a
    // token; a partly redacted or policy-masked value is shown as served, with a note and no copy action.
    if (x.status === 'ABSENT') return `<span class="xv-missing">—</span><span class="xv-state">Not found in this event</span>`;
    if (x.status === 'INVALID') return `<span class="xv-missing">—</span><span class="xv-state">${I('circle-alert')}Could not be read</span>`;
    if (x.redacted && x.value === '[REDACTED]') return `<span class="xv-redacted">${I('shield')}[REDACTED]</span><span class="xv-state">Redacted by the server; nothing to show or copy</span>`;
    const redactedNote = x.redacted ? `<span class="xv-state">${I('shield')}Redacted by the server where required</span>` : '';
    const copy = x.redacted ? '' : `<button class="btn btn-ghost btn-sm btn-icon" aria-label="Copy ${esc(x.label || x.name)}">${I('copy', 'ic-sm')}</button>`;
    if (x.json) {
      const lines = x.value.split('\n').length;
      return `<div class="xv-row"><div class="xv-main"><details class="disclosure"${o.open ? ' open' : ''}><summary>${I('chevron-right')}JSON · ${lines} lines<span class="aside">formatted for reading</span></summary><div class="body"><pre class="code" tabindex="0" style="max-height:220px" aria-label="${esc(x.label)} JSON">${highlightJson(x.value)}</pre></div></details>${redactedNote}</div>${copy}</div>`;
    }
    const main = `<span class="xv${x.long && !o.expanded ? ' xv-clamp' : ''}">${esc(x.value)}</span>`;
    const extra = [x.long ? `<button class="xv-more" aria-expanded="${!!o.expanded}">${o.expanded ? 'Show less' : 'Show more'}</button>` : '', x.truncated ? `<span class="xv-state">${I('info')}Shortened by the server to 2,000 characters</span>` : '', redactedNote].join('');
    return `<div class="xv-row"><div class="xv-main">${main}${extra}</div>${copy}</div>`;
  }
  function classificationSection(e, o = {}) {
    const cls = e.classifications || [];
    const s = cls.length === 1 ? '' : 's';
    return `<div class="sec" role="region" aria-labelledby="cls-h"${o.scroll ? ' data-scroll-to' : ''}>
      <h2 class="sec-h" id="cls-h">Classification<span class="aside">${cls.length} rule${s} matched</span></h2>
      ${tagList(e.tags, true, 'Tags on this event')}
      ${cls.map((c) => `<div class="cls-rule">
        <div class="cls-rule-head"><h3 class="cls-rule-name" style="margin:0">${esc(c.ruleName)}</h3><span class="cls-rule-tags">adds ${c.tags.map(esc).join(', ')}</span><button class="btn btn-ghost btn-sm" aria-label="Open rule ${esc(c.ruleName)} in Settings">${I('pencil-line', 'ic-sm')}Rule</button></div>
        ${c.extracted.length ? `<dl class="kv xkv">${c.extracted.map((x) => `<dt>${esc(x.label || x.name)}</dt><dd>${xvalue(x, o)}</dd>`).join('')}</dl>` : '<p class="help" style="margin:0">This rule extracts no fields.</p>'}
      </div>`).join('')}
      <p class="note cls-foot">${I('info')}<span>Applied by the server when this event was read. Extracted values pass the same masking and redaction as every other field.</span></p>
    </div>`;
  }

  window.LX_CLASSIFICATION_SECTION = classificationSection;

  // ------------------------------------------------------------------ Search states
  const clsTable = (list, o = {}) => resultsTable(list, Object.assign({ tagsCol: true }, o));
  const idx = (e) => C.clsResults.indexOf(e);
  function tagTip(e, list) {
    const i = list.indexOf(e);
    return `<div class="tip" role="tooltip" id="tip-tags" style="top:${30 + (i + 1) * 28 + 2}px;right:330px">All tags on this event${tagList(e.tags, false)}</div>`;
  }
  const tagReadout = (n) => `<strong>${n}</strong> tagged events<span class="sep">·</span>among the events this search read`;
  const tagFootnote = (n) => `<div class="load-more"><span>${I('info', 'ic-sm')}</span><span><strong style="color:var(--ink-1)">${n}</strong> events carry a selected tag. Tags are applied after the source returns events, so the filter never reads more history than an untagged search.</span><button class="btn btn-secondary btn-sm">${I('chevron-down', 'ic-sm')}Load more</button></div>`;

  // ------------------------------------------------------------------ Settings › Classification rules
  function conditionText(r) {
    const c = r.conditions[0];
    const more = r.conditions.length - 1;
    return `<span class="matcher">${fieldName(c.field)} ${MATCHER[c.matcher]} <span class="q">“${esc(c.value)}”</span>${more ? `<span class="more">+${more} more condition${more > 1 ? 's' : ''} · ${r.matchMode === 'ALL' ? 'all must match' : 'any may match'}</span>` : ''}</span>`;
  }
  function rulesContent(o = {}) {
    const rules = o.empty ? [] : (o.rules || C.RULES);
    const sel = o.selected || [];
    const rt = o.empty ? { eventsEvaluated: 0, ruleMatches: 0, evaluationFailures: 0 } : C.RUNTIME;
    // The server sends revision 0 with an INVALID configuration (RulesDocument.empty()), so the invalid state draws 0.
    const rev = o.revision != null ? o.revision : C.REVISION;
    const meta = `<div class="ws-meta"><span>Revision ${rev}</span><span>${o.invalid ? `Rules file on the Log Explorer server: <span class="mono">${C.STORAGE_FILE}</span> — could not be read` : `Saved on the Log Explorer server as <span class="mono">${C.STORAGE_FILE}</span>`}</span><span class="num">Since the server started: ${fmt(rt.eventsEvaluated)} events evaluated · ${fmt(rt.ruleMatches)} rule matches · ${rt.evaluationFailures} evaluation failures</span></div>`;
    const toolbar = `<div class="ws-toolbar">
      <label class="search-input">${I('search', 'ic-sm')}<span class="vh">Filter rules by name or tag</span><input placeholder="Filter by name or tag"${o.empty ? ' disabled' : ''}></label>
      <div class="push">
        <button class="btn btn-secondary">${I('upload')}Import rule pack…</button>
        <button class="btn btn-secondary"${rules.length ? '' : ' disabled'}>${I('download')}Export all</button>
        <button class="btn btn-secondary"${sel.length ? '' : ' disabled'}>${I('download')}Export selected${sel.length ? ` (${sel.length})` : ''}</button>
        <button class="btn btn-primary">${I('plus')}New rule</button>
      </div></div>`;
    const exportNote = `<p class="help-row">${I('lock')}Rule packs contain rule definitions only — never log events, extracted values, credentials or server paths.</p>`;
    const banners = (o.banners || []).join('');
    if (!rules.length) {
      return `<h1>Classification rules</h1><p class="ws-sub">Rules add your own tags to events and pull out named values, such as a URL or a response code. The server applies saved rules to every event that Search, Investigation, Surroundings and Live read.</p>${meta}${banners}${toolbar}
      ${o.emptyPanel || `<div class="state-panel" role="status" style="max-width:760px;margin:0">${I('tags')}<div><h2>No classification rules yet</h2><p>The quickest start is a real event: run a search, open an event, and choose <strong>Create tag rule</strong>. Log Explorer suggests conditions from similar events, and nothing is saved until you choose Save.</p><div class="actions"><button class="btn btn-secondary">${I('search')}Go to search</button><button class="btn btn-ghost">${I('plus')}Write a rule yourself</button></div></div></div>`}`;
    }
    const rows = rules.map((r) => `<tr class="${r.enabled ? '' : 'is-disabled'}${sel.includes(r.id) ? ' is-selected' : ''}" aria-selected="${sel.includes(r.id)}">
      <td>${box(sel.includes(r.id), `Select ${r.name} for export`)}</td>
      <td><span class="rule-name">${esc(r.name)}</span>${r.description ? `<span class="rule-desc">${esc(r.description)}</span>` : ''}</td>
      <td><span class="tag-cell">${tagChip(r.tags[0])}${r.tags.length > 1 ? `<span class="tag-more" title="${esc(r.tags.join(', '))}">+${r.tags.length - 1}</span>` : ''}</span><span class="vh">Tags: ${esc(r.tags.join(', '))}</span></td>
      <td>${conditionText(r)}</td>
      <td class="num-cell">${r.extractions.length ? `${r.extractions.length} value${r.extractions.length > 1 ? 's' : ''}` : '<span class="empty-cell">None</span>'}</td>
      <td>${sw(r.enabled, r.name)}</td>
      <td class="c-act"><button class="btn btn-ghost btn-sm" aria-label="Test ${esc(r.name)}">${I('flask-conical', 'ic-sm')}Test</button><button class="btn btn-ghost btn-sm" aria-label="Edit ${esc(r.name)}">${I('pencil', 'ic-sm')}Edit</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="More actions for ${esc(r.name)}: Duplicate, Export, Delete" aria-haspopup="menu" aria-expanded="${!!o.menu && r.id === 'frontend-call'}">${I('ellipsis')}</button></td>
    </tr>`).join('');
    const cards = rules.map((r) => `<li class="${r.enabled ? '' : 'is-disabled'}">${box(sel.includes(r.id), `Select ${r.name} for export`)}
      <div class="rl-main"><span class="rule-name">${esc(r.name)}</span>${tagList(r.tags)}${conditionText(r)}<span class="rule-desc">${r.extractions.length} extracted value${r.extractions.length === 1 ? '' : 's'}</span></div>
      <div class="rl-side">${sw(r.enabled, r.name)}<button class="btn btn-ghost btn-sm btn-icon" aria-label="Actions for ${esc(r.name)}: Test, Edit, Duplicate, Export, Delete" aria-haspopup="menu" aria-expanded="${!!o.menu && r.id === 'frontend-call'}">${I('ellipsis')}</button></div></li>`).join('');
    return `<h1>Classification rules</h1><p class="ws-sub">Rules add your own tags to events and pull out named values, such as a URL or a response code. The server applies saved rules to every event that Search, Investigation, Surroundings and Live read.</p>${meta}${banners}${toolbar}
      <div class="rules-wrap" role="region" aria-label="Classification rules table" tabindex="0"><table class="grid rules" aria-label="Classification rules">
        <colgroup><col style="width:44px"><col style="width:236px"><col style="width:170px"><col><col style="width:96px"><col style="width:112px"><col style="width:186px"></colgroup>
        <thead><tr><th scope="col"><span class="vh">Select for export</span></th><th scope="col">Rule</th><th scope="col">Tags</th><th scope="col">Matches when</th><th scope="col">Extracts</th><th scope="col">Enabled</th><th scope="col"><span class="vh">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <ul class="rule-list" aria-label="Classification rules">${cards}</ul>${o.menu ? `<div class="menu-anchor">${o.menu}</div>` : ''}${exportNote}`;
  }
  function settingsColumn(content, o = {}) {
    return `<section class="column" aria-label="Settings"><div class="mode-bar"><button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to search results</button><h1>Settings</h1></div>
      <div class="settings">${settingsNav('classification', { rulesCount: o.empty ? '0' : String((o.rules || C.RULES).length) })}<div class="set-content wide">${content}</div></div>${o.dialog || ''}</section>`;
  }
  const rulesPage = (o = {}) => page({ shell: { trail: ['Settings', 'Classification rules'], active: 'settings' }, chrome: '', column: settingsColumn(rulesContent(o), o) });
  const deleteDialog = `<div class="dialog-scrim" aria-hidden="true"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-h" aria-describedby="dlg-b">
    <div class="d-head">${I('trash-2')}<h2 id="dlg-h">Delete “Frontend call”?</h2></div>
    <div class="d-body" id="dlg-b"><p>The rule is removed from the Log Explorer server, so it stops tagging events for everyone who uses this installation. Events already on screen keep their tags until the next search.</p><p>This cannot be undone. Export the rule first if you may need it again.</p></div>
    <div class="d-foot"><button class="btn btn-secondary">Cancel</button><button class="btn btn-danger">${I('trash-2', 'ic-sm')}Delete rule</button></div></div>`;

  const STATES = [];
  const add = (id, label, fn) => STATES.push([id, label, fn]);

  const W1 = C.W1, W3 = C.W3, LONG = C.LONG;
  const loadedReadout = (n) => `<strong>${n}</strong> loaded<span class="sep">·</span>more available<span class="extra"><span class="sep">·</span>total not reported by this source</span>`;
  const loadMoreN = (n) => `<div class="load-more"><span class="num"><strong style="color:var(--ink-1)">${n}</strong> events loaded · more available</span><button class="btn btn-secondary btn-sm">${I('chevron-down', 'ic-sm')}Load more</button></div>`;
  const clsInspector = (e, o = {}) => page({ shell: {}, chrome: searchChrome({}, { readout: loadedReadout(C.clsResults.length) }), column: results({ withInspector: true, table: resultsTable(C.clsResults, { selectedId: e.id, after: loadMoreN(C.clsResults.length) }) }), inspector: inspector(e, 'overview', { classification: classificationSection(e, Object.assign({ scroll: true }, o)), pos: `${idx(e) + 1} of ${C.clsResults.length} loaded` }) });

  add('40-source-list-loki-unavailable', 'Source list — Docker, OpenShift, OpenShift Loki (not available); approximation of the browser-drawn native select list', () => page({ shell: {}, chrome: queryBar({ sourceOpen: true }) + scopeStrip(), column: results() }));
  add('41-more-filters-tag-filter', 'More filters — Classification tags (any selected tag)', () => page({ shell: {}, chrome: queryBar({ moreOpen: true }) + scopeStrip(), overlay: filtersPanel({ tagsChecked: ['middleware', 'gateway-response'] }), column: results() }));
  add('42-results-tag-filter-tags-column', 'Tag filter applied + optional Tags column', () => page({ shell: {}, chrome: queryBar({ filterCount: 2 }) + scopeStrip({ chips: [tagFilterChip('middleware'), tagFilterChip('gateway-response')], readout: tagReadout(C.tagFiltered.length) }), column: results({ table: clsTable(C.tagFiltered, { after: tagFootnote(C.tagFiltered.length) }) }) }));
  add('43-results-multiple-tags', 'Results with tags — one tag + overflow count, full list on hover/focus', () => page({ shell: {}, chrome: searchChrome({}, { readout: loadedReadout(C.clsResults.length) }), column: results({ table: clsTable(C.clsResults, { after: loadMoreN(C.clsResults.length) }), menu: tagTip(W1, C.clsResults) }) }));
  add('44-inspector-one-classification', 'Inspector — one matching rule with extracted values', () => clsInspector(W3));
  add('45-inspector-multiple-classifications', 'Inspector — two rules, overlapping tags; masked, redacted, missing and unreadable values', () => clsInspector(W1));
  add('46-inspector-long-json-values', 'Inspector — JSON payload, long and server-shortened values', () => clsInspector(LONG, { open: true }));
  add('47-rules-empty', 'Settings › Classification rules — empty', () => rulesPage({ empty: true }));
  add('48-rules-populated', 'Settings › Classification rules — list with a disabled rule; one selected for export', () => rulesPage({ selected: ['middleware-http-call'] }));
  add('49-rules-delete-confirmation', 'Delete rule — destructive confirmation', () => rulesPage({ dialog: deleteDialog }));
  add('50-rules-saved', 'Rule saved — re-run Search to classify loaded results', () => rulesPage({ banners: [banner('success', 'circle-check', 'Rule <strong>“Middleware HTTP call”</strong> saved. It applies to new searches, investigations, surroundings and Live events. Results already on screen are unchanged until you search again.', `<button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Re-run search</button>`)] }));
  add('51-rules-revision-conflict', 'Rules changed elsewhere — reload before saving', () => rulesPage({ banners: [banner('danger', 'circle-alert', '<strong>These rules were changed elsewhere.</strong> Your change was not saved, so nothing was overwritten. Reload the latest rules, then make the change again.', `<button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Reload rules</button>`)] }));
  add('52-rules-recovered-from-backup', 'Configuration degraded — recovered from the last good copy', () => rulesPage({ banners: [banner('warning', 'triangle-alert', '<strong>Rules were recovered from the last good copy.</strong> The saved rules file could not be read, so the previous version is active. Search keeps working. The next save replaces the damaged file and keeps it aside.')] }));
  add('53-rules-invalid-config', 'Configuration invalid — classification off, search keeps working', () => rulesPage({ empty: true, invalid: true, revision: 0, banners: [banner('danger', 'file-x', '<strong>The saved rules file is invalid and no earlier copy could be loaded.</strong> Classification is off; search keeps working. Import a rule pack or save a rule to start a new file — the damaged file is kept aside, not overwritten.')], emptyPanel: `<div class="state-panel is-warning" role="status" style="max-width:760px;margin:0">${I('tags')}<div><h2>Classification is off</h2><p>No rules are active because the rules file could not be read. Events are still searched, inspected and streamed without tags.</p><div class="actions"><button class="btn btn-secondary">${I('upload')}Import rule pack…</button><button class="btn btn-ghost">${I('plus')}New rule</button></div></div></div>` }));

  // ------------------------------------------------------------------ Rule builder: create tag rule from event
  const STEPS = [['source', 'Source'], ['detect', 'Detect'], ['classification', 'Classification'], ['extraction', 'Extraction'], ['test', 'Test'], ['save', 'Save']];
  const DETECTED = C.DETECT;
  const condLine = (c, i, mode) => `<li class="cond"><span class="join">${i ? (mode === 'ALL' ? 'and' : 'or') : 'when'}</span><span class="tok">${fieldName(c.field)}</span><span class="tok op">${MATCHER[c.matcher]}</span><span class="tok val">“${esc(c.value)}”</span></li>`;
  const condList = (conds, mode) => `<ol class="cond-list" aria-label="Conditions">${conds.map((c, i) => condLine(c, i, mode)).join('')}</ol>`;
  const bar = (a, b) => `<span class="evidence"><span class="bar" aria-hidden="true"><span style="width:${Math.round((a / b) * 100)}%"></span></span><span class="num">${a} / ${b}</span></span>`;
  function rbRail(cur, st, edit) {
    return `<nav class="rb-rail" aria-label="Rule steps"><ol class="rb-steps">${STEPS.filter(([k]) => !edit || k !== 'source').map(([k, l], i) => { const x = st[k] || {}; return `<li><button class="rb-step${x.done ? ' done' : ''}"${k === cur ? ' aria-current="step"' : ''}><span class="n" aria-hidden="true">${x.done ? I('check') : i + 1}</span><span class="l">${l}${x.done ? '<span class="vh">, completed</span>' : ''}</span><span class="st">${esc(x.text || '')}</span></button></li>`; }).join('')}</ol><p class="rail-note">Every step stays reachable, in any order. Nothing is saved until Save rule.</p></nav>`;
  }
  function rbDraft(o) {
    const conds = o.conds ? `<ul class="draft-cond">${o.conds.map((c, i) => `<li>${i ? (o.mode === 'ALL' ? 'and ' : 'or ') : ''}${fieldName(c.field)} ${MATCHER[c.matcher]} <span class="mono">“${esc(c.value)}”</span></li>`).join('')}</ul>` : '<span class="empty-cell">No conditions yet</span>';
    return `<aside class="rb-draft" aria-label="Draft rule" tabindex="0">
      <h2 class="sec-h">Draft rule<span class="aside">not saved</span></h2>
      <dl class="kv"><dt>Name</dt><dd>${o.name ? esc(o.name) : '<span class="empty-cell">Not named yet</span>'}</dd>
      <dt>Tags</dt><dd>${o.tags ? tagList(o.tags) : '<span class="empty-cell">None yet (required)</span>'}</dd>
      <dt>Matches when</dt><dd>${conds}</dd>
      <dt>Extracts</dt><dd>${o.x || '<span class="empty-cell">Nothing yet</span>'}</dd></dl>
      <h2 class="sec-h">Tested</h2><p class="draft-state">${I(o.tested ? 'flask-conical' : 'circle-dashed')}${o.tested || 'Not tested yet. Testing is recommended before saving.'}</p>
      <h2 class="sec-h">Sample scope</h2><dl class="kv"><dt>Source</dt><dd>Local Docker · payments-stack</dd><dt>Time</dt><dd>Last 1 day</dd><dt>Services</dt><dd>All except 2</dd><dt>Severity</dt><dd>Info, Warn, Error</dd></dl>
      <p class="help">Detect and Test read up to 200 events from the current search scope. Change it with Edit search.</p></aside>`;
  }
  const compactDraft = (o) => `<div class="rb-compact-draft" role="note" aria-label="Draft rule summary"><span>Draft <b>${o.name ? esc(o.name) : 'not named yet'}</b></span><span>Tags <b>${o.tags ? o.tags.join(', ') : 'none yet'}</b></span><span>Conditions <b>${o.conds ? o.conds.length : 0}</b></span><span>Extracts <b>${o.xCount || 0}</b></span><span>${o.tested ? esc(o.tested) : 'Not tested'}</span></div>`;
  const rbNav = (prev, next, o = {}) => `<div class="rb-nav"><button class="btn btn-ghost">Cancel</button><div class="push">${prev ? `<button class="btn btn-secondary">${I('arrow-left', 'ic-sm')}${prev}</button>` : ''}${next ? `<button class="btn ${o.nextPrimary ? 'btn-primary' : 'btn-secondary'}">${next}${I('arrow-right', 'ic-sm')}</button>` : ''}</div></div>`;
  function rbPage(step, content, o = {}) {
    const steps = o.edit ? STEPS.filter(([k]) => k !== 'source') : STEPS;
    const i = steps.findIndex(([k]) => k === step);
    const draft = o.draft || {};
    const e = C.W1;
    const col = `<section class="column rb" aria-label="Create tag rule from event">
      ${o.newRule
        ? `<div class="mode-bar"><button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to rules</button><h1>New rule</h1><div class="right"><button class="btn btn-ghost btn-sm">Cancel</button></div></div>
      <div class="rb-anchor">${I('plus', 'ic-sm')}<span class="k">New rule</span><span class="msg">There is no source event, so Detect needs a pasted sample value.</span></div>`
        : o.edit
        ? `<div class="mode-bar"><button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to rules</button><h1>Edit rule<span class="val" style="font-family:var(--font-ui);font-weight:400;color:var(--ink-2)">Middleware HTTP call</span></h1><div class="right"><button class="btn btn-ghost btn-sm">Cancel</button></div></div>
      <div class="rb-anchor">${I('pencil-line', 'ic-sm')}<span class="k">Editing a saved rule</span><span class="msg">Revision ${C.REVISION}. There is no source event, so Detect needs a pasted sample value.</span></div>`
        : `<div class="mode-bar"><button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to event</button><h1>Create tag rule</h1><div class="right"><button class="btn btn-ghost btn-sm">Cancel</button></div></div>
      <div class="rb-anchor">${I('crosshair', 'trigger-mark')}<span class="k">From event</span><span class="lvl-badge">${sev(e.level)}<span class="lvl lvl-${e.level}">${e.level}</span></span><span class="when">15 Sep ${e.clock}</span><span>${esc(e.service)}</span><span class="msg">${esc(e.message)}</span></div>`}
      <div class="rb-body">${rbRail(step, o.status || {}, o.edit)}
        <div class="rb-main" role="region" aria-label="Step ${i + 1} of ${steps.length}, ${steps[i][1]}" tabindex="0">${o.progress ? `<div class="progress-line" role="progressbar" aria-label="${esc(o.progress)}"></div>` : ''}
          ${compactDraft(draft)}
          <h2 class="rb-h">${steps[i][1]}</h2><p class="rb-sub">${o.sub || ''}</p>
          ${content}
          ${o.nav || ''}
        </div>
        ${rbDraft(draft)}
      </div></section>`;
    return page({ shell: o.edit ? { trail: ['Settings', 'Classification rules', o.newRule ? 'New rule' : 'Edit rule'], active: 'settings' } : { trail: ['Search', 'Create tag rule'] }, chrome: compactScope('Detect and Test sample this search scope', { services: 'All except 2' }), column: col });
  }
  const panel = (title, body, o = {}) => `<div class="panel${o.cls ? ' ' + o.cls : ''}"><div class="panel-head"><${o.h || 'h3'}>${title}</${o.h || 'h3'}>${o.tag || ''}${o.right ? `<span class="right">${o.right}</span>` : ''}</div>${o.flush ? body : `<div class="panel-body">${body}</div>`}${o.foot ? `<div class="panel-foot">${o.foot}</div>` : ''}</div>`;

  const ST = {
    source: { done: true, text: 'Message' },
    detect: { done: true, text: '17 similar of 200 read' },
    classification: { done: true, text: '2 tags · 5 conditions' },
    extraction: { done: true, text: '6 values' },
    test: { done: true, text: '17 of 200 matched' },
  };
  const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, ST[k]]));
  const DRAFT_EMPTY = {};
  const DRAFT_SUGGESTED = { conds: DETECTED.conditions, mode: 'ALL', x: '5 suggested values', xCount: 5 };
  const DRAFT_NAMED = { name: 'Middleware HTTP call', tags: ['middleware', 'external-api'], conds: DETECTED.conditions, mode: 'ALL', x: '5 suggested values', xCount: 5 };
  const DRAFT_X = Object.assign({}, DRAFT_NAMED, { x: '6 values (3 suggested, 3 confirmed)', xCount: 6 });
  const DRAFT_TESTED = Object.assign({}, DRAFT_X, { tested: '17 of 200 sampled events matched' });

  // Step 1 — source
  const sourceStep = () => rbPage('source', panel('Classify on this field', `<div class="form-stack">
      <label class="lbl-field">Field<select class="input"><option>Message</option><option>Service</option><option>Logger</option><option>Business step</option><option>Error code</option></select></label>
      <div class="lbl-field">Value on the selected event<div class="msg-block mono" style="font:var(--text-data)">${esc(C.W1.message)}</div></div>
      <p class="help-row" style="margin:0">${I('info')}Detect compares this value with similar events. Values that change between events, such as IDs, numbers, durations and URLs, are never copied into a rule as fixed text.</p></div>`),
    { sub: 'Choose which field of the selected event the rule should recognise. Message is chosen when the event has one.', status: {}, draft: DRAFT_EMPTY, nav: rbNav(null, 'Detect', { nextPrimary: true }) });

  // Step 2 — detect
  const detectIntro = (running) => panel('Detect a pattern from similar events', `<p style="margin:0 0 10px;color:var(--ink-2)">Log Explorer reads up to <strong style="color:var(--ink-1)">200 events</strong> from the current search scope and compares their <strong style="color:var(--ink-1)">Message</strong> with this event. The sample is read through the normal search path and compared deterministically; no AI service is involved. It only suggests; you review everything before saving.</p>
      <div class="editor-row" style="margin:0"><button class="btn btn-primary"${running ? ' disabled aria-busy="true"' : ''}>${running ? `${I('loader-circle', 'spin')}Detecting…` : `${I('scan-search')}Detect pattern`}</button><button class="btn btn-secondary"${running ? ' disabled' : ''}>${I('pencil')}Write conditions manually</button></div>`);
  const detectInitial = () => rbPage('detect', detectIntro(false), { sub: 'Find the fixed structure this event shares with similar events.', status: pick('source'), draft: DRAFT_EMPTY, nav: rbNav('Source', 'Classification') });
  const detecting = () => rbPage('detect', detectIntro(true) + panel('Observed in this sample', `<p role="status" style="margin:0 0 12px;color:var(--ink-2)">Reading up to 200 events from Local Docker · payments-stack · last 1 day…</p><div class="stat-row" aria-hidden="true">${['Read', 'With a message', 'Similar to this event'].map((k) => `<span class="stat"><span class="k">${k}</span><span class="skel-line" style="width:48px;display:inline-block"></span></span>`).join('')}</div><span class="skel-line" style="width:92%;margin-top:14px;height:26px"></span>`, { cls: 'is-evidence' }),
    { sub: 'Find the fixed structure this event shares with similar events.', status: pick('source'), draft: DRAFT_EMPTY, progress: 'Detecting a pattern', nav: rbNav('Source', 'Classification') });
  function evidencePanel() {
    const d = DETECTED;
    const segs = d.segments.map(([kind, v, name, k]) => `<span class="seg ${kind}"><span class="v">${esc(v)}</span><span class="cap">${kind === 'var' ? `${esc(name)} · ${k.toLowerCase()}` : 'fixed'}</span></span>`).join('');
    const vars = d.variables.map(([name, kind, a]) => `<tr><td class="mono">${name}</td><td>${kind}</td><td class="mono">${esc(a)}</td></tr>`).join('');
    return panel('Observed in this sample', `<div class="stat-row"><span class="stat"><span class="k">Read</span><span class="v">${d.sampledEvents}</span></span><span class="stat"><span class="k">With a message</span><span class="v">${d.valuesWithField}</span></span><span class="stat"><span class="k">Similar to this event</span><span class="v">${d.similarEvents}</span></span></div>
      <h4 class="sec-h" style="margin:14px 0 6px">Structure of this event's message</h4>
      <div class="decode" role="img" aria-label="Fixed text: Make webhook call to, method=, requestId=, responseCode=, duration=. Changing parts: url, method, requestId, responseCode, duration.">${segs}</div>
      <p class="decode-legend"><span><span class="sw fixed" aria-hidden="true"></span>Fixed text across similar events</span><span><span class="sw var" aria-hidden="true"></span>Changes between similar events</span></p>
      <h4 class="sec-h" style="margin:14px 0 6px">Changing parts</h4>
      <table class="grid mini" aria-label="Changing parts"><colgroup><col style="width:180px"><col style="width:140px"><col></colgroup><thead><tr><th scope="col">Part</th><th scope="col">Kind</th><th scope="col">Example from this event</th></tr></thead><tbody>${vars}</tbody></table>`,
    { cls: 'is-evidence reveal', tag: `<span class="tag tag-evidence">Measured</span>` });
  }
  function suggestionPanel(applied) {
    const d = DETECTED;
    const xs = d.suggestedExtractions.map(([l, a, b]) => `<tr><td>${l}</td><td>${bar(a, b)}</td></tr>`).join('');
    return panel('Suggested rule', `${condList(d.conditions, d.matchMode)}
      <p class="measure">On this sample it matches <strong>${d.coverage.matchedSimilar} of ${d.coverage.similar}</strong> similar events and <strong>${d.coverage.matchedOther} of ${d.coverage.other}</strong> other events that were read.</p>
      <h4 class="sec-h" style="margin:14px 0 6px">Suggested values to extract</h4>
      <table class="grid mini cov" aria-label="Suggested values to extract"><colgroup><col style="width:180px"><col></colgroup><thead><tr><th scope="col">Value</th><th scope="col">Extracted from similar events</th></tr></thead><tbody>${xs}</tbody></table>
      ${d.warnings.map((w) => `<p class="help-row">${I('info')}${esc(w)}</p>`).join('')}`,
    { cls: 'is-suggestion reveal', tag: `<span class="tag tag-suggestion">Suggestion · not saved</span>`,
      foot: applied ? `<span class="note" role="status">${I('circle-check')}Copied into the draft. Nothing is saved yet; review it in the next steps.</span><button class="btn btn-secondary">${I('pencil')}Edit conditions</button>`
        : `<span class="note">${I('info')}Measured on this sample only. Test the rule before saving.</span><button class="btn btn-secondary">${I('pencil')}Write conditions manually</button><button class="btn btn-primary">${I('check')}Use this suggestion</button>` });
  }
  const detected = () => rbPage('detect', evidencePanel() + suggestionPanel(false), { sub: 'What Log Explorer observed in the sample, and the rule it would suggest from that evidence.', status: pick('source'), draft: DRAFT_EMPTY, nav: rbNav('Source', 'Classification') });
  const noSafe = () => rbPage('detect', detectIntro(false) + `<div class="state-panel is-warning reveal" role="status" style="margin:12px 0 0;max-width:none">${I('triangle-alert')}<div>
      <h2>No safe pattern could be suggested</h2>
      <p><span class="vh">Reason from the server: </span>“${esc(C.NO_SAFE.reason)}”</p><p>Log Explorer does not guess from too little evidence.</p>
      <div class="stat-row" style="margin-top:10px"><span class="stat"><span class="k">Read</span><span class="v">200</span></span><span class="stat"><span class="k">With a message</span><span class="v">198</span></span><span class="stat"><span class="k">Similar to this event</span><span class="v">2</span></span></div>
      <div class="actions"><button class="btn btn-secondary">${I('pencil')}Write conditions manually</button><button class="btn btn-ghost">${I('clock')}Widen the time range</button><button class="btn btn-ghost">Cancel</button></div></div></div>`,
    { sub: 'Find the fixed structure this event shares with similar events.', status: pick('source'), draft: DRAFT_EMPTY, nav: rbNav('Source', 'Classification') });

  // Step 3 — classification
  function classificationStep(advanced, extra = {}) {
    const typedRegex = { field: 'message', matcher: 'REGEX', value: 'call to (?=/partners)' };
    const conds = advanced ? [...DETECTED.conditions, typedRegex] : DETECTED.conditions;
    const tokens = `<div class="tokens" role="group" aria-label="Tags">${['middleware', 'external-api'].map((t) => `<span class="tag-chip">${I('tag', 'ic-xs')}<span class="t">${t}</span><button class="x" aria-label="Remove tag ${t}">${I('x')}</button></span>`).join('')}<input aria-label="Add a tag" placeholder="Add a tag and press Enter"></div>`;
    const names = `<div class="form-stack">
      <label class="lbl-field">Rule name<input class="input" value="Middleware HTTP call"></label>
      <div class="lbl-field">Tags<span class="vh"> (required)</span>${tokens}<span class="help" style="margin:0">Lowercase letters, digits, dots, dashes and underscores. Up to 5 tags, 40 characters each.</span></div>
      <label class="lbl-field">Description (optional)<textarea class="input" rows="2">Outbound calls made through the integration middleware</textarea></label>
      <div class="switch-inline"><button class="switch" role="switch" aria-checked="true" aria-label="Enabled"><span class="track"></span><span class="word">Enabled</span></button><span class="help" style="margin:0">Applies to new searches once saved.</span></div></div>`;
    const matcher = (sel) => `<select class="input">${['Is exactly', 'Contains', 'Starts with', 'Regular expression (RE2)'].map((m) => `<option${m === sel ? ' selected' : ''}>${m}</option>`).join('')}</select>`;
    const condRow = (n, field, sel, value, o = {}) => `<fieldset class="cond-edit" style="border:0;border-top:var(--bw) solid var(--line-subtle);margin:0;padding:10px 0"><legend class="vh">Condition ${n}</legend>
      <div class="form-grid cond-grid"><label class="lbl-field">Field<input class="input" value="${field}"></label><label class="lbl-field">Matcher${matcher(sel)}</label><label class="lbl-field cg-value">Value<input class="input${o.mono ? ' mono' : ''}" value="${esc(value)}"></label><label class="confirm-row" style="height:30px;align-items:center">${box(false, 'Ignore case')}<span>Ignore case</span></label><button class="btn btn-ghost btn-icon" aria-label="Remove condition ${n}">${I('trash-2')}</button></div>
      ${o.help ? `<p class="help" style="margin:6px 0 0">${o.help}</p>` : ''}${o.error ? `<p class="inline-error" role="alert" style="margin:6px 0 0">${I('circle-alert', 'ic-sm')}${o.error}</p>` : ''}</fieldset>`;
    const matchBody = `${condList(conds, 'ALL')}
      <div class="editor-row" style="margin:10px 0 0"><span class="help" style="margin:0">Match</span><div class="segmented" role="group" aria-label="Match mode"><button aria-pressed="true">All conditions</button><button aria-pressed="false">Any condition</button></div></div>
      <details class="disclosure" style="margin-top:12px"${advanced ? ' open' : ''}><summary>${I('chevron-right')}Edit conditions (advanced)<span class="aside">fields, matchers, regular expressions</span></summary><div class="body">
        ${condRow(1, 'message', 'Starts with', 'Make webhook call to')}${condRow(2, 'message', 'Contains', 'method=')}${condRow(3, 'message', 'Contains', 'requestId=')}${condRow(4, 'message', 'Contains', 'responseCode=')}${condRow(5, 'message', 'Contains', 'duration=')}
        ${advanced ? condRow(6, 'message', 'Regular expression (RE2)', 'call to (?=/partners)', { mono: true, help: 'RE2 syntax runs in linear time. Lookahead, lookbehind and backreferences are not supported. The server checks the expression when you test or save.', error: 'Invalid or unsupported regular expression: invalid or unsupported Perl syntax' }) : ''}
        <div class="editor-row"><button class="btn btn-secondary btn-sm">${I('plus', 'ic-sm')}Add condition</button><span class="help" style="margin:0">Up to 10 conditions.</span></div></div></details>`;
    return rbPage('classification', panel('Name and tags', names) + panel('Matches when', matchBody, { tag: extra.edit ? '' : '<span class="tag tag-neutral">From the suggestion</span>' }),
      Object.assign({ sub: 'Name the rule and choose the tags it adds. The conditions come from the suggestion; edit them only if you need to.', status: pick('source', 'detect'), draft: advanced ? Object.assign({}, DRAFT_NAMED, { conds }) : DRAFT_NAMED, nav: rbNav('Detect', 'Extraction') }, extra));
  }

  // Step 4 — extraction
  function extractionStep() {
    const rows = [
      { label: 'URL', name: 'url', from: 'Message', how: 'Pattern (RE2)', type: 'Text', sens: false, st: 'confirmed', cov: [17, 17] },
      { label: 'Method', name: 'method', from: 'Message', how: 'Pattern (RE2)', type: 'Text', sens: false, st: 'suggested', cov: [17, 17] },
      { label: 'Request ID', name: 'requestId', from: 'Message', how: 'Pattern (RE2)', type: 'Text', sens: false, st: 'suggested', cov: [17, 17] },
      { label: 'Response code', name: 'responseCode', from: 'Message', how: 'Pattern (RE2)', type: 'Integer', sens: false, st: 'confirmed', cov: [17, 17] },
      { label: 'Duration (ms)', name: 'durationMs', from: 'Message', how: 'Pattern (RE2)', type: 'Integer', sens: false, st: 'suggested', cov: [16, 17], editing: true },
      { label: 'Request body', name: 'requestBody', from: 'extra.request', how: 'JSON pointer', type: 'Text', sens: true, st: 'confirmed', cov: null, added: true },
    ];
    const status = (r) => r.st === 'suggested' ? `<span class="st-tag st-suggested">${I('circle-dashed')}Suggested</span>` : `<span class="st-tag st-confirmed">${I('circle-check')}Confirmed</span>`;
    const editorInner = `<div class="form-grid x-form">
        <label class="lbl-field">Output name<input class="input mono" value="durationMs"></label><label class="lbl-field">Label<input class="input" value="Duration (ms)"></label>
        <label class="lbl-field">From field<input class="input mono" value="message"></label><label class="lbl-field">Type<select class="input"><option>Text</option><option selected>Integer</option><option>Decimal</option><option>Boolean</option></select></label>
        <div class="lbl-field span-2">Method<div class="segmented" role="group" aria-label="Extraction method"><button aria-pressed="true">Pattern (RE2)</button><button aria-pressed="false">JSON pointer</button></div></div>
        <div class="lbl-field span-2">Sensitive<button class="switch" role="switch" aria-checked="false"><span class="track"></span><span class="word">Shown — turn on to never show this value</span></button></div>
        <label class="lbl-field span-2 advanced-field">Expression<input class="input mono" value="duration=(?P&lt;durationMs&gt;\\d+(?:\\.\\d+)?)ms"></label><label class="lbl-field advanced-field">Group (optional)<input class="input mono" value="durationMs"></label><span></span>
      </div><p class="help-row">${I('info')}Detect extracted this value from 16 of 17 similar events. A value that does not convert to an integer shows as “Could not be read”.</p>
      <div class="editor-row" style="margin:10px 0 0"><button class="btn btn-secondary btn-sm">${I('check', 'ic-sm')}Keep as edited</button><button class="btn btn-ghost btn-sm">Discard changes</button></div>`;
    const editor = `<tr class="editor"><td colspan="6">${editorInner}</td></tr>`;
    const trs = rows.map((r) => `<tr class="${r.editing ? 'is-editing' : ''}${r.added ? ' row-add' : ''}"><td>${status(r)}</td><td><span class="out">${r.label}</span><span class="out-key">${r.name} · ${r.type.toLowerCase()}</span></td><td class="how">${r.from === 'Message' ? 'Message' : `<span class="mono" style="font:var(--text-data)">${r.from}</span>`}<span class="adv">${r.how}</span></td><td>${r.sens ? `<span class="sens">${I('shield')}Never shown</span>` : '<span class="empty-cell">No</span>'}</td><td>${r.cov ? bar(r.cov[0], r.cov[1]) : '<span class="empty-cell">Test to measure</span>'}</td>
      <td class="c-act">${r.st === 'suggested' && !r.editing ? `<button class="btn btn-ghost btn-sm" aria-label="Keep ${r.label} as suggested">${I('check', 'ic-sm')}Keep</button>` : ''}<button class="btn btn-ghost btn-sm btn-icon" aria-label="Edit ${r.label}"${r.editing ? ' aria-expanded="true"' : ''}>${I('pencil', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Remove ${r.label}">${I('trash-2', 'ic-sm')}</button></td></tr>${r.editing ? editor : ''}`).join('');
    const cards = rows.map((r) => `<li class="${r.editing ? 'is-editing' : ''}"><div class="x-top">${status(r)}<span class="out">${r.label}</span><span class="x-act">${r.st === 'suggested' ? `<button class="btn btn-ghost btn-sm" aria-label="Keep ${r.label} as suggested">${I('check', 'ic-sm')}Keep</button>` : ''}<button class="btn btn-ghost btn-sm btn-icon" aria-label="Edit ${r.label}">${I('pencil', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Remove ${r.label}">${I('trash-2', 'ic-sm')}</button></span></div><div class="x-facts"><span>From ${r.from}</span><span>${r.how}</span><span>${r.type}</span>${r.sens ? '<span>Never shown</span>' : ''}</div>${r.cov ? bar(r.cov[0], r.cov[1]) : '<span class="help" style="margin:0">Test to measure coverage</span>'}${r.editing ? `<div class="x-edit" role="group" aria-label="Edit ${r.label}">${editorInner}</div>` : ''}</li>`).join('');
    const table = `<div class="x-wrap" role="region" aria-label="Extracted values" tabindex="0"><table class="grid xt" aria-label="Extracted values"><colgroup><col style="width:130px"><col style="width:168px"><col style="width:122px"><col style="width:112px"><col><col style="width:150px"></colgroup>
      <thead><tr><th scope="col">Status</th><th scope="col">Value</th><th scope="col">Read from</th><th scope="col">Sensitive</th><th scope="col">Coverage</th><th scope="col"><span class="vh">Actions</span></th></tr></thead><tbody>${trs}</tbody></table><ul class="x-list" aria-label="Extracted values">${cards}</ul></div>`;
    return rbPage('extraction', panel('Values to extract', table, { flush: true, right: '<span class="help" style="margin:0">6 of up to 20</span>', foot: `<button class="btn btn-secondary btn-sm">${I('plus', 'ic-sm')}Add value</button><button class="btn btn-secondary btn-sm">${I('flask-conical', 'ic-sm')}Preview values</button><span class="note" style="margin:0 0 0 auto">${I('info')}Suggested values come from Detect and stay exactly as suggested until you keep or edit them. Expressions appear only while editing.</span>` }),
      { sub: 'Optional. Choose which values the Inspector shows for events this rule tags. Values marked sensitive are redacted by the server and never shown.', status: pick('source', 'detect', 'classification'), draft: DRAFT_X, nav: rbNav('Classification', 'Test') });
  }

  // Step 5 — test
  const testIntro = (running) => panel('Test the draft rule', `<p style="margin:0 0 10px;color:var(--ink-2)">Runs the draft against a fresh bounded sample of up to 200 events from the current search scope. The rule is not saved or activated.</p><div class="editor-row" style="margin:0"><button class="btn ${running ? 'btn-primary' : 'btn-secondary'}"${running ? ' disabled aria-busy="true"' : ''}>${running ? `${I('loader-circle', 'spin')}Testing…` : `${I('rotate-cw')}Test again`}</button></div>`);
  const testing = () => rbPage('test', testIntro(true) + panel('Result on this sample', `<p role="status" style="margin:0 0 12px;color:var(--ink-2)">Testing against up to 200 events from Local Docker · payments-stack · last 1 day…</p><div class="stat-row" aria-hidden="true">${['Read', 'Matched', 'Not matched'].map((k) => `<span class="stat"><span class="k">${k}</span><span class="skel-line" style="width:44px;display:inline-block"></span></span>`).join('')}</div>`),
    { sub: 'Check what the draft actually matches before you save it.', status: pick('source', 'detect', 'classification', 'extraction'), draft: DRAFT_X, progress: 'Testing the rule', nav: rbNav('Extraction', 'Save') });
  function testResults(tab) {
    const t = C.TEST;
    const cov = t.coverage.map(([l, a, inv, of]) => `<tr><td>${l}</td><td>${bar(a, of)}${inv ? `<span class="xv-state">${I('circle-alert')}${inv} could not be read</span>` : ''}</td></tr>`).join('');
    const sample = (s, near) => `<li class="sample"><div class="meta"><span class="mono">15 Sep ${s.at}</span><span>${s.service}</span><span class="lvl lvl-${s.level}">${s.level}</span>${near ? `<span class="tag tag-partial">Matched ${s.matched} of ${s.of} conditions</span>` : ''}${s.truncated ? '<span>message value shortened by the server</span>' : ''}</div><div class="val">${esc(s.value)}</div>${s.extracted.length ? `<div class="xchips">${s.extracted.map(([k, v]) => `<span class="xchip${v == null ? ' is-missing' : v === '[REDACTED]' ? ' is-redacted' : ''}">${k} <b>${v == null ? '—' : esc(v)}</b></span>`).join('')}</div>` : ''}</li>`;
    const list = tab === 'borderline' ? t.nearMissPreview : t.matchedPreview;
    const examples = `<div class="panel-body" style="padding-bottom:8px"><div class="segmented" role="group" aria-label="Examples"><button aria-pressed="${tab !== 'borderline'}">${I('check', 'ic-sm')}Matched · ${t.matchedPreview.length} of ${t.matched}</button><button aria-pressed="${tab === 'borderline'}">${I('split', 'ic-sm')}Borderline · ${t.nearMissPreview.length}</button></div>
      <p class="help" style="margin:8px 0 0">${tab === 'borderline' ? 'Borderline events met some conditions but not all. Check whether any of them should match (the rule may be too narrow). Values are extracted only for matched events.' : 'Up to 5 matched examples. Values that were not found show “—”.'}</p></div>
      <ul class="sample-list">${list.map((s) => sample(s, tab === 'borderline')).join('')}</ul>
      <div class="review" role="note">${I('list-checks')}<span><strong>${esc(t.reviewNote.split('.')[0])}.</strong>${esc(t.reviewNote.slice(t.reviewNote.indexOf('.') + 1))}</span></div>`;
    const summary = panel('Result on this sample', `<div class="stat-row"><span class="stat"><span class="k">Read</span><span class="v">${t.sampledEvents}</span></span><span class="stat"><span class="k">Matched</span><span class="v">${t.matched}</span></span><span class="stat"><span class="k">Not matched</span><span class="v">${t.notMatched}</span></span></div>
      <p class="help-row">${I('info')}Sample limit reached: only the newest ${t.sampledEvents} events in the scope were read. Non-matching events are counted, not listed.</p>
      <h4 class="sec-h" style="margin:14px 0 6px">Extraction coverage</h4><table class="grid mini cov" aria-label="Extraction coverage among matched events"><colgroup><col style="width:120px"><col></colgroup><thead><tr><th scope="col">Value</th><th scope="col">Extracted from matched</th></tr></thead><tbody>${cov}</tbody></table>`, { cls: 'reveal' });
    return rbPage('test', testIntro(false) + `<div class="test-grid" style="margin-top:12px"><div class="panel reveal" style="margin:0"><div class="panel-head"><h3>Examples</h3></div>${examples}</div>${summary.replace('class="panel reveal"', 'class="panel reveal" style="margin:0"')}</div>`,
      { sub: 'Check what the draft actually matches before you save it.', status: pick('source', 'detect', 'classification', 'extraction'), draft: DRAFT_TESTED, nav: rbNav('Extraction', 'Save', { nextPrimary: true }) });
  }

  // Step 6 — save (revision conflict)
  const saveConflict = () => rbPage('save', banner('danger', 'circle-alert', '<strong>These rules were changed elsewhere since this editor opened.</strong> Nothing was saved and nothing was overwritten. Your draft is kept: reload the latest rules, then save again.', `<button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Reload rules</button>`)
    + panel('Review and save', `<dl class="kv" style="grid-template-columns:140px minmax(0,1fr)"><dt>Name</dt><dd>Middleware HTTP call</dd><dt>Tags</dt><dd>${tagList(['middleware', 'external-api'])}</dd><dt>Matches when</dt><dd>${condList(DETECTED.conditions, 'ALL')}</dd><dt>Extracts</dt><dd>6 values · Request body is sensitive and never shown</dd><dt>Enabled</dt><dd>Yes</dd><dt>Tested</dt><dd>17 of 200 sampled events matched</dd></dl>
      <p class="help-row">${I('info')}Once saved, the rule applies to new searches, investigations, surroundings and Live events. Results already on screen are not reclassified.</p>`, { foot: `<button class="btn btn-primary" style="margin-left:auto">${I('check')}Save rule</button>` }),
    { sub: 'Review the draft, then save it to the Log Explorer server.', status: pick('source', 'detect', 'classification', 'extraction', 'test'), draft: DRAFT_TESTED, nav: rbNav('Test', null) });

  add('54-rule-source', 'Create tag rule — 1 Source (field and value from the selected event)', sourceStep);
  add('55-rule-detect-initial', 'Create tag rule — 2 Detect, before running', detectInitial);
  add('56-rule-detecting', 'Create tag rule — Detect running (bounded sample)', detecting);
  add('57-rule-detected', 'Create tag rule — Observed evidence vs Suggested rule', detected);
  add('58-rule-no-safe-pattern', 'Create tag rule — No safe pattern could be suggested', noSafe);
  add('59-rule-classification', 'Create tag rule — 3 Classification (name, tags, plain-language conditions)', () => classificationStep(false));
  add('60-rule-conditions-advanced', 'Create tag rule — advanced condition editing (regular expressions)', () => classificationStep(true));
  add('61-rule-extraction', 'Create tag rule — 4 Extraction (suggested vs confirmed, one value being edited)', extractionStep);
  add('62-rule-testing', 'Create tag rule — Test running', testing);
  add('63-rule-test-results', 'Create tag rule — 5 Test results (matched, coverage, review note)', () => testResults('matched'));
  add('64-rule-test-borderline', 'Create tag rule — Test results, borderline examples', () => testResults('borderline'));
  add('65-rule-save-conflict', 'Create tag rule — 6 Save blocked by a revision conflict, draft kept', saveConflict);

  // ------------------------------------------------------------------ Import rule pack (select → validate → preview → apply)
  const STATUS = { NEW: ['is-new', 'circle-plus', 'New'], IDENTICAL: ['is-identical', 'equal', 'Identical'], CONFLICT: ['is-conflict', 'triangle-alert', 'Conflict'], INVALID: ['is-invalid', 'circle-x', 'Invalid'] };
  const impStatus = (st) => `<span class="imp-status ${STATUS[st][0]}">${I(STATUS[st][1])}${STATUS[st][2]}</span>`;
  const countTag = (st, n, label) => `<span class="count-tag ${STATUS[st] ? STATUS[st][0] : ''}${n ? '' : ' zero'}">${STATUS[st] ? I(STATUS[st][1]) : I('file-json')}${label} <b>${n}</b></span>`;
  function importProcess(cur) {
    const steps = ['Choose file', 'Validate', 'Preview', 'Apply'];
    const ci = steps.indexOf(cur);
    return `<div class="process" aria-label="Import steps">${steps.map((l, i) => `<span class="step${i < ci ? ' done' : i === ci ? ' current' : ''}"><span class="n">${i < ci ? I('check') : i + 1}</span>${l}${i < ci ? '<span class="vh">, completed</span>' : ''}</span>${i < steps.length - 1 ? '<span class="step-line"></span>' : ''}`).join('')}</div>`;
  }
  function effectText(it, o) {
    if (it.status === 'NEW') return 'Will be added';
    if (it.status === 'IDENTICAL') return 'Already present; stays unchanged';
    if (it.status === 'INVALID') return 'Blocks the import';
    if (o.mode === 'REPLACE_ALL') return 'Imported version replaces the existing rule';
    return o.resolution === 'USE_IMPORTED' ? 'Imported version replaces the existing rule' : o.resolution === 'KEEP_EXISTING' ? 'Existing rule is kept' : '<strong style="color:var(--ink-1);font-weight:500">Needs your choice</strong>';
  }
  function importPreview(key, o = {}) {
    const pk = C.IMPORTS[key];
    const rows = pk.items.map((it) => `<tr class="${it.status === 'INVALID' ? 'is-invalid-row' : ''}"><td>${impStatus(it.status)}</td><td><span class="rule-name">${esc(it.name)}</span><span class="out-key mono" style="display:block;font:400 12px/14px var(--font-mono);color:var(--ink-3)">${esc(it.id)}</span></td><td>${tagList(it.tags)}</td><td class="effect">${effectText(it, o)}</td></tr>
      ${it.status === 'CONFLICT' ? `<tr class="detail is-conflict-detail"><td colspan="4"><span class="help-row" style="margin:0">${I('info')}Same id as the existing rule “${esc(it.existingName)}”, with different content.</span></td></tr>` : ''}
      ${it.errors.length ? `<tr class="detail"><td colspan="4">${it.errors.map((e) => `<span class="imp-err">${I('circle-alert', 'ic-sm')}<span><code>${esc(e.path)}</code> ${esc(e.message)}</span></span>`).join('')}</td></tr>` : ''}`).join('');
    const cards = pk.items.map((it) => `<li><div class="top">${impStatus(it.status)}<span class="rule-name">${esc(it.name)}</span></div>${tagList(it.tags)}<span class="effect help" style="margin:0">${effectText(it, o)}</span>${it.errors.map((e) => `<span class="imp-err">${I('circle-alert', 'ic-sm')}<span><code>${esc(e.path)}</code> ${esc(e.message)}</span></span>`).join('')}</li>`).join('');
    const itemsPanel = panel('Rules in this pack', `<div class="imp-wrap" role="region" aria-label="Rules in this pack" tabindex="0"><table class="grid import" aria-label="Rules in this pack"><colgroup><col style="width:130px"><col style="width:280px"><col style="width:260px"><col></colgroup><thead><tr><th scope="col">Status</th><th scope="col">Rule</th><th scope="col">Tags</th><th scope="col">What applying does</th></tr></thead><tbody>${rows}</tbody></table><ul class="imp-list" aria-label="Rules in this pack">${cards}</ul></div>`, { flush: true, h: 'h2' });
    const mode = o.mode || 'MERGE';
    const modePanel = pk.invalid ? '' : panel('How to apply', `<div class="choice-grid" role="radiogroup" aria-label="Import mode">
        <div class="choice${mode === 'MERGE' ? ' on' : ''}"><span class="radio${mode === 'MERGE' ? ' on' : ''}" role="radio" aria-checked="${mode === 'MERGE'}" tabindex="${mode === 'MERGE' ? 0 : -1}" aria-labelledby="m1"></span><span class="t" id="m1">Merge</span><span class="d">Adds the new rules. Existing rules stay. Conflicts need your choice.</span></div>
        <div class="choice is-destructive${mode === 'REPLACE_ALL' ? ' on' : ''}"><span class="radio${mode === 'REPLACE_ALL' ? ' on' : ''}" role="radio" aria-checked="${mode === 'REPLACE_ALL'}" tabindex="${mode === 'REPLACE_ALL' ? 0 : -1}" aria-labelledby="m2"></span><span class="t" id="m2">Replace all rules</span><span class="d">Makes this pack the complete rule set. Rules that are not in the pack are deleted.</span></div></div>`, { h: 'h2' });
    const needsResolution = mode === 'MERGE' && pk.conflicts > 0;
    const resolutionPanel = needsResolution ? panel(`Conflicting rule (${pk.conflicts})`, `<div class="resolution" role="radiogroup" aria-label="How to handle conflicting rules" aria-required="true">
        <div class="radio-row"><span class="radio${o.resolution === 'KEEP_EXISTING' ? ' on' : ''}" role="radio" aria-checked="${o.resolution === 'KEEP_EXISTING'}" tabindex="0" aria-labelledby="r1"></span><span class="t" id="r1">Keep existing</span><span class="d">The rule on this server stays as it is; the imported version is skipped.</span></div>
        <div class="radio-row"><span class="radio${o.resolution === 'USE_IMPORTED' ? ' on' : ''}" role="radio" aria-checked="${o.resolution === 'USE_IMPORTED'}" tabindex="-1" aria-labelledby="r2"></span><span class="t" id="r2">Use imported</span><span class="d">The imported version replaces the rule on this server.</span></div></div>
        <p class="help-row">${I('info')}One choice applies to every conflicting rule in this pack. Conflicts are never overwritten silently.</p>`, { h: 'h2', tag: '<span class="tag tag-partial">Required</span>' }) : '';
    const removed = C.RULES.filter((r) => !pk.items.some((it) => it.id === r.id));
    const replacePanel = mode === 'REPLACE_ALL' ? `<div class="danger-zone" style="margin-top:12px" role="group" aria-labelledby="dz-h">
        <h2 id="dz-h">${I('triangle-alert')}Replace all rules deletes ${removed.length} existing rule${removed.length === 1 ? '' : 's'}</h2>
        <p style="margin:0;color:var(--ink-1)">These rules on this server are not in the pack and will be deleted for everyone who uses this installation:</p>
        <ul>${removed.map((r) => `<li><strong style="font-weight:600">${esc(r.name)}</strong> <span style="color:var(--ink-2)">(${r.tags.join(', ')})</span></li>`).join('')}</ul>
        <p style="margin:0;color:var(--ink-2)">The conflicting rule is replaced by its imported version. This cannot be undone; export all rules first to keep a copy.</p>
        <label class="confirm-row">${box(!!o.confirmed, 'I understand this deletes every existing rule that is not in this pack')}<span>I understand this deletes every existing rule that is not in this pack</span></label></div>` : '';
    const blockers = [];
    if (pk.invalid) blockers.push(`This pack contains ${pk.invalid} invalid rule, so it cannot be applied. Fix the file and import it again.`);
    if (needsResolution && !o.resolution) blockers.push('Choose how to handle the conflicting rule.');
    if (mode === 'REPLACE_ALL' && !o.confirmed) blockers.push('Confirm the deletion of rules that are not in this pack.');
    if (o.conflict) blockers.push('Reload the latest rules and preview the pack again.');
    const ready = !blockers.length;
    const applyBtn = mode === 'REPLACE_ALL'
      ? `<button class="btn btn-danger"${ready ? '' : ' disabled'} aria-describedby="imp-blockers">${I('trash-2', 'ic-sm')}Replace all rules</button>`
      : `<button class="btn btn-primary"${ready ? '' : ' disabled'} aria-describedby="imp-blockers">${I('check')}Apply import</button>`;
    const summary = ready ? `${I('circle-check', 'ic-sm')}Ready: ${pk.newRules} will be added${pk.identical ? `, ${pk.identical} stay unchanged` : ''}.` : '';
    const content = `<h1>Import rule pack</h1><p class="ws-sub">Nothing has been imported yet. Review what the pack would change, then apply it.</p>
      ${o.conflict ? banner('danger', 'circle-alert', '<strong>The rules on this server changed after this preview was made.</strong> Nothing was imported and nothing was overwritten. Reload the latest rules to preview this pack again.', `<button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Reload and preview again</button>`) : ''}
      ${importProcess('Preview')}
      <div class="ws-meta" style="margin:12px 0"><span>${I('file-json', 'ic-sm')} <span class="mono">${esc(pk.file)}</span></span><span>${esc(pk.pack.name)} · version ${pk.pack.version}</span><span>Exported ${pk.pack.exportedAt}</span></div>
      <div class="counts" style="margin-bottom:12px">${countTag('ALL', pk.rulesInPack, 'Rules in pack')}${countTag('NEW', pk.newRules, 'New')}${countTag('IDENTICAL', pk.identical, 'Identical')}${countTag('CONFLICT', pk.conflicts, 'Conflicts')}${countTag('INVALID', pk.invalid, 'Invalid')}</div>
      ${itemsPanel}${modePanel}${resolutionPanel}${replacePanel}
      <div class="action-bar" style="margin-top:14px;border:var(--bw) solid var(--line);border-radius:var(--r-md);max-width:1180px">
        ${blockers.length ? `<ul class="blockers" id="imp-blockers">${blockers.map((b) => `<li>${I('info')}${esc(b)}</li>`).join('')}</ul>` : `<span class="status" id="imp-blockers">${summary}</span>`}
        <div class="push">${pk.invalid ? `<button class="btn btn-secondary">${I('upload')}Choose another file</button>` : ''}<button class="btn btn-secondary">Cancel</button>${applyBtn}</div></div>`;
    return page({ shell: { trail: ['Settings', 'Classification rules', 'Import'], active: 'settings' }, chrome: '', column: settingsColumn(content) });
  }
  const chooseFile = (o = {}) => page({ shell: { trail: ['Settings', 'Classification rules', 'Import'], active: 'settings' }, chrome: '', column: settingsColumn(`<h1>Import rule pack</h1><p class="ws-sub">Move classification rules between Log Explorer installations. Nothing changes until you review a preview and apply it.</p>
      ${importProcess('Choose file')}
      <div class="file-pick" style="margin-top:14px">${I('file-json', 'lg')}<h2>Choose a rule pack file</h2><p>A JSON rule pack exported from Log Explorer. Up to 256 KB and 200 rules.</p><button class="btn btn-secondary">${I('upload')}Choose file…</button>${o.error ? `<p class="inline-error" role="alert" style="margin:0">${I('circle-alert', 'ic-sm')}${o.error}</p>` : ''}</div>
      <p class="help-row">${I('lock')}Rule packs contain rule definitions only. Packs with events, extracted values, credentials or server paths are not part of the format.</p>
      <div class="action-bar" style="margin-top:14px;border:var(--bw) solid var(--line);border-radius:var(--r-md);max-width:760px"><span class="status">No file chosen</span><div class="push"><button class="btn btn-secondary">Cancel</button><button class="btn btn-primary" disabled>${I('check')}Apply import</button></div></div>`) });

  add('66-import-choose-file', 'Import rule pack — choose a file', chooseFile);
  add('67-import-preview-clean', 'Import preview — clean (new rules only)', () => importPreview('clean'));
  add('68-import-preview-conflicts', 'Import preview — new, identical and a conflict; resolution required', () => importPreview('conflicts'));
  add('69-import-invalid-pack', 'Import preview — invalid rule blocks the import', () => importPreview('invalid'));
  add('70-import-replace-all-confirmation', 'Import — Replace all: destructive scope and required confirmation', () => importPreview('conflicts', { mode: 'REPLACE_ALL' }));
  const IMPORTED_RULE = { id: 'card-issuer-callback', name: 'Card issuer callback', description: '', tags: ['external-api', 'issuer'], enabled: true, priority: 100, matchMode: 'ALL', conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'Card issuer callback received' }, { field: 'message', matcher: 'CONTAINS', value: 'issuer=' }], extractions: [] };
  const RULES_AFTER_IMPORT = [...C.RULES, IMPORTED_RULE].sort((a, b) => a.id.localeCompare(b.id));
  add('71-import-applied', 'Import applied — result summary on the rules list', () => rulesPage({ rules: RULES_AFTER_IMPORT, revision: 14, banners: [banner('success', 'circle-check', 'Import from <span class="mono" style="font:var(--text-data)">shared-integration-rules.json</span> applied: 1 added, 0 replaced, 3 unchanged, 1 kept existing, 0 removed. Re-run Search to classify loaded results.', `<button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Re-run search</button>`)] }));

  // ------------------------------------------------------------------ states added after the LERUX-1 review (R13)
  const moreMenu = `<div class="menu" role="menu" aria-label="More actions for Frontend call" style="top:2px;right:10px"><button role="menuitem" class="is-active">${I('copy')}Duplicate</button><button role="menuitem">${I('download')}Export this rule</button><hr><button role="menuitem" class="is-danger">${I('trash-2')}Delete…</button></div>`;
  const DRAFT_NO_TAGS = { name: 'Middleware HTTP call', conds: DETECTED.conditions, mode: 'ALL', x: '6 values', xCount: 6 };
  const saveReady = () => rbPage('save', panel('Review and save', `<dl class="kv" style="grid-template-columns:140px minmax(0,1fr)"><dt>Name</dt><dd>Middleware HTTP call</dd><dt>Tags</dt><dd><span class="empty-cell">None yet</span></dd><dt>Matches when</dt><dd>${condList(DETECTED.conditions, 'ALL')}</dd><dt>Extracts</dt><dd>6 values</dd><dt>Enabled</dt><dd>Yes</dd><dt>Tested</dt><dd><span class="empty-cell">Not tested</span></dd></dl>
      <p class="help-row">${I('flask-conical')}This draft has not been tested. Testing first is recommended; it shows what the rule matches in a bounded sample.</p>
      <div role="alert" style="margin-top:10px"><ul class="blockers"><li style="color:var(--danger)">${I('circle-alert')}Not saved: add at least one tag (Classification step). <button class="btn btn-ghost btn-sm" style="margin-left:4px">Go to Classification</button></li></ul></div>`, { foot: `<button class="btn btn-secondary">${I('flask-conical')}Test first</button><button class="btn btn-primary" style="margin-left:auto">${I('check')}Save rule</button>` }),
    { sub: 'Review the draft, then save it to the Log Explorer server.', status: pick('source', 'detect', 'extraction'), draft: DRAFT_NO_TAGS, nav: rbNav('Test', null) });

  const detectNoSource = () => rbPage('detect', panel('Detect a pattern from a sample value', `<div class="form-stack">
      <label class="lbl-field">Field<select class="input"><option>Message (message)</option><option>Service (service)</option><option>Logger (logger)</option></select></label>
      <label class="lbl-field">Sample value<textarea class="input mono" rows="3" aria-describedby="detect-why"></textarea></label>
      <p class="help-row" id="detect-why" style="margin:0">${I('info')}Detect needs a sample value. Paste one above, or write conditions manually.</p>
      <p style="margin:0;color:var(--ink-2)">Detect samples up to 200 events from the current search scope and suggests conditions. It is a suggestion only; nothing is saved.</p>
      <div class="editor-row" style="margin:0"><button class="btn btn-primary" disabled aria-describedby="detect-why">${I('scan-search')}Detect pattern</button><button class="btn btn-secondary">${I('pencil')}Write conditions manually</button></div></div>`),
    { newRule: true, edit: true, sub: 'Paste a value from a log line to find similar events, or skip Detect and write the conditions yourself.', status: {}, draft: {}, nav: rbNav(null, 'Classification') });

  add('74-rule-save-ready', 'Create tag rule — Save pressed with a missing tag: nothing saved, issue listed (Save stays enabled, as in production)', saveReady);
  add('75-rules-more-menu', 'Rules list — More actions menu (Duplicate, Export this rule, Delete)', () => rulesPage({ menu: moreMenu }));
  add('76-rule-edit-mode', 'Edit a saved rule — no source event (New, Edit and Duplicate share this frame)', () => classificationStep(false, { edit: true, draft: Object.assign({}, DRAFT_NAMED, { x: '6 values', xCount: 6 }), status: { detect: { text: 'Not run in this edit' } }, sub: 'Change the name, tags or conditions. Detect needs a pasted sample value because this rule has no source event.' }));
  add('77-import-file-too-large', 'Import — file larger than the import limit', () => chooseFile({ error: '“partner-rules-archive.json” is 312 KB, larger than the 256 KB import limit.' }));
  add('78-import-revision-conflict', 'Import — rules changed after the preview; reload and preview again', () => importPreview('conflicts', { resolution: 'USE_IMPORTED', conflict: true }));
  add('79-more-filters-tags-error', 'More filters — classification tags could not be loaded', () => page({ shell: {}, chrome: queryBar({ moreOpen: true }) + scopeStrip(), overlay: filtersPanel({ tagsError: 'the request timed out' }), column: results() }));

  add('81-rule-new-detect-no-source', 'New rule — Detect without a source event: paste a sample value (empty-value hint)', detectNoSource);
  add('80-more-filters-tags-empty', 'More filters — no classification tags yet', () => page({ shell: {}, chrome: queryBar({ moreOpen: true }) + scopeStrip(), overlay: filtersPanel({ tagsEmpty: true }), column: results() }));

  // ------------------------------------------------------------------ Investigation and Live
  const tagOfMsg = (e) => (e.unknown && typeof e.unknown.uiElement === 'string' && /^(checkout|login)\./.test(e.unknown.uiElement) ? ['frontend-call'] : / completed with /.test(e.message || '') && e.service === 'api-gateway' ? ['gateway-response'] : e.service === 'ledger-service' && /(pending after|took) \d+ ms/.test(e.message || '') ? ['database-call'] : []);
  add('72-investigation-trace-tags', 'Investigation — Trace with a Tags column and tagged-event count', () => page({ shell: { trail: ['Search', 'Trace'] }, chrome: compactScope('Search filters are kept — return with Back'), column: capture('trace', { tags: tagOfMsg, tagStat: `<span class="stat"><span class="k">Tagged</span><span class="v">${D.traceCapture.filter((e) => tagOfMsg(e).length).length} of ${D.traceCapture.length}</span></span>` }) }));
  add('73-live-tags', 'Live — tags on arriving events', () => page({ shell: { trail: ['Live'] }, chrome: compactScope('Live shows new events for this source and project', { noTime: true, services: 'All services' }), column: live('live', { tags: tagOfMsg, extraNote: `<div class="live-note">${I('tag')}<span>Tags come from the rules saved on the server. A rule saved after Start applies only to events that arrive after the save.</span></div>` }) }));

  return STATES;
};
