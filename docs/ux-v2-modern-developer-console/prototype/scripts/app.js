/*
 * Modern Developer Console — static prototype renderer.
 * Every state is rendered from the one synthetic dataset in data.js.
 * URL: index.html?state=<id>&t=b1|b2|b3&theme=light|dark&nav=0&motion=0
 * Not production code: no behaviour is wired, controls are visual only.
 */
(function () {
  'use strict';

  const D = window.LX_DATA;
  const P = new URLSearchParams(location.search);
  const STATE = P.get('state') || 'hub';
  const TREAT = ['b1', 'b2', 'b3'].includes(P.get('t')) ? P.get('t') : 'b1';
  const THEME = P.get('theme') === 'dark' || (TREAT === 'b2' && P.get('theme') !== 'light') ? 'dark' : 'light';
  document.documentElement.dataset.treatment = TREAT;
  document.documentElement.dataset.theme = THEME;
  if (P.get('motion') === '0') document.body.classList.add('no-motion');

  // ------------------------------------------------------------------ helpers
  const I = (n, c) => `<svg class="ic${c ? ' ' + c : ''}" aria-hidden="true" focusable="false"><use href="#i-${n}"></use></svg>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (id) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '');
  const sev = (lvl, cls) => `<span class="sev${cls ? ' ' + cls : ''} sev-${lvl}" aria-hidden="true"></span>`;
  const LANE = Object.fromEntries(D.SERVICES.map((s) => [s.name, s.lane]));
  const laneColor = (svc) => `var(--lane-${LANE[svc] || 5})`;
  const ROOT = D.ROOT;
  const spanOf = (e) => (e.trace ? (e.id === ROOT.id ? '5d2a9f0c81e47b36' : (e.eventId || e.id).replace(/[^0-9a-f]/gi, '').slice(-16).toLowerCase().padStart(16, '0')) : null);
  const fmtS = (x) => `${x.toFixed(3)} s`;
  const dotted = (v) => (v ? esc(v).replace(/\./g, '.<wbr>') : '—');
  const DEVICE_IP = '10.24.18.37'; // synthetic private address; Device IP is unmasked by the policy drawn in state 17
  const count = (list, lvl) => list.filter((e) => e.level === lvl).length;
  const svcs = (list) => [...new Set(list.map((e) => e.service))];
  function gapsOf(list, threshold) {
    const out = [];
    for (let i = 1; i < list.length; i++) {
      const d = list[i].sec - list[i - 1].sec;
      if (d > threshold) out.push({ after: list[i - 1].id, from: list[i - 1], to: list[i], dur: d });
    }
    return out;
  }
  function highlightJson(json) {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)|([{}[\],])/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(json))) {
      out += esc(json.slice(last, m.index));
      if (m[1] && m[2]) out += `<span class="k">${esc(m[1])}</span>${esc(m[2])}`;
      else if (m[1]) out += `<span class="s">${esc(m[1])}</span>`;
      else if (m[3]) out += `<span class="n">${esc(m[3])}</span>`;
      else out += `<span class="p">${esc(m[4])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(json.slice(last));
  }

  // ------------------------------------------------------------------ shell
  function shell(o = {}) {
    const trail = o.trail || ['Search'];
    const t = trail.map((s, i) => (i === trail.length - 1 ? `<span aria-current="page">${esc(s)}</span>` : `<span>${esc(s)}</span>${I('chevron-right', 'ic-sep')}`)).join('');
    const cur = (k) => (o.active === k ? ' is-current" aria-current="page' : '');
    return `<header class="shell">
      <span class="brand">Log Explorer</span>
      <span class="env-badge" title="Active backend profile: dev">DEV</span>
      <nav class="mode-trail" aria-label="Current workspace">${t}</nav>
      <div class="shell-actions">
        <button class="btn btn-ghost${cur('mapping')}">${I('scan-search')}<span class="lbl">Field mapping</span></button>
        <button class="btn btn-ghost${cur('settings')}">${I('settings')}<span class="lbl">Settings</span></button>
        <button class="btn btn-ghost btn-icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">${I('keyboard')}</button>
      </div>
    </header>`;
  }

  // ------------------------------------------------------------------ query bar
  function queryBar(o = {}) {
    const loki = o.source === 'loki';
    const health = o.health || 'up';
    const hWord = { up: 'Healthy', degraded: 'Degraded', down: 'Unreachable', checking: 'Checking…' }[health];
    const srcName = o.sourceName || (loki ? 'OpenShift Loki' : D.SCOPE.sourceName);
    const exclude = o.exclude !== false && !loki;
    const svcV = loki ? 'All services' : exclude ? 'All except 2' : 'All services';
    const running = !!o.running;
    const disabled = o.notReady || o.searchDisabled;
    const searchBtn = running
      ? `<button class="btn btn-primary btn-search is-running" aria-disabled="true" aria-busy="true">${I('loader-circle', 'spin')}Searching…</button>`
      : `<button class="btn btn-primary btn-search"${disabled ? ' disabled' : ''}${o.notReady ? ' title="Search is disabled until the edited field mapping is validated and saved"' : ''}${o.searchDisabled ? ` title="${esc(o.searchDisabled)}"` : ''}>${I('search')}Search</button>`;
    return `<div class="querybar" role="search" aria-label="Search logs">
      <span class="anchor qb-scope">
        <button class="field" aria-haspopup="dialog" aria-expanded="${!!o.healthOpen}" aria-label="Source: ${esc(srcName)}, ${hWord}">${I('database', 'ic-sm')}<span class="v">${esc(srcName)}</span><span class="health"><span class="health-dot h-${health}" aria-hidden="true"></span>${hWord}</span>${I('chevron-down', 'ic-caret')}</button>
        ${o.healthOpen ? healthPopover() : ''}${o.sourceOpen ? sourceList() : ''}
      </span>
      ${loki
        ? `<button class="field qb-scope" aria-label="OpenShift scope: namespace payments-uat, Deployment payments-api, all pods, all containers"><span class="k">Namespace</span><span class="v">payments-uat</span>${I('chevron-right', 'ic-caret')}<span class="v">payments-api</span>${I('chevron-down', 'ic-caret')}</button>`
        : `<button class="field qb-scope"><span class="k">Project</span><span class="v">${esc(o.project || D.SCOPE.project)}</span>${I('chevron-down', 'ic-caret')}</button>`}
      <button class="field qb-scope-mobile"><span class="k">Scope</span><span class="v">${esc(srcName)} · ${esc(D.SCOPE.project)} · 1 day · ${exclude ? '2 services excluded' : 'all services'}</span>${I('chevron-down', 'ic-caret')}</button>
      <span class="qb-sep" aria-hidden="true"></span>
      <span class="anchor qb-time"><button class="field" aria-haspopup="dialog" aria-expanded="${!!o.customOpen}" aria-label="Time range: ${esc(o.timeAria || o.timeLabel || 'Last 1 day')}">${I('clock', 'ic-sm')}<span class="v">${esc(o.timeLabel || 'Last 1 day')}</span>${I('chevron-down', 'ic-caret')}</button>${o.customOpen ? customRangePopover() : ''}</span>
      <span class="anchor qb-services">
        <button class="field${exclude ? ' is-exclude' : ''}" aria-haspopup="dialog" aria-expanded="${!!o.servicesOpen}" aria-label="Services: ${exclude ? 'all services except 2' : 'all services'}"><span class="k">Services</span><span class="v">${svcV}</span>${I('chevron-down', 'ic-caret')}</button>
        ${o.servicesOpen ? servicesPopover(o) : ''}
      </span>
      <button class="field qb-severity" aria-haspopup="dialog" aria-label="Severity: Info, Warn, Error"><span class="sev-summary">${sev('INFO')}${sev('WARN')}${sev('ERROR')}</span><span class="v">Info, Warn, Error</span>${I('chevron-down', 'ic-caret')}</button>
      <label class="search-input">${I('search', 'ic-sm')}<span class="vh">Search text</span><input type="text" value="${esc(o.text || '')}" placeholder="Search messages, errors, users or paste an ID"><kbd>/</kbd></label>
      <button class="btn btn-secondary btn-more${o.moreOpen ? ' is-open' : ''}" aria-expanded="${!!o.moreOpen}">${I('sliders-horizontal')}<span class="lbl">More filters</span>${o.filterCount ? `<span class="count">${o.filterCount}</span>` : ''}</button>
      ${searchBtn}
      ${loki ? '' : `<button class="btn btn-ghost btn-live">${I('radio')}<span class="lbl">Live</span></button>`}
    </div>`;
  }

  function servicesPopover(o) {
    const none = !!o.noServices;
    const list = D.SERVICES.map((s) => {
      const on = D.excluded.includes(s.name);
      return `<li><span class="box${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" aria-label="${s.name}">${on ? I('check') : ''}</span><span>${s.name}</span><span class="meta num">${s.running}/${s.total} running</span></li>`;
    }).join('');
    return `<div class="popover" role="dialog" aria-label="Select services" style="width:348px">
      <div class="pop-head"><h2>Services</h2></div>
      <div class="pop-body">
        <div class="segmented" role="group" aria-label="Service filter mode">
          <button aria-pressed="false">${I('plus', 'ic-sm')}Include selected</button>
          <button aria-pressed="true">${I('minus', 'ic-sm')}Exclude selected</button>
        </div>
        <p class="help">${none ? 'No services to choose from for this scope.' : 'Search covers every service <strong>except</strong> the checked ones. Excluded services are never read.'}</p>
        ${none
          ? `<div class="empty-note" style="margin-top:10px">${I('info')}<div><strong>This source reported no services for payments-stack.</strong><br>Service discovery returned an empty list — not the same as no match for a search term. Search still covers every event in scope.</div></div>`
          : `<label class="search-input" style="margin-top:10px">${I('search', 'ic-sm')}<span class="vh">Search services</span><input placeholder="Search services…"></label><ul class="check-list">${list}</ul>`}
      </div>
      <div class="pop-foot"><span class="num">${none ? '0 services' : '2 of 7 excluded'}</span><button class="btn btn-ghost btn-sm"${none ? ' disabled' : ''}>Clear</button></div>
    </div>`;
  }

  // The Source control stays a native <select> (register SSEL-2). Its open list is drawn by the browser; this is an approximation of that list.
  function sourceList() {
    const opt = (label, o = {}) => `<li role="option" aria-selected="${!!o.sel}"${o.dis ? ' aria-disabled="true"' : ''} class="${o.sel ? 'is-selected' : ''}${o.dis ? ' is-unavailable' : ''}">${o.sel ? I('check', 'ic-sm') : '<span class="ic-sm-slot"></span>'}<span>${label}</span></li>`;
    return `<ul class="native-list" role="listbox" aria-label="Source">${opt('Local Docker', { sel: true })}${opt('OpenShift')}${opt('OpenShift Loki — Not available', { dis: true })}</ul>`;
  }
  function healthPopover() {
    const row = (name, ok, detail) => `<li><span class="box${ok ? ' on' : ''}" aria-hidden="true">${ok ? I('check') : I('minus')}</span><span>${name}</span><span class="meta">${detail}</span></li>`;
    return `<div class="popover" role="dialog" aria-label="Source health details" style="width:380px">
      <div class="pop-head"><h2>OpenShift Loki</h2><span class="health" style="border:0;margin-left:auto"><span class="health-dot h-up" aria-hidden="true"></span>Healthy</span></div>
      <div class="pop-body">
        <dl class="kv"><dt>Checked</dt><dd class="mono">11:04:02 UTC</dd><dt>Latency</dt><dd class="mono">184 ms</dd></dl>
        <h3 class="sec-h" style="margin-top:12px">Capabilities declared by this source</h3>
        <ul class="check-list">
          ${row('Historical search', true, 'Supported')}
          ${row('Raw LogQL', true, 'Enabled by configuration')}
          ${row('Live', false, 'Not supported by this source')}
          ${row('Surrounding context', false, 'Not supported by this source')}
        </ul>
        <p class="help">Controls for unsupported capabilities are not shown for this source.</p>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ scope strip
  function scopeStrip(o = {}) {
    const chips = [];
    chips.push(`<div class="segmented quick" role="group" aria-label="Severity quick filters"><button aria-pressed="false">All levels</button><button aria-pressed="${!!o.errorsOnly}">Errors only</button></div>`);
    chips.push(`<span class="chip is-time">Time <b>${esc(o.timeLabel || 'Last 1 day')}</b>${o.timeRange ? ` <span style="color:var(--ink-3)">${o.timeRange}</span>` : ''}<button class="x" aria-label="Reset time range to default">${I('x')}</button></span>`);
    if (o.exclude !== false) chips.push(`<span class="chip is-exclude"><span class="chip-mode">Excluding</span> <b>audit-writer, notification-worker</b><button class="x" aria-label="Remove service exclusion">${I('x')}</button></span>`);
    (o.chips || []).forEach((c) => chips.push(c));

    const readout = o.readout != null ? o.readout : `<strong>${D.results.length}</strong> loaded<span class="sep">·</span>more available<span class="extra"><span class="sep">·</span>total not reported by this source</span>`;
    return `<div class="scope-strip" style="position:relative">
      <div class="chips" role="group" aria-label="Active filters">${chips.join('')}</div>${o.noClear ? '' : '<button class="btn btn-ghost btn-sm strip-clear">Clear all</button>'}
      <div class="strip-right">
        <span class="readout num" aria-live="polite">${readout}</span>
        <span class="strip-divider"></span>
        ${o.context ? `<span class="readout">${I('arrow-up-narrow-wide', 'ic-sm')} Oldest first (fixed)</span>` : `<button class="btn btn-ghost btn-sm" aria-label="Sort order: Newest first">${I('arrow-down-wide-narrow', 'ic-sm')}<span class="lbl">Newest first</span></button>`}
        <span class="anchor"><button class="btn btn-ghost btn-sm hide-narrow${o.columnsOpen ? ' is-open' : ''}" aria-expanded="${!!o.columnsOpen}">${I('columns-3', 'ic-sm')}<span class="lbl">Columns</span></button>${o.columnsOpen ? columnsPopover() : ''}</span>
        <button class="btn btn-ghost btn-sm hide-narrow">${I('braces', 'ic-sm')}<span class="lbl">Query details</span></button>
        <button class="btn btn-ghost btn-sm btn-icon" aria-label="Refresh results (R)">${I('rotate-cw', 'ic-sm')}</button>
      </div>
      ${o.running ? '<div class="progress-line" role="progressbar" aria-label="Search in progress"></div>' : ''}
    </div>`;
  }

  function columnsPopover() {
    const cols = [['Time', 1], ['Level', 1], ['Service', 1], ['What happened', 1], ['User / Customer', 1], ['Correlation / Trace', 1], ['Logger', 0], ['Trace ID', 0], ['Span ID', 0], ['Journey ID', 0], ['Error code', 0], ['Business step', 0], ['Container', 0], ['Compose project', 0]];
    const li = cols.map(([name, on], i) => `<li class="col-row"><span class="grip" aria-hidden="true">${I('grip-vertical', 'ic-sm')}</span><span class="box${on ? ' on' : ''}" role="checkbox" aria-checked="${!!on}" tabindex="0" aria-label="Show ${name}">${on ? I('check') : ''}</span><span>${name}</span><span class="meta"><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move ${name} up"${i === 0 ? ' disabled' : ''}>${I('arrow-up', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move ${name} down">${I('arrow-down', 'ic-sm')}</button></span></li>`).join('');
    return `<div class="popover right" role="dialog" aria-label="Table settings" style="width:330px">
      <div class="pop-head"><h2>Table settings</h2></div>
      <div class="pop-body">
        <div class="lbl-field" style="margin-bottom:10px">Density<div class="segmented"><button aria-pressed="true">Compact</button><button aria-pressed="false">Comfortable</button></div></div>
        <ul class="check-list col-list">${li}<li class="col-row locked"><span class="grip" aria-hidden="true">${I('lock', 'ic-sm')}</span><span class="box on" aria-hidden="true">${I('check')}</span><span>Actions</span><span class="meta">Always last</span></li></ul>
        <p class="help">Drag a row or use the arrows to reorder. At least one column besides Actions stays visible.</p>
      </div>
      <div class="pop-foot"><button class="btn btn-ghost btn-sm">${I('rotate-ccw', 'ic-sm')}Reset table</button><button class="btn btn-secondary btn-sm">Close</button></div>
    </div>`;
  }

  // ------------------------------------------------------------------ results table
  function colgroup(o = {}) {
    return `<colgroup><col class="w-time"><col class="w-level"><col class="w-svc"><col>${o.tagsCol ? '<col class="w-tags">' : ''}<col class="w-actor"><col class="w-rel"><col class="w-act"></colgroup>`;
  }
  /**
   * The palette entry a tag is drawn in. One normalized tag resolves to exactly one colour across the whole
   * product (production refuses a conflicting second colour), so this is a lookup, never a per-surface choice.
   */
  function tagClass(t) {
    return 'tag-' + ((window.LX_TAG_COLOR && window.LX_TAG_COLOR[t]) || 'gray');
  }
  // Classification tags as a compact cell: first tag + overflow count; the full list is the accessible name (DESIGN_SYSTEM §22.3).
  function tagCell(e) {
    const t = e.tags || [];
    if (!t.length) return '<td class="c-tags"><span class="empty-cell">—</span></td>';
    const more = t.length - 1;
    return `<td class="c-tags" title="${esc(t.join(', '))}"><span class="tag-cell" aria-hidden="true"><span class="tag-chip ${tagClass(t[0])}"><span class="t">${esc(t[0])}</span></span>${more ? `<span class="tag-more">+${more}</span>` : ''}</span><span class="vh">Tags: ${esc(t.join(', '))}</span></td>`;
  }
  function head(o = {}) {
    const time = o.fixedSort
      ? `<th scope="col" aria-sort="ascending">Time ${I('arrow-up-narrow-wide')}</th>`
      : `<th scope="col" aria-sort="descending"><button class="th-btn" aria-label="Time, sorted newest first">Time ${I('arrow-down-wide-narrow')}</button></th>`;
    return `<thead><tr>${time}<th scope="col">Level</th><th scope="col">Service</th><th scope="col">What happened</th>${o.tagsCol ? '<th scope="col">Tags</th>' : ''}<th scope="col">User / Customer</th><th scope="col">Correlation / Trace</th><th scope="col"><span class="vh">Actions</span></th></tr></thead>`;
  }
  function msgHtml(e) {
    if (e.malformed) return `<span class="tag tag-malformed">Malformed</span><span class="raw">${esc(e.raw)}</span>`;
    if (e.message === '') return '<span class="msg-empty">(empty message)</span>';
    return esc(e.message);
  }
  function row(e, o = {}) {
    const cls = [];
    if (e.level === 'ERROR') cls.push('is-error');
    if (o.selectedId === e.id) cls.push('is-selected');
    if (o.rootId === e.id) cls.push('is-root');
    if (o.stale) cls.push('is-stale');
    const selected = o.selectedId === e.id;
    const actor = e.actor ? `<span class="actor"><span class="k">User</span><span class="masked">${esc(e.actor.user)}</span></span>` : '<span class="empty-cell">—</span>';
    const rel = e.trace ? `<button class="id-link" tabindex="-1" title="View Trace">${short(e.trace)}</button>` : e.corr ? `<button class="id-link" tabindex="-1" title="Find same Correlation">${short(e.corr)}</button>` : '<span class="empty-cell">—</span>';
    const trigger = o.rootId ? o.rootId === e.id : selected;
    const ring = trigger ? '<span class="trigger-ring" aria-hidden="true"></span><span class="vh">Selected event, </span>' : '';
    return `<tr class="${cls.join(' ')}" tabindex="${selected || o.tabStop ? 0 : -1}" aria-selected="${selected}"${o.rootId === e.id ? ' aria-current="location"' : ''}>
      <td class="c-time">${sev(e.level, 'sev-mark')}${ring}<span class="d">${e.date}</span> <span class="c">${e.clock}</span></td>
      <td><span class="lvl lvl-${e.level}">${e.level}</span></td>
      <td class="c-svc">${esc(e.service)}</td>
      <td class="c-msg">${msgHtml(e)}</td>
      ${o.tagsCol ? tagCell(e) : ''}
      <td>${actor}</td>
      <td>${rel}</td>
      <td class="c-act"><button class="btn btn-ghost btn-sm btn-icon" tabindex="-1" aria-label="Actions for this event">${I('ellipsis')}</button></td>
    </tr>`;
  }
  function resultsTable(list, o = {}) {
    // PR #60 made classification visible in the table by default, superseding decision D19's "optional, hidden
    // by default". `noTags` exists only for the Columns-settings state, which shows the column being hidden.
    o = Object.assign({}, o, { tagsCol: o.noTags ? false : o.tagsCol !== false });
    const gaps = o.gaps ? gapsOf(list, 5) : [];
    const body = list.map((e, i) => {
      const g = gaps.find((x) => x.after === e.id);
      return row(e, Object.assign({ tabStop: !o.selectedId && i === 0 }, o)) + (g ? `<tr class="gap-row"><td colspan="${o.tagsCol ? 8 : 7}">${I('timer')}Gap detected — ${fmtS(g.dur)} with no observed events (${g.from.clock} → ${g.to.clock})</td></tr>` : '');
    }).join('');
    return `<div class="table-wrap"><table class="grid results${o.comfortable ? ' comfortable' : ''}${o.tagsCol ? ' has-tags' : ''}" aria-label="${o.label || 'Search results'}" aria-rowcount="${list.length}">${colgroup(o)}${head(o)}<tbody>${body}</tbody></table>${o.after || ''}</div>`;
  }
  function skeletonTable(rows) {
    const w = [62, 38, 70, 88, 55, 64];
    const r = Array.from({ length: rows }, (_, i) => `<tr aria-hidden="true"><td class="c-time"><span class="skel" style="width:${70 + (i % 3) * 8}%"></span></td><td><span class="skel" style="width:${w[i % 6] % 50 + 30}%"></span></td><td><span class="skel" style="width:${w[(i + 2) % 6]}%"></span></td><td><span class="skel" style="width:${40 + ((i * 17) % 45)}%"></span></td><td><span class="skel" style="width:48%"></span></td><td><span class="skel" style="width:70%"></span></td><td></td></tr>`).join('');
    return `<div class="table-wrap" aria-busy="true"><table class="grid results" aria-label="Search results loading">${colgroup()}${head()}<tbody>${r}</tbody></table></div>`;
  }

  // ------------------------------------------------------------------ inspector
  function emptyNote(title, detail) {
    return `<div class="sec"><div class="empty-note">${I('circle-dashed')}<div><strong style="color:var(--ink-1);font-weight:500">${esc(title)}</strong>${detail ? `<br>${esc(detail)}` : ''}</div></div></div>`;
  }
  function idRow(k, v, action, icon) {
    if (!v) return `<span class="k">${k}</span><span class="v" style="color:var(--ink-3);font-family:var(--font-ui)">Not on this event</span><span class="a"></span>`;
    return `<span class="k">${k}</span><span class="v" title="${esc(v)}">${esc(v)}</span><span class="a"><button class="btn btn-secondary btn-sm">${I(icon, 'ic-sm')}${action}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Copy ${k}">${I('copy', 'ic-sm')}</button></span>`;
  }
  const TABS = {
    overview(e, o = {}) {
      return `<div class="sec"><div class="msg-block">${e.malformed ? `<span class="raw">${esc(e.raw)}</span>` : e.message === '' ? '<span class="msg-empty">(empty message)</span>' : esc(e.message)}</div>${e.malformed ? `<p class="note" style="margin-top:8px">${I('info')}This line is not valid JSON, so it is shown exactly as received. No fields could be extracted.</p>` : ''}</div>
      <div class="sec"><h2 class="sec-h">When &amp; where</h2><dl class="kv">
        <dt>Time</dt><dd><span class="mono">2026-09-15 ${e.clock}</span><span class="sub">Asia/Kuwait (UTC+03:00) · <span class="mono">${e.utc} UTC</span></span></dd>
        ${o.loki ? '<dt>Source</dt><dd>OpenShift Loki</dd><dt>Namespace</dt><dd class="mono">payments-uat</dd>' : '<dt>Source</dt><dd>Local Docker</dd><dt>Compose project</dt><dd class="mono">payments-stack</dd>'}
        <dt>Service</dt><dd>${esc(e.service)}</dd>
        ${o.loki ? '<dt>Pod</dt><dd><span class="mono">payments-api-7d9f8c6b5-x2kqp</span><span class="sub">container <span class="mono">app</span></span></dd>' : `<dt>Container</dt><dd><span class="mono">${e.container}</span><span class="sub"><span class="mono">${e.containerId}</span> · ${e.stream}</span></dd>`}
        <dt>Level</dt><dd><span class="lvl lvl-${e.level}">${e.level}</span></dd>
        <dt>Logger</dt><dd class="mono">${dotted(e.logger)}</dd>
        <dt>Thread</dt><dd class="mono">${esc(e.thread || '—')}</dd>
      </dl></div>${o.classification || (window.LX_CLASSIFICATION_SECTION && (e.classifications || []).length ? window.LX_CLASSIFICATION_SECTION(e) : '')}`;
    },
    actor(e) {
      if (!e.actor) return emptyNote('No actor or client data on this event.', 'No username, customer, CIF, device, platform or language fields were present.');
      const a = e.actor;
      return `<div class="sec"><p class="note">${I('shield')}<span>Masking policy (Settings › Privacy &amp; masking): CIF, Username, Customer ID and Device ID are masked on the server. <strong style="color:var(--ink-1);font-weight:500">Device IP is unmasked</strong> by the current policy. There is no reveal action.</span></p></div>
      <div class="sec"><h2 class="sec-h">Who<span class="aside">masked</span></h2><dl class="kv">
        <dt>Username</dt><dd class="masked">${a.user}</dd><dt>Customer ID</dt><dd class="masked">${a.customer}</dd><dt>CIF</dt><dd class="masked">${a.cif}</dd>
      </dl></div>
      <div class="sec"><h2 class="sec-h">Client</h2><dl class="kv">
        <dt>Device ID</dt><dd class="masked">${a.deviceId}</dd><dt>Device IP</dt><dd class="mono">${DEVICE_IP}</dd><dt>Device platform</dt><dd class="mono">${a.platform}</dd><dt>Language</dt><dd class="mono">${a.language}</dd>
      </dl></div>`;
    },
    flow(e) {
      if (!(e.trace || e.corr || e.journey || e.eventId)) return emptyNote('No journey, correlation, trace, span, or event ID on this event.');
      return `<div class="sec"><h2 class="sec-h">Follow related events</h2><div class="id-rows">
        ${idRow('Journey ID', e.journey, 'Find same journey', 'route')}
        ${idRow('Correlation ID', e.corr, 'Find same correlation', 'link')}
        ${idRow('Trace ID', e.trace, 'View trace', 'waypoints')}
        ${idRow('Span ID', spanOf(e), 'View span', 'git-branch')}
        ${idRow('Event ID', e.eventId, 'Find same event', 'crosshair')}
      </div><p class="note" style="margin-top:10px">${I('info')}Related events open in a capture ordered by timestamp. Order alone does not show that one event caused another.</p></div>
      <div class="sec"><h2 class="sec-h">Journey context</h2><dl class="kv"><dt>Journey name</dt><dd class="mono">${e.journeyName || '—'}</dd><dt>Business step</dt><dd class="mono">${e.step || '—'}</dd></dl></div>`;
    },
    business(e) {
      if (!(e.step || e.errorCode || e.exception)) return emptyNote('No business step, UI identifier, error code, or exception on this event.');
      const lines = e.exception ? e.exception.split('\n').length : 0;
      return `<div class="sec"><dl class="kv">
        <dt>Error code</dt><dd class="mono">${e.errorCode || '—'}</dd>
        <dt>Business step</dt><dd class="mono">${e.step || '—'}</dd>
        <dt>UI identifier</dt><dd><span style="color:var(--ink-3)">Not mapped for this project</span> · <a class="link" href="#">Field mapping</a></dd>
      </dl></div>
      ${e.exception ? `<div class="sec"><h2 class="sec-h">Exception<span class="aside">${lines} lines, as received</span></h2><pre class="code wrap">${esc(e.exception)}</pre></div>` : ''}`;
    },
    technical(e) {
      const canon = [['@timestamp', `2026-09-15T${e.utc}Z`], ['level', e.level], ['application', e.service], ['message', e.message], ['logger_name', e.logger], ['thread_name', e.thread], ['traceId', e.trace], ['spanId', spanOf(e)], ['X-Correlation-id', e.corr], ['journeyTraceId', e.journey], ['journeyName', e.journeyName], ['stepName', e.step], ['mdc.eventId', e.eventId], ['mdc.ERROR_CODE', e.errorCode], ['userName', e.actor && e.actor.user], ['customerId', e.actor && e.actor.customer], ['cif', e.actor && e.actor.cif], ['deviceIp', e.actor && DEVICE_IP], ['devicePlatformType', e.actor && e.actor.platform], ['language', e.actor && e.actor.language], ['serverIp', e.serverIp], ['serverHost', e.serverHost]].filter(([, v]) => v != null && v !== '');
      const unknown = Object.entries(e.unknown || {});
      const tr = ([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
      const json = JSON.stringify(Object.assign({ timestamp: `2026-09-15T${e.utc}Z`, level: e.level, service: e.service, message: e.message, traceId: e.trace, spanId: spanOf(e), correlationId: e.corr, journeyId: e.journey, eventId: e.eventId, businessStep: e.step, errorCode: e.errorCode, protectedFields: e.actor ? { cif: e.actor.cif, userName: e.actor.user, customerId: e.actor.customer, deviceId: e.actor.deviceId, deviceIp: DEVICE_IP } : null, composeProject: 'payments-stack', containerName: e.container, stream: e.stream }, { unknownTopLevelFields: e.unknown }), null, 2);
      return `<div class="sec"><label class="search-input">${I('search', 'ic-sm')}<span class="vh">Filter fields</span><input placeholder="Filter by field name or value…"></label></div>
      <div class="sec"><h2 class="sec-h">All fields<span class="aside num">${canon.length + unknown.length} fields</span></h2>
        <table class="field-table"><tbody>
          <tr class="group"><td colspan="2">Mapped to canonical fields</td></tr>${canon.map(tr).join('')}
          <tr class="group"><td colspan="2">Unrecognised keys · kept, not mapped</td></tr>${unknown.length ? unknown.map(tr).join('') : '<tr><td colspan="2" style="font-family:var(--font-ui);color:var(--ink-3)">None on this event</td></tr>'}
        </tbody></table></div>
      <div class="sec"><details class="disclosure" open><summary>${I('chevron-right')}Canonical event JSON<span class="aside">as served · masking per current policy</span></summary><div class="body"><pre class="code" tabindex="0" aria-label="Canonical event JSON">${highlightJson(json)}</pre></div></details></div>`;
    },
  };
  function inspector(e, tab, o = {}) {
    const tabs = [['overview', 'Overview'], ['actor', 'Actor & client'], ['flow', 'Request flow'], ['business', 'Business / error'], ['technical', 'Technical / all fields']];
    const empty = { actor: !e.actor, flow: !(e.trace || e.corr || e.journey || e.eventId), business: !(e.step || e.errorCode || e.exception) };
    const title = e.malformed ? 'Malformed log line' : e.message === '' ? '(empty message)' : e.message;
    const idx = D.results.indexOf(e);
    const pos = o.pos || (idx >= 0 ? `${idx + 1} of ${D.results.length} loaded` : '');
    return `<div class="scrim" aria-hidden="true"></div><div class="inspector${o.entering ? ' is-entering' : ''}" role="dialog" aria-modal="false" aria-label="Event details">
      <span class="resize" role="separator" aria-orientation="vertical" aria-label="Resize event details" aria-valuenow="500" aria-valuemin="320" aria-valuemax="720" tabindex="0"></span>
      <div class="insp-head">
        <div class="insp-meta">
          <span class="lvl-badge">${sev(e.level)}<span class="lvl lvl-${e.level}">${e.level}</span></span>
          <span class="dot-sep" aria-hidden="true"></span><span>${esc(e.service)}</span>
          <span class="dot-sep" aria-hidden="true"></span><span class="when">${e.date} ${e.clock}</span>
          <button class="btn btn-ghost btn-sm btn-icon insp-close" aria-label="Close event details (Esc)">${I('x')}</button>
        </div>
        <h2 class="insp-title">${I('crosshair', 'trigger-mark')}<span>${esc(title)}</span></h2>
        <div class="insp-actions">
          ${o.noContext ? '' : `<button class="btn btn-secondary btn-sm">${I('history', 'ic-sm')}Show surroundings<kbd>X</kbd></button>`}
          ${e.trace ? `<button class="btn btn-secondary btn-sm">${I('waypoints', 'ic-sm')}View trace</button>` : ''}
          ${e.malformed ? '' : (e.tags && e.tags.length
            // A classified event offers two different intentions, never one vague action (DESIGN_SYSTEM §22.8):
            // add INFORMATION to a rule that already matched, or add another IDENTITY.
            ? `<button class="btn btn-ghost btn-sm">${I('circle-plus', 'ic-sm')}Add extraction from this event</button><button class="btn btn-ghost btn-sm">${I('tag', 'ic-sm')}Create another tag rule</button>`
            : `<button class="btn btn-ghost btn-sm">${I('tag', 'ic-sm')}Create tag rule from this event</button>`)}
          <div class="insp-nav"><span class="pos num" aria-live="polite">${pos}</span>
            <button class="btn btn-ghost btn-sm btn-icon" aria-label="Previous event ([)">${I('chevron-left')}</button>
            <button class="btn btn-ghost btn-sm btn-icon" aria-label="Next event (])">${I('chevron-right')}</button>
          </div>
        </div>
        <div class="tabs" role="tablist" aria-label="Event detail sections">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}">${l}${empty[k] ? '<span class="tab-empty" role="img" aria-label="no data on this event"></span>' : ''}</button>`).join('')}</div>
      </div>
      <div class="insp-body" role="tabpanel" aria-label="${tabs.find(([k]) => k === tab)[1]}">${TABS[tab](e, o)}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ compact scope + workspace header
  function compactScope(note, o = {}) {
    const hWord = { up: 'Healthy', degraded: 'Degraded', down: 'Unreachable', checking: 'Checking…' }[o.health || 'up'];
    return `<div class="compact-scope">
      <span class="field"><span class="k">Source</span><span class="v">Local Docker</span><span class="health"><span class="health-dot h-${o.health || 'up'}" aria-hidden="true"></span>${hWord}</span></span>
      <span class="field"><span class="k">Project</span><span class="v">payments-stack</span></span>
      ${o.noTime ? '' : `<span class="field">${I('clock', 'ic-sm')}<span class="v">Last 1 day</span></span>`}
      ${o.services ? `<span class="field"><span class="k">Services</span><span class="v">${esc(o.services)}</span></span>` : ''}
      <span class="kept">${I('filter', 'ic-sm')}${esc(note)}</span>
      ${o.edit === false ? '' : `<button class="btn btn-ghost btn-sm">${I('sliders-horizontal', 'ic-sm')}Edit search</button>`}
    </div>`;
  }

  // ------------------------------------------------------------------ capture (investigation workspace)
  function ticks(lo, hi, origin, minor, major, label) {
    let out = '';
    const pct = (s) => ((s - lo) / (hi - lo)) * 100;
    const first = Math.ceil((lo - origin) / minor) * minor;
    for (let s = first; origin + s <= hi + 1e-9; s += minor) {
      const r = Math.round(s * 1000) / 1000;
      const isMajor = Math.abs(r / major - Math.round(r / major)) < 1e-6;
      const p = pct(origin + r);
      if (p < -0.01 || p > 100.01) continue;
      out += `<span class="tick${isMajor ? ' major' : ''}" style="left:${p.toFixed(3)}%"></span>`;
      if (isMajor) out += `<span class="tick-label${p < 2 ? ' start' : p > 97 ? ' end' : ''}" style="left:${p.toFixed(3)}%">${label(r)}</span>`;
    }
    return out;
  }
  function capture(kind, o = {}) {
    const list = kind === 'journey' ? D.journeyCapture : D.traceCapture;
    const start = list[0].sec;
    const end = list[list.length - 1].sec;
    const span = end - start;
    const lo = start - span * 0.02;
    const hi = end + span * 0.02;
    const pct = (s) => `${(((s - lo) / (hi - lo)) * 100).toFixed(3)}%`;
    const services = svcs(list);
    const gaps = gapsOf(list, 5);
    const rootIdx = list.indexOf(ROOT) + 1;
    const traces = kind === 'journey' ? [D.TRACE.t1, D.TRACE.t2, D.TRACE.t3] : [D.TRACE.t1];
    const tIndex = (t) => traces.indexOf(t) + 1;
    const minor = kind === 'journey' ? 1 : 0.5;
    const major = kind === 'journey' ? 2 : 1;

    const brackets = kind === 'journey' ? `<div class="axis-label"></div><div class="trace-row">${traces.map((t, i) => {
      const ev = list.filter((e) => e.trace === t);
      const a = ev[0].sec; const b = ev[ev.length - 1].sec;
      return `<span class="bracket" style="left:${pct(a)};width:calc(${pct(b)} - ${pct(a)} + 1px)"><span>T${i + 1}</span></span>`;
    }).join('')}</div>` : '';

    const laneLabels = services.map((s) => `<div class="lane-label"><span class="swatch" style="background:${laneColor(s)}" aria-hidden="true"></span>${esc(s)}</div>`).join('');
    const lanes = services.map((s) => `<div class="lane">${list.filter((e) => e.service === s).map((e) => `<span class="pt${e.id === ROOT.id ? ' is-root' : ''}" style="left:${pct(e.sec)}" title="${e.clock} · ${e.level} · ${esc(e.message)}">${sev(e.level)}</span>`).join('')}</div>`).join('');
    const bands = gaps.map((g) => `<div class="gap-band" style="left:${pct(g.from.sec)};width:calc(${pct(g.to.sec)} - ${pct(g.from.sec)})"><span>Gap ${fmtS(g.dur)}</span></div>`).join('');

    const seqRows = list.map((e) => {
      const g = gaps.find((x) => x.after === e.id);
      const isRoot = e.id === ROOT.id;
      return `<tr class="${[e.level === 'ERROR' ? 'is-error' : '', isRoot ? 'is-root' : ''].join(' ')}"${isRoot ? ' aria-current="location" tabindex="0"' : ' tabindex="-1"'}>
        <td class="c-time">${sev(e.level, 'sev-mark')}${isRoot ? '<span class="trigger-ring" aria-hidden="true"></span><span class="vh">Selected event, </span>' : ''}<span class="c">${e.clock}</span></td>
        <td class="c-off">+${(e.sec - start).toFixed(3)} s</td>
        <td><span class="svc-cell"><span class="swatch" style="background:${laneColor(e.service)}" aria-hidden="true"></span>${esc(e.service)}</span></td>
        <td><span class="lvl lvl-${e.level}">${e.level}</span></td>
        <td class="c-step">${e.step || '—'}</td>
        <td class="c-msg">${msgHtml(e)}</td>
        ${o.tags ? tagCell({ tags: o.tags(e) }) : ''}
        ${kind === 'journey' ? `<td><span class="tag tag-trace">T${tIndex(e.trace)}</span> <span class="mono" style="color:var(--ink-3)">${e.trace.slice(0, 8)}</span></td>` : `<td class="mono" style="color:var(--ink-3)">${spanOf(e)}</td>`}
        <td class="c-act"><button class="btn btn-ghost btn-sm" tabindex="-1">${I('history', 'ic-sm')}Surroundings</button></td>
      </tr>${g ? `<tr class="gap-row"><td colspan="${o.tags ? 9 : 8}">${I('timer')}Gap detected — ${fmtS(g.dur)} with no observed events (${g.from.clock} → ${g.to.clock})</td></tr>` : ''}`;
    }).join('');

    const title = kind === 'journey' ? 'Journey' : 'Trace';
    const idVal = kind === 'journey' ? D.JOURNEY : D.TRACE.t1;
    const summaryLine = kind === 'journey'
      ? `${list.length} events across ${services.length} services and ${traces.length} traces, same source, ascending by timestamp. Using journey correlation.`
      : `${list.length} events across ${services.length} services, same source, ascending by timestamp. Using trace correlation.`;

    return `<section class="column capture" aria-label="${title} investigation">
      <div class="mode-bar">
        <button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to search results<kbd>B</kbd></button>
        <h1>${title}<span class="val">${idVal}</span></h1>
        <div class="right"><button class="btn btn-ghost btn-sm">${I('copy', 'ic-sm')}Copy ${title.toLowerCase()} ID</button></div>
      </div>
      <div class="cap-summary">
        <span class="stat"><span class="k">Events</span><span class="v">${list.length}</span></span>
        <span class="stat"><span class="k">Services</span><span class="v">${services.length}</span></span>
        ${kind === 'journey' ? `<span class="stat"><span class="k">Traces</span><span class="v">${traces.length}</span></span>` : ''}
        <span class="stat"><span class="k">Errors</span><span class="v is-error">${count(list, 'ERROR')}</span></span>
        <span class="stat"><span class="k">Warnings</span><span class="v is-warn">${count(list, 'WARN')}</span></span>
        <span class="stat"><span class="k">First → last</span><span class="v mono">${list[0].utc} → ${list[list.length - 1].utc} UTC</span></span>
        <span class="stat"><span class="k">Observed span</span><span class="v mono">${fmtS(span)}</span></span>
        <span class="stat"><span class="k">Gaps</span><span class="v">${gaps.length}</span></span>
        ${o.tagStat || ''}
        <span class="stat"><span class="k">Selected event</span><span class="v">${rootIdx} of ${list.length}</span></span>
        <div class="cap-claim"><span>${summaryLine}</span><span class="note">${I('info')}Ordered by timestamp — this does not indicate causality between events. A gap means no event was observed in that interval, not that anything failed.</span></div>
      </div>
      <div class="scope-plot" role="img" aria-label="Timeline of ${list.length} events by service; the selected event is marked.">
        <div class="plot">
          <div class="axis-label">Offset</div><div class="ruler">${ticks(lo, hi, start, minor, major, (s) => (s === 0 ? '0 s' : `+${s} s`))}</div>
          ${brackets}
          <div class="lane-labels">${laneLabels}</div>
          <div class="lanes-area">${bands}${lanes}<span class="trigger-line" style="left:${pct(ROOT.sec)}"></span><span class="trigger-flag${parseFloat(pct(ROOT.sec)) > 80 ? ' end' : parseFloat(pct(ROOT.sec)) < 20 ? ' start' : ''}" style="left:${pct(ROOT.sec)}">${I('crosshair')}Selected event</span></div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="grid seq${o.tags ? ' has-tags' : ''}" aria-label="${title} events in timestamp order">
          <colgroup><col style="width:128px"><col style="width:92px"><col style="width:168px"><col style="width:66px"><col style="width:150px"><col>${o.tags ? '<col style="width:156px">' : ''}<col style="width:${kind === 'journey' ? 120 : 150}px"><col style="width:132px"></colgroup>
          <thead><tr><th scope="col" aria-sort="ascending">Time</th><th scope="col" style="text-align:right">Offset</th><th scope="col">Service</th><th scope="col">Level</th><th scope="col">Business step</th><th scope="col">What happened</th>${o.tags ? '<th scope="col">Tags</th>' : ''}<th scope="col">${kind === 'journey' ? 'Trace' : 'Span ID'}</th><th scope="col"><span class="vh">Actions</span></th></tr></thead>
          <tbody>${seqRows}</tbody>
        </table>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ context (surroundings)
  function contextView(o = {}) {
    const list = D.context;
    const lo = ROOT.sec - 30;
    const hi = ROOT.sec + 30;
    const pct = (s) => `${(((s - lo) / (hi - lo)) * 100).toFixed(3)}%`;
    const gaps = gapsOf(list, 5);
    const minus = '\u2212';
    const summary = `<div class="cap-summary" role="note" aria-label="Surrounding-context summary">
      <span class="stat"><span class="k">Events</span><span class="v">${list.length}</span></span>
      <span class="stat"><span class="k">Services</span><span class="v">1</span></span>
      <span class="stat"><span class="k">Errors</span><span class="v is-error">${count(list, 'ERROR')}</span></span>
      <span class="stat"><span class="k">Warnings</span><span class="v is-warn">${count(list, 'WARN')}</span></span>
      <span class="stat"><span class="k">Window</span><span class="v">60 s (±30 s)</span></span>
      <span class="stat"><span class="k">Observed span</span><span class="v mono">${fmtS(list[list.length - 1].sec - list[0].sec)}</span></span>
      <span class="stat"><span class="k">Range</span><span class="v mono">14:01:42.209 → 14:02:42.209</span></span>
      <span class="stat"><span class="k">Gaps</span><span class="v">${gaps.length}</span></span>
      <div class="cap-claim"><span>Scoped to service <strong>payments-api</strong> in Local Docker · payments-stack. Sorted oldest first.</span><span class="note">${I('info')}Nearby chronological evidence around the selected event — this order does not indicate causality.</span></div>
    </div>`;
    const plot = `<div class="window-plot" role="img" aria-label="60-second window with ${list.length} events and ${gaps.length} gaps; the selected event is at the centre.">
      <div class="plot">
        <div class="axis-label">Window</div><div class="ruler">${ticks(lo, hi, ROOT.sec, 5, 10, (s) => (s === 0 ? '0' : s < 0 ? `${minus}${Math.abs(s)} s` : `+${s} s`))}</div>
        <div class="lane-labels"><div class="lane-label"><span class="swatch" style="background:${laneColor('payments-api')}" aria-hidden="true"></span>payments-api</div></div>
        <div class="lanes-area">${gaps.map((g) => `<div class="gap-band" style="left:${pct(g.from.sec)};width:calc(${pct(g.to.sec)} - ${pct(g.from.sec)})"><span>${g.dur.toFixed(1)} s</span></div>`).join('')}<div class="lane">${list.map((e) => `<span class="pt${e.id === ROOT.id ? ' is-root' : ''}" style="left:${pct(e.sec)}" title="${e.clock} · ${e.level}">${sev(e.level)}</span>`).join('')}</div><span class="trigger-line" style="left:50%"></span><span class="trigger-flag" style="left:50%">${I('crosshair')}Selected event</span></div>
      </div>
    </div>`;
    return `<section class="column capture" aria-label="Surrounding logs">
      <div class="mode-bar">
        <button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}${o.from ? `Back to ${o.from}` : 'Back to original search'}<kbd>B</kbd></button>
        <h1>Surroundings<span class="val" style="font-family:var(--font-ui);font-weight:400;color:var(--ink-2)">±30 s around ${ROOT.clock} · payments-api</span></h1>
      </div>
      ${summary}${plot}
      ${resultsTable(list, { rootId: ROOT.id, fixedSort: true, gaps: true, label: 'Surrounding events, oldest first' })}
    </section>`;
  }

  // ------------------------------------------------------------------ more filters
  function filtersPanel(o = {}) {
    const f = (label, match, value, o = {}) => { const id = 'fp-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); return `<div class="fp-field"><label for="${id}">${label}</label><span class="match">${match}</span><input id="${id}" class="input${o.mono ? ' mono' : ''}" value="${esc(value || '')}" placeholder="${o.ph || ''}"></div>`; };
    return `<div class="filters-panel" role="dialog" aria-labelledby="fp-title"><h2 class="vh" id="fp-title" tabindex="-1">More filters</h2><div class="fp-scroll">
      <div class="fp-grid">
        <div class="fp-group"><h3>Who / customer <span class="tag tag-protected">${I('shield', 'ic-sm')}Protected</span></h3>
          ${f('User name', 'Exact match', '')}${f('Customer ID', 'Exact match', '')}${f('CIF', 'Exact match', '')}${f('Device ID', 'Exact match', '')}${f('Device IP', 'Exact match', '')}
          <p class="help">Matched on the server. Values you enter are never shown back in chips or results.</p></div>
        <div class="fp-group"><h3>Request flow</h3>
          ${f('Trace ID', 'Exact match', '', { mono: true })}${f('Span ID', 'Exact match', '', { mono: true })}${f('Correlation ID', 'Exact match', '', { mono: true })}${f('Journey ID', 'Exact match', '', { mono: true })}${f('Event ID', 'Exact match', '', { mono: true })}</div>
        <div class="fp-group"><h3>What happened</h3>
          ${f('Error code', 'Exact match', 'PAY-4102', { mono: true })}${f('Business step', 'Exact match', '', { mono: true })}${f('UI identifier', 'Exact match', '', { mono: true })}${f('Logger / class', 'Contains', '', { ph: 'e.g. AuthorizationService' })}${f('Message', 'Contains', '')}</div>
        <div class="fp-group"><h3>Client context</h3>
          ${f('Device platform', 'Exact match', '')}${f('Language', 'Exact match', '')}</div>
        ${tagGroup(o)}
      </div>
      <div class="fp-query">
        <span class="f-name">Advanced query</span>
        <div class="segmented" role="group" aria-label="Query mode"><button aria-pressed="${!o.raw}">Guided</button><button aria-pressed="false">Text</button>${o.loki ? `<button aria-pressed="${!!o.raw}">Raw LogQL</button>` : ''}</div>
        ${o.raw ? `<span class="note">${I('triangle-alert')}Advanced: executed directly against the source, bypassing the generated query. Off by default.</span>` : `<span class="query-preview">level = "ERROR" and service = "payments-api"</span>
        <button class="btn btn-secondary btn-sm">${I('pencil', 'ic-sm')}Edit query</button>`}
      </div>
      ${o.raw ? `<div class="fp-raw"><label class="lbl-field">Raw LogQL<textarea class="input mono" rows="2">{namespace="payments-uat", app="payments-api"} |= "PAY-4102"</textarea></label><p class="help" style="margin:0">Still bounded: the selected time range and result limit apply. Shown only because this Loki source enables Raw LogQL in its configuration.</p></div>` : ''}
      </div><div class="fp-actions">
        <span class="note">${I('info')}Draft — nothing changes until you apply. 1 field and a query set.</span>
        <button class="btn btn-ghost btn-sm">Reset</button>
        <button class="btn btn-secondary btn-sm">Cancel</button>
        <button class="btn btn-primary btn-sm">Apply</button>
      </div>
    </div>`;
  }

  function tagGroup(o = {}) {
    const tags = o.tagsEmpty ? [] : (D.CLS && D.CLS.tags) || [];
    const on = o.tagsChecked || [];
    const opts = tags.map((t) => `<span class="tag-option" role="checkbox" aria-checked="${on.includes(t)}" tabindex="0"><span class="box${on.includes(t) ? ' on' : ''}" aria-hidden="true">${on.includes(t) ? I('check') : ''}</span>${I('tag', 'ic-xs')}<span>${esc(t)}</span></span>`).join('');
    return `<div class="fp-group"><h3 id="fp-tags">Classification tags</h3>
      <div role="group" aria-labelledby="fp-tags" class="tag-options">${o.tagsError ? `<p class="inline-error" role="alert" style="margin:0">${I('circle-alert', 'ic-sm')}Could not load classification tags: ${esc(o.tagsError)}.</p>` : tags.length ? opts : '<p class="help" style="margin:0">No classification tags yet.</p>'}</div>
      <p class="help">Keeps events with <strong>any</strong> selected tag. Tags are applied by the server to the events a search reads; filtering does not read more history.</p></div>`;
  }

  // ------------------------------------------------------------------ field mapping
  function mapping(variant) {
    const editing = variant === 'editing';
    const needs = variant === 'needs';
    let fields = D.mapping.map((f) => Object.assign({}, f));
    const bs = fields.find((f) => f.key === 'businessStep');
    if (needs) bs.status = 'NEEDS_CHANGE';
    if (editing) bs.status = 'UNVERIFIED';
    if (needs) {
      const order = ['businessStep', 'uiIdentifier', 'deviceId'];
      fields = [...order.map((k) => fields.find((f) => f.key === k)), ...fields.filter((f) => !order.includes(f.key))];
    }
    const nNeeds = fields.filter((f) => f.status === 'NEEDS_CHANGE').length;
    const nUnmapped = fields.filter((f) => !f.paths.length).length;
    const nUnverified = fields.filter((f) => f.status === 'UNVERIFIED' && f.paths.length).length;
    const nVerified = fields.filter((f) => f.status === 'VERIFIED').length;
    const evidence = (f) => {
      if (!f.paths.length) return '<span class="evidence none">—</span>';
      if (!f.evidence) return `<span class="evidence none">${I('ban')}Not observed in latest scan</span>`;
      const p = Math.round((f.evidence.seen / f.evidence.of) * 100);
      return `<span class="evidence"><span class="bar" aria-hidden="true"><span style="width:${p}%"></span></span><span class="num">${f.evidence.seen} / ${f.evidence.of} events</span></span>`;
    };
    const status = (f) => {
      if (editing && f.key === 'businessStep') return `<span class="st-tag st-unverified">${I('circle-dashed')}Unverified</span> <span class="tag tag-unsaved">Unsaved</span>`;
      if (f.status === 'NEEDS_CHANGE') return `<span class="st-tag st-needs">${I('triangle-alert')}Needs change</span>`;
      if (f.status === 'UNVERIFIED') return `<span class="st-tag st-unverified">${I('circle-dashed')}Unverified</span>`;
      return `<span class="st-tag st-verified">${I('shield-check')}Verified</span>`;
    };
    const origin = (f) => (f.paths.length > 1 ? `${f.paths.length} candidate paths · first usable wins` : '');
    const rows = fields.map((f) => {
      const isEdit = editing && f.key === 'businessStep';
      const paths = isEdit
        ? '<span class="path">stepName</span><span class="path is-draft">mdc.businessStep</span>'
        : f.paths.length ? f.paths.map((p) => `<span class="path">${esc(p)}</span>`).join('') : '<span class="unmapped">Not mapped</span>';
      const edit = `<button class="btn btn-ghost btn-sm btn-icon" aria-label="Edit ${esc(f.field)} mapping" title="Edit mapping">${I('pencil', 'ic-sm')}</button>`;
      const more = `<button class="btn btn-ghost btn-sm btn-icon" aria-label="More actions for ${esc(f.field)}: Mark needs change" title="More actions">${I('ellipsis', 'ic-sm')}</button>`;
      const verifyBtn = isEdit ? '<button class="btn btn-secondary btn-sm" disabled title="Save this edit first — Verify checks the saved mapping">Verify</button>' : `<button class="btn btn-secondary btn-sm" aria-label="Verify ${esc(f.field)} against the latest scan">Verify</button>`;
      const action = !f.paths.length ? `<button class="btn btn-secondary btn-sm">${I('plus', 'ic-sm')}Map</button>` : f.status === 'VERIFIED' && !isEdit ? edit + more : verifyBtn + edit;
      let extra = '';
      if (isEdit) {
        extra = `<tr class="editor"><td colspan="5">
          <ol class="cand">
            <li><span class="idx">1</span><span><span class="path">stepName</span> <span class="origin" style="display:inline;margin-left:6px">observed in 151 of 200 samples</span></span><span></span><span><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move stepName up" disabled>${I('arrow-up', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move stepName down">${I('arrow-down', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Remove stepName">${I('x', 'ic-sm')}</button></span></li>
            <li><span class="idx">2</span><span><span class="path is-draft">mdc.businessStep</span> <span class="origin" style="display:inline;margin-left:6px">observed in 96 of 200 samples · used when stepName is empty</span></span><span class="tag tag-unsaved">Added</span><span><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move mdc.businessStep up">${I('arrow-up', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Move mdc.businessStep down" disabled>${I('arrow-down', 'ic-sm')}</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Remove mdc.businessStep">${I('x', 'ic-sm')}</button></span></li>
          </ol>
          <div class="editor-row"><label class="vh" for="pick">Add a discovered path</label><select id="pick" class="input" style="max-width:320px"><option>Select a discovered path…</option></select><button class="btn btn-secondary btn-sm">Add</button><button class="btn btn-ghost btn-sm">${I('pencil', 'ic-sm')}Enter a path manually</button></div>
          <div class="validation">${I('circle-check')}<span>Valid path syntax. First usable candidate wins — found in <strong>158 of 200</strong> samples: <code>AUTHORIZE_PAYMENT</code>, <code>RESERVE_FUNDS</code>, <code>SEND_RECEIPT</code>.</span></div>
          <div class="editor-row" style="margin-top:10px"><button class="btn btn-secondary btn-sm" disabled>Verify</button><button class="btn btn-ghost btn-sm">${I('triangle-alert', 'ic-sm')}Mark needs change</button><span class="note">${I('info')}Verify is unavailable until this edit is saved — it checks the saved mapping against real samples.</span></div>
        </td></tr>`;
      }
      if (needs && f.key === 'businessStep') extra = `<tr class="editor"><td colspan="5"><p class="note" style="color:var(--ink-2)">${I('triangle-alert')}Marked as needing change. Editing keeps this status until a later Verify succeeds against real samples; a save alone never marks it Verified.</p></td></tr>`;
      if (needs && f.key === 'uiIdentifier') extra = `<tr class="editor"><td colspan="5"><p class="note" style="color:var(--ink-2)">${I('info')}<span>No default mapping. The discovered path <code class="path">uiElement</code> appears in 118 of 200 samples — it is offered as a suggestion only and is never assigned automatically.</span></p></td></tr>`;
      const cls = [isEdit ? 'is-editing' : '', needs && f.status === 'NEEDS_CHANGE' ? 'needs' : ''].join(' ');
      return `<tr class="${cls}"><td><span class="f-name">${esc(f.field)}</span>${f.protected ? ' <span class="tag tag-protected">Protected</span>' : ''}<span class="f-key">${f.key}</span></td>
        <td>${paths}${isEdit ? '<span class="origin">Edited · 1 candidate added</span>' : origin(f) ? `<span class="origin">${origin(f)}</span>` : ''}</td>
        <td>${evidence(f)}</td><td>${status(f)}</td><td class="c-act">${action}</td></tr>${extra}`;
    }).join('');

    const schemaRows = D.schema.slice(0, 16).map(([p, t, s]) => `<tr><td class="p">${esc(p)}</td><td class="t">${t}</td><td class="n">${s}</td><td class="n">${Math.round((s / 200) * 100)}%</td></tr>`).join('');
    return `<section class="column mapping" aria-label="Log schema and field mapping">
      <div class="ws-head">
        <div class="row">
          <button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to search results</button>
          <h1>Log schema &amp; field mapping</h1>
          ${editing ? `<span class="readiness blocked">${I('triangle-alert', 'ic-sm')}Search disabled — unsaved mapping edits</span>` : `<span class="readiness ok">${I('circle-check', 'ic-sm')}Search ready</span>`}
        </div>
        <p class="ws-sub">How raw JSON from <strong>Local Docker · payments-stack</strong> maps to canonical fields. Owner-approved defaults are trusted as Verified; any edit needs real sample evidence before it is Verified again. Nothing here applies to another project.</p>
        <div class="process" aria-label="Mapping workflow">
          <span class="step done"><span class="n">${I('check')}</span>Scan samples <span class="st">200 events</span></span><span class="step-line"></span>
          <span class="step${editing ? ' done' : ' current'}"><span class="n">2</span>Map fields <span class="st">${nVerified} verified · ${nUnverified} unverified · ${nNeeds} needs change · ${nUnmapped} not mapped</span></span><span class="step-line"></span>
          <span class="step${editing ? ' done' : ''}"><span class="n">3</span>Validate <span class="st">${editing ? 'passed for current draft' : 'not needed — no edits'}</span></span><span class="step-line"></span>
          <span class="step${editing ? ' current' : ''}"><span class="n">4</span>Save <span class="st">${editing ? '1 unsaved field' : 'saved'}</span></span><span class="step-line"></span>
          <span class="step"><span class="n">5</span>Verify <span class="st">${editing ? 'after save' : 'per field, against the latest scan'}</span></span>
        </div>
      </div>
      <div class="map-body">
        <div class="map-main">
          <div class="map-toolbar">
            <div class="segmented" role="group" aria-label="Show fields"><button aria-pressed="${!needs}">All <span class="num">25</span></button><button aria-pressed="${needs}">Needs attention <span class="num">${nNeeds + nUnmapped + nUnverified}</span></button><button aria-pressed="false">Unsaved <span class="num">${editing ? 1 : 0}</span></button></div>
            <span class="legend"><span><strong style="color:var(--ink-2);font-weight:500">Status</strong> = trusted or checked against samples</span><span><strong style="color:var(--ink-2);font-weight:500">Evidence</strong> = seen in the latest scan</span></span>
          </div>
          <div class="map-scroll" tabindex="0" role="region" aria-label="Field mapping table">
            <table class="grid fields" aria-label="Canonical field mappings">
              <colgroup><col style="width:180px"><col><col style="width:160px"><col style="width:176px"><col style="width:140px"></colgroup>
              <thead><tr><th scope="col">Canonical field</th><th scope="col">Mapped path</th><th scope="col">Path seen · latest scan</th><th scope="col">Status</th><th scope="col"><span class="vh">Actions</span></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="action-bar">
            <span class="status">${editing ? `${I('circle-check', 'ic-sm')}Draft validated against 200 samples · 1 unsaved field` : `${I('circle-check', 'ic-sm')}Saved mapping in use for search`}</span>
            <div class="push">
              <button class="btn btn-ghost">${I('rotate-ccw')}Reset to defaults</button>
              <button class="btn btn-secondary">${I('scan-search')}Validate mapping</button>
              <button class="btn btn-primary"${editing ? '' : ' disabled'}>Save mapping</button>
            </div>
          </div>
        </div>
        <aside class="map-evidence" aria-label="Scan evidence" tabindex="0">
          <h2 class="sec-h">Original event sample<span class="aside">3 of 5 representative</span></h2>
          <div class="editor-row" style="margin:0 0 8px"><label class="vh" for="sample">Sample</label><select id="sample" class="input"><option>Sample 3 — ERROR · payments-api</option></select><button class="btn btn-ghost btn-sm">${I('rotate-cw', 'ic-sm')}Rescan</button></div>
          <p class="note" style="margin-bottom:8px">${I('eye-off')}Source JSON exactly as read from this scope — shown for mapping only and never persisted.</p>
          <pre class="code" tabindex="0" aria-label="Original event sample JSON">${highlightJson(D.sample)}</pre>
          <h2 class="sec-h">Discovered schema<span class="aside num">${D.schema.length} paths</span></h2>
          <table class="grid schema"><colgroup><col><col style="width:62px"><col style="width:46px"><col style="width:52px"></colgroup><thead><tr><th scope="col">Path</th><th scope="col">Type</th><th scope="col" style="text-align:right">Seen</th><th scope="col" style="text-align:right">Cover</th></tr></thead><tbody>${schemaRows}</tbody></table>
          <p class="help">Observed in this scan of 200 events — not a guaranteed-complete schema.</p>
        </aside>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ settings
  function settingsNav(current, o = {}) {
    const item = (k, icon, label, aside) => `<button class="nav-item"${current === k ? ' aria-current="page"' : ''}>${I(icon)}${label}${aside ? `<span class="aside">${aside}</span>` : ''}</button>`;
    return `<nav class="set-nav" aria-label="Settings sections">
      ${item('sources', 'database', 'Sources &amp; connections')}${item('masking', 'shield', 'Privacy &amp; masking')}${item('proxy', 'globe', 'Network proxy')}
      <div class="nav-sep" role="separator"></div>${item('mapping', 'scan-search', 'Field mapping')}${item('classification', 'tags', 'Classification rules', o.rulesCount)}${item('shortcuts', 'keyboard', 'Keyboard shortcuts')}
    </nav>`;
  }
  function settings(section) {
    const dockerPanel = `<div class="panel">
      <div class="panel-head"><h2>Local Docker</h2><span class="scope-tag">${I('box')}Docker source only</span><span class="conn-state"><span class="health-dot" aria-hidden="true"></span>Reachable</span><span class="right"><span class="ro-tag">${I('lock')}Read-only · set by deployment configuration</span></span></div>
      <div class="panel-body"><dl class="kv readonly">
        <dt>Mode</dt><dd>Local engine</dd><dt>Connection name</dt><dd><span style="color:var(--ink-3)">None</span></dd><dt>TLS</dt><dd>Disabled</dd><dt>Compose project filter</dt><dd>None configured — every Compose project is visible</dd>
      </dl></div>
      <div class="sub-panel"><h3>Test a connection</h3><p class="help" style="margin:-4px 0 10px">Checks reachability only. It does not change the running configuration.</p>
        <div class="form-grid">
          <div class="lbl-field">Mode<div class="segmented"><button aria-pressed="false">Local</button><button aria-pressed="true">Remote</button></div></div>
          <label class="lbl-field span-2">Host<input class="input mono" value="docker-host.example.internal"></label>
          <label class="lbl-field">Port<input class="input mono" value="2376"></label>
          <div class="lbl-field span-2">TLS<button class="switch" role="switch" aria-checked="true"><span class="track"></span><span class="word">On — certificate verification always required</span></button></div>
          <label class="lbl-field span-2">Certificate directory (server filesystem)<input class="input mono" value="/etc/log-explorer/docker-certs"></label>
        </div>
        <div class="editor-row" style="margin-top:12px"><button class="btn btn-secondary">${I('plug')}Test connection</button><span class="conn-state">${I('circle-check', 'ic-sm')}Reachable: the Docker engine responded</span></div>
      </div>
    </div>`;
    const osPanel = `<div class="panel">
      <div class="panel-head"><h2>OpenShift</h2><span class="scope-tag">${I('server')}OpenShift sources only</span><span class="conn-state"><span class="health-dot" aria-hidden="true"></span>Connected</span><span class="right"><button class="btn btn-danger btn-sm">Disconnect</button></span></div>
      <div class="panel-body"><dl class="kv">
        <dt>Server</dt><dd class="mono">https://api.ocp-shared.example.com:6443</dd><dt>User</dt><dd class="mono">developer-ops</dd><dt>TLS</dt><dd>Verified (private certificate authority)</dd><dt>Proxy</dt><dd>System proxy</dd><dt>Projects</dt><dd class="num">4 available</dd>
      </dl></div>
      <div class="sub-panel"><h3>Investigation scope</h3>
        <div class="form-grid two">
          <label class="lbl-field">Project<select class="input"><option>payments-uat</option></select></label>
          <label class="lbl-field">Workload<select class="input"><option>Deployment · payments-api</option></select></label>
          <label class="lbl-field">Pod<select class="input"><option>All matching pods</option></select></label>
          <label class="lbl-field">Container<select class="input"><option>All applicable containers</option></select></label>
        </div>
      </div>
    </div>`;
    const osConnect = `<div class="panel">
      <div class="panel-head"><h2>OpenShift</h2><span class="scope-tag">${I('server')}OpenShift sources only</span><span class="conn-state" style="color:var(--ink-2)"><span class="health-dot h-checking" aria-hidden="true"></span>Not connected</span></div>
      <div class="panel-body">
        <div class="form-grid two">
          <label class="lbl-field">Connection name (optional)<input class="input" placeholder="Production OpenShift" value="Shared UAT cluster"></label><span></span>
          <label class="lbl-field span-2">Paste your oc login command<textarea class="input mono" rows="2">oc login --token=sha256~•••••••• --server=https://api.ocp-shared.example.com:6443 --insecure-skip-tls-verify=true</textarea></label>
        </div>
        <p class="inline-error" role="alert" style="margin:8px 0 0">${I('circle-alert', 'ic-sm')}This command turns off TLS certificate verification (--insecure-skip-tls-verify). Log Explorer always verifies certificates — remove that option and paste the command again.</p>
        <div class="editor-row" style="margin-top:10px"><button class="btn btn-primary" disabled>Connect</button></div>
      </div>
    </div>`;
    const maskingPanel = `<div class="panel" id="masking">
      <div class="panel-head"><h2>Privacy &amp; masking</h2><span class="scope-tag global">${I('globe')}All sources</span><span class="right"><span class="ro-tag">Applies to new requests only</span></span></div>
      <div class="banner is-warning">${I('triangle-alert')}<span><strong>Device IP is unmasked.</strong> New search results and event details may show real device IP values. Already-rendered values do not change.</span></div>
      ${[['CIF', true], ['Username', true], ['Customer ID', true], ['Device ID', true], ['Device IP', false]].map(([n, on]) => `<div class="switch-row"><span class="t">${n}</span><button class="switch" role="switch" aria-checked="${on}" aria-label="Mask ${n}"><span class="track"></span><span class="word">${on ? 'Masked' : 'Unmasked'}</span></button><span class="d">${on ? 'Masked on the server before any response leaves the backend.' : 'Off — new responses include this value unmasked.'}</span></div>`).join('')}
      <div class="banner is-info" style="border-top:1px solid var(--line-subtle);border-bottom:0">${I('info')}<span>Fresh installations start with masking off for all five fields. There is no per-row reveal action anywhere in Log Explorer.</span></div>
    </div>`;
    const proxyPanel = `<div class="panel" id="proxy">
      <div class="panel-head"><h2>Network proxy</h2><span class="scope-tag">${I('server')}OpenShift API and Loki</span></div>
      <div role="radiogroup" aria-label="Proxy mode"><div class="radio-row"><span class="radio on" role="radio" aria-checked="true" tabindex="0" aria-labelledby="px1"></span><span class="t" id="px1">Use system proxy</span><span class="d">Honours <code>HTTPS_PROXY</code>, <code>HTTP_PROXY</code> and <code>NO_PROXY</code> from the backend environment. Default.</span></div>
      <div class="radio-row"><span class="radio" role="radio" aria-checked="false" tabindex="-1" aria-labelledby="px2"></span><span class="t" id="px2">Direct connection</span><span class="d">Bypass any proxy.</span></div>
      <div class="radio-row"><span class="radio" role="radio" aria-checked="false" tabindex="-1" aria-labelledby="px3"></span><span class="t" id="px3">Custom proxy</span><span class="d">One setting shared by the OpenShift API and Loki.</span>
        <div class="extra"><label class="lbl-field">Proxy server<input class="input mono" placeholder="proxy.example.internal" style="width:260px"></label><label class="lbl-field">Port<input class="input mono" placeholder="3128" style="width:90px"></label><button class="btn btn-secondary" disabled>Apply proxy</button></div></div></div>
      <div class="banner is-info" style="border-top:1px solid var(--line-subtle);border-bottom:0">${I('lock')}<span>TLS certificate verification stays on for OpenShift and Loki in every proxy mode.</span></div>
    </div>`;
    const content = section !== 'masking'
      ? `<h1>Sources &amp; connections</h1><p class="ws-sub">Connection settings are per source. Log Explorer only reads from these sources — nothing here writes to Docker or OpenShift.</p>${section === 'connect' ? osConnect + dockerPanel : dockerPanel + osPanel}`
      : `<h1>Privacy &amp; network</h1><p class="ws-sub">Global masking policy and the proxy used for OpenShift connections.</p>${maskingPanel}${proxyPanel}`;
    return `<section class="column" aria-label="Settings"><div class="mode-bar"><button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to search results</button><h1>Settings</h1></div>
      <div class="settings">${settingsNav(section === 'masking' ? 'masking' : 'sources')}<div class="set-content">${content}</div></div></section>`;
  }

  // ------------------------------------------------------------------ live
  function live(variant, o = {}) {
    const badge = {
      live: `<span class="acq acq-live"><span class="pulse" aria-hidden="true"></span>Live</span>`,
      paused: `<span class="acq acq-paused">${I('pause')}Paused</span>`,
      reconnecting: `<span class="acq acq-reconnecting">${I('refresh-cw')}Reconnecting · attempt 2 of 5</span>`,
      failed: `<span class="acq acq-failed">${I('circle-alert')}Connection failed</span>`,
    }[variant];
    const controls = {
      live: `<button class="btn btn-secondary btn-sm">${I('pause', 'ic-sm')}Pause<kbd>P</kbd></button><button class="btn btn-secondary btn-sm">${I('square', 'ic-sm')}Stop<kbd>S</kbd></button><button class="btn btn-ghost btn-sm">Clear<kbd>C</kbd></button><button class="btn btn-ghost btn-sm" aria-pressed="true">${I('check', 'ic-sm')}Follow newest<kbd>F</kbd></button>`,
      paused: `<button class="btn btn-primary btn-sm">${I('play', 'ic-sm')}Resume<kbd>P</kbd></button><button class="btn btn-secondary btn-sm">${I('square', 'ic-sm')}Stop<kbd>S</kbd></button><button class="btn btn-ghost btn-sm">Clear<kbd>C</kbd></button><button class="btn btn-ghost btn-sm" aria-pressed="false">Follow newest<kbd>F</kbd></button>`,
      reconnecting: `<button class="btn btn-secondary btn-sm">${I('square', 'ic-sm')}Stop<kbd>S</kbd></button><button class="btn btn-ghost btn-sm">Clear<kbd>C</kbd></button><button class="btn btn-ghost btn-sm" aria-pressed="true">${I('check', 'ic-sm')}Follow newest<kbd>F</kbd></button>`,
      failed: `<button class="btn btn-primary btn-sm">${I('rotate-cw', 'ic-sm')}Retry</button><button class="btn btn-ghost btn-sm">Clear<kbd>C</kbd></button>`,
    }[variant];
    const counts = {
      live: [['Received', '1,284'], ['Visible', '412 of 1,284 retained'], ['Buffered while paused', '0'], ['Evicted (retention cap)', '0'], ['Dropped (server buffer full)', '0']],
      paused: [['Received', '1,320'], ['Visible', '412 of 1,284 retained'], ['Buffered while paused', '36'], ['Evicted (retention cap)', '0'], ['Dropped (server buffer full)', '0']],
      reconnecting: [['Received', '1,284'], ['Visible', '412 of 1,284 retained'], ['Buffered while paused', '0'], ['Evicted (retention cap)', '0'], ['Dropped (server buffer full)', '0']],
      failed: [['Received', '1,284'], ['Visible', '412 of 1,284 retained'], ['Buffered while paused', '0'], ['Evicted (retention cap)', '0'], ['Dropped (server buffer full)', '0']],
    }[variant];
    const note = variant === 'failed'
      ? `<div class="live-note is-danger" role="alert">${I('circle-alert')}<span>Live connection lost after 5 reconnect attempts. Click Retry to try again. The source health check is separate from the Live stream, so the source can still report Healthy.</span></div>`
      : variant === 'reconnecting'
      ? `<div class="live-note is-warning">${I('wifi-off')}<span>Connection to Local Docker lost — reconnecting. Events sent while disconnected may be missed; nothing already shown is removed.</span></div>`
      : `<div class="live-note">${I('info')}<span>Showing events received since Start — not a complete historical record. The newest 2,000 events are kept; the oldest are evicted first.</span></div>`;
    const rows = D.live.map((e, i) => `<tr class="${e.level === 'ERROR' ? 'is-error' : ''}${variant === 'reconnecting' && i < 0 ? '' : ''}" tabindex="${i === 0 ? 0 : -1}">
      <td class="c-time">${sev(e.level, 'sev-mark')}<span class="d">${e.date || '15 Sep'}</span> <span class="c">${e.clock}</span></td>
      <td><span class="lvl lvl-${e.level}">${e.level}</span></td>
      <td><span class="svc-cell"><span class="swatch" style="background:${laneColor(e.service)}" aria-hidden="true"></span>${esc(e.service)}</span></td>
      <td class="c-msg">${esc(e.message)}</td>
      ${o.tags ? tagCell({ tags: o.tags(e) }) : ''}
      <td class="mono" style="color:var(--ink-3)">${e.trace.slice(0, 8)}…</td>
    </tr>`).join('');
    return `<section class="column" aria-label="Live">
      <div class="mode-bar">
        <button class="btn btn-secondary btn-sm">${I('arrow-left', 'ic-sm')}Back to search results</button>
        <h1>Live · Local Docker</h1>${badge}
        <div class="right">${controls}</div>
      </div>
      <div class="live-counts num" aria-live="off">${counts.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}</div>
      ${note}${o.extraNote || ''}
      <div class="live-filter"><div class="segmented" role="group" aria-label="Displayed severity"><button aria-pressed="false">Debug</button><button aria-pressed="true">${sev('INFO')}Info</button><button aria-pressed="true">${sev('WARN')}Warn</button><button aria-pressed="true">${sev('ERROR')}Error</button></div><label class="search-input">${I('filter', 'ic-sm')}<span class="vh">Filter displayed events</span><input placeholder="Filter displayed events…"></label><span class="note">Display filter only — does not change what is received.</span></div>
      <div class="table-wrap">
        ${variant === 'paused' ? `<div class="jump"><button class="btn btn-secondary btn-sm">${I('arrow-up', 'ic-sm')}Jump to newest · 36 new</button></div>` : ''}
        <table class="grid live-grid${o.tags ? ' has-tags' : ''}" aria-label="Live events, newest first"><colgroup><col style="width:172px"><col style="width:70px"><col style="width:180px"><col>${o.tags ? '<col style="width:156px">' : ''}<col style="width:120px"></colgroup>
          <thead><tr><th scope="col" aria-sort="descending">Time</th><th scope="col">Level</th><th scope="col">Service</th><th scope="col">What happened</th>${o.tags ? '<th scope="col">Tags</th>' : ''}<th scope="col">Trace</th></tr></thead>
          <tbody class="${['reconnecting', 'failed'].includes(variant) ? 'is-stale-body' : ''}">${rows}</tbody></table>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ small layers (menus, detection, custom range)
  function rowMenu(idx) {
    const top = 30 + (idx + 1) * 28 + 2;
    return `<div class="menu" role="menu" aria-label="Event actions" style="top:${top}px;right:10px">
      <button role="menuitem" class="is-active">${I('info')}View details<span class="mi-meta">Enter</span></button>
      <button role="menuitem">${I('history')}Show surroundings<span class="mi-meta">X</span></button>
      <hr>
      <button role="menuitem">${I('copy')}Copy Trace ID</button>
      <button role="menuitem">${I('copy')}Copy Span ID</button>
      <button role="menuitem">${I('copy')}Copy Correlation ID</button>
      <button role="menuitem">${I('copy')}Copy Journey ID</button>
      <button role="menuitem">${I('copy')}Copy Event ID</button>
    </div>`;
  }
  function idDetect() {
    return `<div class="id-detect" role="status">${I('waypoints')}<span>This looks like a <strong>Trace ID</strong>. Search as Trace ID instead?</span><button class="btn btn-secondary btn-sm">Search as Trace ID</button><button class="btn btn-ghost btn-sm btn-icon" aria-label="Dismiss (Esc)">${I('x')}</button></div>`;
  }
  function customRangePopover() {
    return `<div class="popover" role="dialog" aria-label="Custom time range" style="width:420px">
      <div class="pop-head"><h2>Custom time range</h2><span style="margin-left:auto;color:var(--ink-3);font:var(--text-meta)">Asia/Kuwait (UTC+03:00)</span></div>
      <div class="pop-body">
        <div class="form-grid two">
          <label class="lbl-field">Start<input class="input mono" value="2026-09-14 14:02"></label>
          <label class="lbl-field">End<input class="input mono" value="2026-09-15 14:02"></label>
        </div>
        <p class="range-summary">Prefilled from the current preset: End is now, Start is End − 1 day. Times are in Asia/Kuwait (UTC+03:00) and are converted to UTC once, when you apply.</p>
      </div>
      <div class="pop-foot"><button class="btn btn-ghost btn-sm">Cancel</button><button class="btn btn-primary btn-sm">Apply</button></div>
    </div>`;
  }

  // ------------------------------------------------------------------ page composition
  function page(o) {
    return `<div class="app">${shell(o.shell)}<div class="chrome"${o.chrome ? ' role="region" aria-label="Scope and filters"' : ''}>${o.chrome || ''}${o.overlay || ''}</div><main class="work"${o.overlay && o.overlay.includes('filters-panel') ? ' inert' : ''}>${o.column}${o.inspector || ''}</main></div>`;
  }
  const LOAD_MORE = `<div class="load-more"><span class="num"><strong style="color:var(--ink-1)">${D.results.length}</strong> events loaded · more available</span><button class="btn btn-secondary btn-sm">${I('chevron-down', 'ic-sm')}Load more</button></div>`;
  const results = (o = {}) => `<section class="column${o.withInspector ? ' with-inspector' : ''}" aria-label="Search results"><h1 class="vh">Search results</h1>${o.before || ''}${o.table || resultsTable(D.results, Object.assign({ after: LOAD_MORE }, o))}${o.menu || ''}</section>`;
  const searchChrome = (q = {}, s = {}) => queryBar(q) + scopeStrip(Object.assign({}, s, { exclude: q.exclude, running: q.running }));

  const STATES = [
    ['01-search-results', 'Search + populated results', () => page({ shell: {}, chrome: searchChrome(), column: results() })],
    ['02-search-running', 'Search running (re-search, previous rows held)', () => page({ shell: {}, chrome: queryBar({ running: true }) + scopeStrip({ running: true, readout: 'Searching Local Docker · payments-stack · last 1 day<span class="sep">·</span>previous results shown until it returns' }), column: results({ stale: true }) })],
    ['03-search-error', 'Search error', () => page({ shell: {}, chrome: searchChrome({}, { readout: 'Search did not complete' }), column: `<section class="column"><h1 class="vh">Search results</h1>${stateError()}</section>` })],
    ['04-inspector-overview', 'Results + Inspector — Overview', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'overview') })],
    ['05-inspector-actor', 'Inspector — Actor & client', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'actor') })],
    ['06-inspector-request-flow', 'Inspector — Request flow', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'flow') })],
    ['07-inspector-business-error', 'Inspector — Business / error', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'business') })],
    ['08-inspector-technical', 'Inspector — Technical / all fields', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'technical') })],
    ['09-investigation-trace', 'Investigation — Trace', () => page({ shell: { trail: ['Search', 'Trace'] }, chrome: compactScope('Search filters are kept — return with Back'), column: capture('trace') })],
    ['10-investigation-journey', 'Investigation — Journey across three traces', () => page({ shell: { trail: ['Search', 'Journey'] }, chrome: compactScope('Search filters are kept — return with Back'), column: capture('journey') })],
    ['11-context-surroundings', 'Surrounding context (±30 s)', () => page({ shell: { trail: ['Search', 'Surroundings'] }, chrome: compactScope('Original search is kept — return with Back', { noTime: true }), column: contextView() })],
    ['12-more-filters', 'More filters (draft)', () => page({ shell: {}, chrome: queryBar({ moreOpen: true, filterCount: 0 }) + scopeStrip(), overlay: filtersPanel(), column: results() })],
    ['13-mapping-workspace', 'Field mapping workspace', () => page({ shell: { trail: ['Field mapping'], active: 'mapping' }, chrome: compactScope('Mapping is scoped to this source and project', { noTime: true, edit: false }), column: mapping('default') })],
    ['14-mapping-editing', 'Field mapping — field being edited', () => page({ shell: { trail: ['Field mapping'], active: 'mapping' }, chrome: compactScope('Mapping is scoped to this source and project', { noTime: true, edit: false }), column: mapping('editing') })],
    ['15-mapping-needs-change-unmapped', 'Field mapping — Needs change + Not mapped', () => page({ shell: { trail: ['Field mapping'], active: 'mapping' }, chrome: compactScope('Mapping is scoped to this source and project', { noTime: true, edit: false }), column: mapping('needs') })],
    ['16-settings-sources', 'Settings — sources & connections', () => page({ shell: { trail: ['Settings'], active: 'settings' }, chrome: '', column: settings('sources') })],
    ['17-settings-masking-proxy', 'Settings — privacy & network proxy', () => page({ shell: { trail: ['Settings'], active: 'settings' }, chrome: '', column: settings('masking') })],
    ['18-live', 'Live — LIVE', () => page({ shell: { trail: ['Live'] }, chrome: compactScope('Live shows new events for this source and project', { noTime: true, services: 'All services' }), column: live('live') })],
    ['19-live-paused', 'Live — PAUSED', () => page({ shell: { trail: ['Live'] }, chrome: compactScope('Live shows new events for this source and project', { noTime: true, services: 'All services' }), column: live('paused') })],
    ['19b-live-reconnecting', 'Live — RECONNECTING', () => page({ shell: { trail: ['Live'] }, chrome: compactScope('Live shows new events for this source and project', { noTime: true, services: 'All services', health: 'checking' }), column: live('reconnecting') })],
    ['20-empty', 'No results', () => page({ shell: {}, chrome: searchChrome({ text: 'reservation rsv-0000' }, { readout: '<strong>0</strong> events', chips: ['<span class="chip is-protected">Customer ID <b>Protected</b><button class="x" aria-label="Remove Customer ID filter"><svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg></button></span>', '<span class="chip">Text <b>“reservation rsv-0000”</b><button class="x" aria-label="Remove text filter"><svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg></button></span>'] }), column: `<section class="column"><h1 class="vh">Search results</h1>${stateEmpty()}</section>` })],
    ['21-first-search-running', 'First search running (skeleton)', () => page({ shell: {}, chrome: queryBar({ running: true }) + scopeStrip({ running: true, noClear: true, readout: 'Searching Local Docker · payments-stack · last 1 day' }), column: `<section class="column"><h1 class="vh">Search results</h1>${skeletonTable(18)}</section>` })],
    ['22-source-unavailable', 'Source unavailable', () => page({ shell: {}, chrome: queryBar({ health: 'down' }) + scopeStrip({ readout: 'No results loaded' }), column: `<section class="column"><h1 class="vh">Search results</h1>${stateUnavailable()}</section>` })],
    ['23-no-services', 'No services reported', () => page({ shell: {}, chrome: queryBar({ servicesOpen: true, noServices: true, exclude: false }) + scopeStrip({ exclude: false }), column: results() })],
    ['24-load-more-failure', 'Partial results + Load more failure', () => page({ shell: {}, chrome: searchChrome(), column: results({ after: `<div class="load-more"><span class="num"><strong style="color:var(--ink-1)">${D.results.length}</strong> events loaded · more available</span><span class="inline-error" role="alert">${I('circle-alert', 'ic-sm')}Could not load more: the request timed out. Loaded rows are kept.</span><button class="btn btn-secondary btn-sm">${I('rotate-cw', 'ic-sm')}Retry</button></div>` }) })],
    ['25-malformed-event', 'Malformed event selected', () => { const m = D.results.find((e) => e.malformed); return page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: m.id, withInspector: true }), inspector: inspector(m, 'overview', { noContext: false }) }); }],
    ['26-mapping-not-ready', 'Search gated by unsaved mapping', () => page({ shell: {}, chrome: queryBar({ notReady: true }) + `<div class="qb-gate" role="status">${I('triangle-alert', 'ic-sm')}<span>Search is disabled — the field mapping for <strong>payments-stack</strong> has unsaved edits. Validate and save it, or reset to defaults.</span><a href="#">Open field mapping</a></div>` + scopeStrip({ readout: 'Previous results' }), column: results({ stale: true }) })],
    ['27-unsupported-capability', 'Source without Live or context (Loki) — reference only: Loki is not selectable today (SSEL-2)', () => page({ shell: {}, chrome: queryBar({ source: 'loki', healthOpen: true, exclude: false }) + scopeStrip({ exclude: false }), column: results({ selectedId: ROOT.id, withInspector: true }), inspector: inspector(ROOT, 'overview', { noContext: true, loki: true }) })],
    ['28-invalid-query', 'Invalid query', () => page({ shell: {}, chrome: queryBar({ filterCount: 1 }) + scopeStrip({ readout: 'Search did not run', chips: ['<span class="chip">Query <b class="mono">level = and service = "payments-api"</b></span>'] }), column: `<section class="column"><h1 class="vh">Search results</h1>${stateInvalidQuery()}</section>` })],
    ['29-services-exclude-open', 'Services picker — Exclude mode', () => page({ shell: {}, chrome: queryBar({ servicesOpen: true }) + scopeStrip(), column: results() })],
    ['30-columns-settings', 'Table settings open', () => page({ shell: {}, chrome: queryBar() + scopeStrip({ columnsOpen: true }), column: results() })],
    ['31-startup', 'Startup (sources loading)', () => page({ shell: {}, chrome: queryBar({ sourceName: 'Loading sources…', health: 'checking', searchDisabled: 'Waiting for the source list', exclude: false }) + scopeStrip({ exclude: false, noClear: true, readout: 'No search yet' }), column: `<section class="column"><h1 class="vh">Search results</h1>${stateStartup()}</section>` })],
    ['32-time-custom-range', 'Time range — custom editor open', () => page({ shell: {}, chrome: queryBar({ customOpen: true }) + scopeStrip(), column: results() })],
    ['33-time-custom-applied', 'Time range — custom range applied (actual interval + zone)', () => page({ shell: {}, chrome: queryBar({ timeLabel: '14 Sep 09:00 → 15 Sep 14:00 · UTC+03:00', timeAria: 'Custom, 14 Sep 2026 09:00 to 15 Sep 2026 14:00, Asia/Kuwait (UTC+03:00)' }) + scopeStrip({ timeLabel: '14 Sep 09:00 → 15 Sep 14:00', timeRange: 'UTC+03:00' }), column: results() })],
    ['34-raw-logql-loki', 'More filters — Raw LogQL (Loki source only) — reference only: Loki is not selectable today (SSEL-2)', () => page({ shell: {}, chrome: queryBar({ source: 'loki', moreOpen: true, exclude: false }) + scopeStrip({ exclude: false }), overlay: filtersPanel({ loki: true, raw: true }), column: results() })],
    ['35-row-actions-menu', 'Row actions menu', () => page({ shell: {}, chrome: searchChrome(), column: results({ selectedId: ROOT.id, menu: rowMenu(D.results.indexOf(ROOT)) }) })],
    ['36-id-detection', 'Pasted ID detected — search as Trace ID', () => page({ shell: {}, chrome: queryBar({ text: D.TRACE.t1 }) + idDetect() + scopeStrip(), column: results() })],
    ['37-surroundings-from-trace', 'Surroundings opened from a Trace (Back to Trace)', () => page({ shell: { trail: ['Search', 'Trace', 'Surroundings'] }, chrome: compactScope('Trace and original search are kept — return with Back', { noTime: true }), column: contextView({ from: 'Trace' }) })],
    ['38-live-failed', 'Live — CONNECTION FAILED', () => page({ shell: { trail: ['Live'] }, chrome: compactScope('Live shows new events for this source and project', { noTime: true, services: 'All services' }), column: live('failed') })],
    ['39-settings-openshift-connect', 'Settings — OpenShift not connected (oc login validation)', () => page({ shell: { trail: ['Settings'], active: 'settings' }, chrome: '', column: settings('connect') })],
  ];

  if (typeof window.LX_EXT === 'function') {
    STATES.push(...window.LX_EXT({ D, I, esc, sev, short, page, shell, queryBar, scopeStrip, searchChrome, resultsTable, results, inspector, compactScope, settingsNav, filtersPanel, capture, live, LOAD_MORE, ROOT, tagCell, tagClass, msgHtml, highlightJson, row }));
  }

  function stateError() {
    return `<div class="state-panel is-danger" role="alert">${I('circle-alert')}<div>
      <h2>Search failed</h2>
      <p>Local Docker did not respond within 10 s (HTTP 504). Nothing was loaded for this search.</p>
      <div class="actions"><button class="btn btn-secondary">${I('rotate-cw')}Retry search</button><button class="btn btn-ghost">${I('braces')}Query details</button><button class="btn btn-ghost">${I('activity')}Source health</button></div>
    </div></div>
    <p class="hint-row">Long searches on Docker read every matching container; narrowing services or the time range reduces how much is read.</p>`;
  }
  function stateEmpty() {
    return `<div class="state-panel" role="status">${I('search')}<div>
      <h2>No events match this scope</h2>
      <p>Nothing was found in the last 1 day of Local Docker · payments-stack with these filters:</p>
      <div class="facts"><span class="chip is-exclude"><span class="chip-mode">Excluding</span> <b>audit-writer, notification-worker</b></span><span class="chip">Severity <b>Info, Warn, Error</b></span><span class="chip is-protected">Customer ID <b>Protected</b></span><span class="chip">Text <b>“reservation rsv-0000”</b></span></div>
      <div class="actions"><button class="btn btn-secondary">${I('clock')}Change time range</button><button class="btn btn-ghost">Clear all filters</button></div>
    </div></div>
    <p class="hint-row"><span>Paste a trace, correlation, journey or event ID to search it as that field.</span><span><kbd>Ctrl</kbd> <kbd>Enter</kbd> runs the search</span></p>`;
  }
  function stateUnavailable() {
    return `<div class="state-panel is-danger" role="alert">${I('wifi-off')}<div>
      <h2>Local Docker is unreachable</h2>
      <p>The last health check failed: the Docker engine refused the connection. Search, Live and schema scans need a reachable source.</p>
      <div class="actions"><button class="btn btn-secondary">${I('rotate-cw')}Check again</button><button class="btn btn-ghost">${I('settings')}Sources &amp; connections</button></div>
    </div></div>`;
  }
  function stateInvalidQuery() {
    return `<div class="state-panel is-danger" role="alert">${I('braces')}<div>
      <h2>The query is not valid</h2>
      <p>Expected a value after <code>level =</code> at position 8. The search did not run.</p>
      <pre class="code" style="margin-top:8px">level = and service = "payments-api"\n        ^</pre>
      <div class="actions"><button class="btn btn-secondary">${I('pencil')}Edit query</button><button class="btn btn-ghost">Remove query</button></div>
    </div></div>`;
  }
  function stateStartup() {
    return `<div class="state-panel" role="status">${I('loader-circle', 'spin')}<div>
      <h2>Loading sources</h2>
      <p>Reading the source list and checking health. Docker is selected first when it is available, then OpenShift. OpenShift Loki is listed as not available.</p>
    </div></div>
    <p class="hint-row"><span><kbd>/</kbd> focus search</span><span><kbd>Ctrl</kbd> <kbd>Enter</kbd> run search</span><span><kbd>?</kbd> all shortcuts</span></p>`;
  }

  // ------------------------------------------------------------------ hub + review nav
  function hub() {
    const rows = STATES.map(([id, label]) => `<tr><td class="mono">${id}</td><td>${esc(label)}</td><td><a href="?state=${id}&t=b1">B1</a><a href="?state=${id}&t=b1&theme=dark">B1 dark</a><a href="?state=${id}&t=b2">B2</a><a href="?state=${id}&t=b3">B3</a></td></tr>`).join('');
    return `<div class="hub"><h1>Modern Developer Console — prototype states</h1><p class="ws-sub">Static design prototype. All data is synthetic. Treatments: B1 Instrument Neutral (recommended), B1 dark companion, B2 Night Bench, B3 Enterprise Workbench.</p><table><thead><tr><th>State</th><th>What it shows</th><th>Open</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const root = document.getElementById('root');
  const entry = STATES.find(([id]) => id === STATE);
  root.innerHTML = entry ? entry[2]() : hub();
  // Z4/Z5: what a layer covers is inert. The Inspector sheet (< 1366 px) covers the results; a modal alertdialog covers everything else.
  if (document.querySelector('.inspector') && window.innerWidth < 1366) document.querySelectorAll('.work > .column').forEach((c) => c.setAttribute('inert', ''));
  const modal = document.querySelector('[role="alertdialog"][aria-modal="true"]');
  if (modal) {
    document.querySelectorAll('.shell, .chrome').forEach((el) => el.setAttribute('inert', ''));
    [...modal.parentElement.children].forEach((el) => { if (el !== modal && !el.classList.contains('dialog-scrim')) el.setAttribute('inert', ''); });
  }
  // More filters stays inside the viewport: the panel scrolls and its Reset / Cancel / Apply footer stays visible
  // (production already positions the panel under [data-app-chrome] with a ResizeObserver).
  document.querySelectorAll('.filters-panel').forEach((fp) => { fp.style.maxHeight = `${Math.max(240, window.innerHeight - fp.getBoundingClientRect().top - 8)}px`; });
  // Narrow builder step strip: bring the current step into view and fade the edges that hide more steps.
  document.querySelectorAll('.rb-rail').forEach((r) => {
    const fades = () => {
      const scrolls = r.scrollWidth > r.clientWidth + 1;
      r.classList.toggle('fade-left', scrolls && r.scrollLeft > 0);
      r.classList.toggle('fade-right', scrolls && r.scrollLeft + r.clientWidth < r.scrollWidth - 1);
    };
    const cur = r.querySelector('[aria-current="step"]');
    if (cur && r.scrollWidth > r.clientWidth + 1) r.scrollLeft = Math.max(0, cur.offsetLeft - 40);
    r.addEventListener('scroll', fades, { passive: true });
    r.addEventListener('focusin', (ev) => {
      const b = ev.target.getBoundingClientRect(); const rr = r.getBoundingClientRect();
      if (b.left < rr.left + 40) r.scrollLeft -= rr.left + 40 - b.left;
      else if (b.right > rr.right - 40) r.scrollLeft += b.right - (rr.right - 40);
      fades();
    });
    fades();
  });
  // Chip rows that scroll get an edge fade so the overflow reads as scrollable (production: ResizeObserver).
  document.querySelectorAll('.scope-strip .chips').forEach((c) => c.classList.toggle('is-overflowing', c.scrollWidth > c.clientWidth + 1));
  // New states can ask for a scroll position (e.g. the Classification section inside the Inspector body).
  document.querySelectorAll('[data-scroll-to]').forEach((el) => {
    const box = el.closest('.insp-body, .rb-main, .set-content, .table-wrap, .map-scroll');
    if (box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  });
  const editRow = document.querySelector('.fields tr.is-editing');
  if (editRow) { const sc = editRow.closest('.map-scroll'); sc.scrollTop += editRow.getBoundingClientRect().top - sc.getBoundingClientRect().top - 34; }
  // A row overflow menu is drawn outside the scrolling table (LERUX-1 pass 6 X-series) so it never covers the row's
  // own controls; it is then anchored directly under its own row, right-aligned with the trigger (pass 11 AC3).
  const menuTrigger = [...document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')].find((el) => el.offsetParent);
  const anchoredMenu = document.querySelector('.menu-anchor > .menu');
  if (menuTrigger && anchoredMenu) {
    const row = menuTrigger.closest('tr, li');
    const box = menuTrigger.closest('.set-content, .insp-body, .rb-main');
    if (row && box) {
      // Keep the row and the menu under it inside the scrolling workspace (narrow widths stack the rules as cards).
      const need = row.getBoundingClientRect().bottom + 4 + anchoredMenu.offsetHeight + 12 - box.getBoundingClientRect().bottom;
      if (need > 0) box.scrollTop += need;
    }
    const a = anchoredMenu.parentElement.getBoundingClientRect();
    const t = menuTrigger.getBoundingClientRect();
    const w = anchoredMenu.offsetWidth;
    const foot = row ? row.getBoundingClientRect().bottom : t.bottom;
    anchoredMenu.style.right = 'auto';
    anchoredMenu.style.top = `${foot + 4 - a.top}px`;
    anchoredMenu.style.left = `${Math.max(8 - a.left, t.right - a.left - w)}px`;
  }
  document.title = entry ? `${entry[1]} — Log Explorer prototype` : 'Modern Developer Console — prototype states';
  if (entry && P.get('nav') !== '0') {
    const i = STATES.indexOf(entry);
    const link = (s, label) => (s ? `<a class="btn btn-ghost btn-sm" href="?state=${s[0]}&t=${TREAT}${THEME === 'dark' && TREAT !== 'b2' ? '&theme=dark' : ''}">${label}</a>` : '');
    root.insertAdjacentHTML('beforeend', `<nav class="review-nav" aria-label="Prototype review">${link(STATES[i - 1], '← Prev')}<a class="btn btn-ghost btn-sm" href="?">All states</a>${link(STATES[i + 1], 'Next →')}</nav>`);
  }
})();
