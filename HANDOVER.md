Log Explorer — Complete Project Handover for Claude Code

Purpose: This document transfers the complete known product intent, requirements, technical architecture, implementation constraints, UX decisions, security rules, operational lessons, failure history, rejected approaches, and verification expectations for the Log Explorer / Multi-Source Log Explorer project.

Primary next action for Claude Code: inspect the actual repository, reconcile the repository state against this handover, and produce a detailed execution plan before changing code.

Important interpretation rule: where an older requirement conflicts with a later decision, the later decision wins. Historical decisions are retained below so the reasoning is not lost.

────────

1. Executive Summary

Log Explorer is intended to give developers and support engineers a clear, Seq-like investigation experience for structured Spring Boot JSON logs, instead of forcing them to:

• manually inspect docker logs / docker compose logs;
• understand raw Docker framing and container metadata;
• write difficult LogQL queries just to answer ordinary support/debugging questions in OpenShift;
• manually correlate events across services using trace, correlation, journey, event, and business identifiers;
• expose or copy sensitive banking identifiers while debugging.

The initial MVP had two logical log sources:

1. Local Docker Compose via the Docker Engine API.
2. OpenShift Development via the OpenShift Loki gateway/API.

The later project discussion introduced an important deployment/operational requirement:

• the solution must be portable and runnable on other machines with Docker / Docker Compose;
• it should not depend on manually configuring an insecure or organization-blocked remote Docker daemon;
• remote Docker support may exist, but it must be optional and ergonomic, with a default port and optional TLS;
• direct remote Docker TCP connectivity on port 2375 was found unsuitable/unreliable in the target work environment, which is one reason portable Compose deployment became important.

The project evolved from an MVP into a more professional enterprise investigation UX, with strict attention to:

• security and masking;
• source capability discovery;
• bounded searches and streaming;
• exact time-zone handling;
• accessible and responsive UI;
• truthful counts and states;
• stable semantic table geometry;
• event explanation and contextual investigation;
• trace/correlation/journey exploration;
• deployment repeatability and verifiable behavior.

────────

2. Problems the Project Is Solving

2.1 Developer/support pain

The project exists because ordinary troubleshooting currently requires too much low-level knowledge.

A developer/support engineer should be able to answer:

• What happened?
• When exactly did it happen?
• Which service/container/pod/environment produced it?
• What severity/error code was involved?
• Which user/customer/device/request was involved, while respecting masking rules?
• Which trace/correlation/journey/event links this log to other events?
• What happened immediately before and after it?
• Which services participated in the same request or journey?

without being forced to:

• read raw Docker output;
• manually parse JSON;
• understand Docker multiplexed frames;
• remember LogQL syntax;
• manually combine multiple service outputs;
• copy customer identifiers into unsafe tools;
• visually reconstruct request flow from unrelated lines.

2.2 OpenShift usability problem

OpenShift Loki is powerful but developer UX can become LogQL-centric. The intended product provides guided search and correlation so users can investigate without first becoming Loki experts.

Raw LogQL is an advanced capability, not the default workflow.

2.3 Docker usability problem

Docker logs are easy to retrieve technically but poor as an investigation UI:

• multiple containers/services must be merged;
• Compose service/project metadata must be derived;
• stdout/stderr frames must be normalized;
• application JSON must be parsed;
• malformed lines must not disappear;
• results must be bounded;
• users need filters, correlation, timeline, and details.

2.4 Sensitive banking data problem

The application logs can contain banking/customer-related identifiers. The explorer must permit investigation while minimizing exposure.

Sensitive fields identified in the project:

• cif
• UserName
• CustomerId
• deviceId
• deviceIp

These values must be protected server-side before results reach the browser.

2.5 Portability / environment restrictions

A later real-world problem was that remote Docker TCP access was not reliable or acceptable in the target environment.

Observed behavior:

• port 2375 could not be reached from another PC;
• even on the remote Docker machine, connecting using the machine’s own IP failed;
• connection through localhost worked;
• this strongly indicated the Docker daemon was bound to loopback / not externally exposed, and organization/network policy could make changing that unsuitable.

The user explicitly concluded that relying on this remote Docker networking approach would likely not work in the work environment.

Therefore the project must support a simpler deployment model:

• build one or more Docker images;
• run the solution using Docker Compose;
• make the solution portable to another machine;
• document prerequisites and exact run steps;
• verification must prove this deployment path works.

────────

3. Product Identity and Intended Users

Use a neutral identity such as:

• Log Explorer
• Multi-Source Log Explorer

Do not invent:

• bank branding;
• company logos;
• claims of affiliation;
• production-readiness claims that have not been validated.

Primary personas:

1. Developer debugging a failed request
2. Support engineer investigating a masked customer/user journey
3. Platform engineer checking a noisy or unhealthy service

The product should feel like a credible enterprise engineering tool:

• calm;
• precise;
• information-dense;
• fast;
• consistent;
• accessible.

It should not look like a generic generated dashboard, a huge HTML form, a card-heavy marketing page, or a novelty UI.

────────

4. Technical Baseline

4.1 Backend

• Java 21
• supported Spring Boot 3.x
• Maven / Maven Wrapper
• Spring WebFlux
• Bean Validation
• Spring Boot Actuator
• JUnit 5
• integration tests where valuable
• RFC 7807 / Spring ProblemDetail error responses

Architecture rule:

> One modular Spring Boot backend. Do not split this application into microservices just because the surrounding systems are microservices.

4.2 Frontend

• React
• TypeScript
• Vite
• strict TypeScript
• Vitest
• React Testing Library
• browser/E2E tests for visual/interaction invariants when possible

4.3 Packaging

The intended production/demo packaging is:

• one deployable application image;
• React built for production and served by Spring Boot;
• /api remains backend;
• SPA routing fallback must not swallow /api or actuator routes;
• non-root runtime image;
• multi-stage build;
• no build secrets in image layers.

Development may still run backend and frontend separately.

4.4 Persistence

MVP:

• no application database;
• localStorage only for safe non-sensitive UI preferences;
• never persist raw search values that may contain sensitive identifiers;
• never persist raw log events/results.

────────

5. Canonical Log Model

Expected top-level JSON fields:

• @timestamp
• @version
• message
• logger_name
• thread_name
• level
• level_value
• application
• mdc
• optional exception

Expected / commonly observed mdc fields:

• cif
• UserName
• CustomerId
• X-Correlation-id
• deviceId
• deviceIp
• devicePlatformType
• language
• x-journey-trace-id
• serverIp
• serverHost
• stepName
• UIIdentifier
• traceId
• spanId
• event.correlationId
• eventId
• ERROR_CODE

5.1 Canonical mappings

• /@timestamp -> timestamp
• /@version -> schemaVersion
• /application -> service
• /level -> severity
• /level_value -> severityNumber
• /message -> message
• /logger_name -> logger
• /thread_name -> thread
• /exception -> exception
• /mdc/traceId -> traceId
• /mdc/spanId -> spanId
• /mdc/x-journey-trace-id -> journeyId
• /mdc/eventId -> eventId
• /mdc/stepName -> businessStep
• /mdc/UIIdentifier -> uiIdentifier
• /mdc/ERROR_CODE -> errorCode

Correlation precedence

correlationId must resolve in this order:

1. mdc.X-Correlation-id
2. literal key mdc.event.correlationId

Important: event.correlationId may be a literal JSON key containing a period. Do not assume nested JSON.

Keys with dots or hyphens must be read safely, e.g. via JSON Pointer / literal field access.

5.2 Service precedence

Primary service:

1. top-level application;
2. source metadata fallback, e.g. Docker Compose service or OpenShift metadata.

Preserve both application service and source/platform service metadata when they differ.

5.3 Unknown fields

Do not discard unknown JSON or MDC fields.

Preserve complete original structure / generic field map so the details inspector can expose unfamiliar fields.

5.4 Malformed lines

Malformed or non-JSON lines must become a raw fallback event.

Never silently drop malformed lines.

The parser should tolerate one malformed field without discarding the entire otherwise useful event.

5.5 Timestamps

• accept offsets;
• normalize internally to Instant / UTC;
• display user-zone values and exact UTC where appropriate;
• avoid double conversion.

5.6 Empty message

Do not invent a business message.

Preserve empty message and provide a UI-safe display fallback such as (empty message).

5.7 Exceptions

Multiline exceptions / escaped newlines must remain one logical event and render readably.

────────

6. Security and Privacy Requirements

These rules are non-negotiable.

6.1 Sensitive fields

Sensitive:

• CIF
• username
• customer ID
• device ID
• device IP

Mask before browser serialization.

Suggested behavior from prior design:

• cif: hidden or strongly masked
• CustomerId: partial masking
• UserName: partial masking
• deviceId: partial masking
• deviceIp: mask final portion

Source adapters may need exact raw values to perform source-side filtering, but raw values must not be returned to the frontend.

6.2 Never log

Do not log:

• search values;
• bearer tokens;
• raw customer identifiers;
• full returned log events;
• raw sensitive filters;
• secrets.

Avoid leaking them through:

• toString;
• exceptions;
• ProblemDetail;
• generated query explanations;
• request logs;
• access logs;
• test output.

6.3 Browser safety

• Render log content as text.
• No dangerouslySetInnerHTML.
• Query contents must not be placed in browser URLs.
• Sensitive values and results must not be persisted in localStorage.
• No raw sensitive identifier copy/reveal action.
• Non-sensitive trace/correlation/journey/event IDs may be copyable.

6.4 Credentials

Credentials/tokens/certificates:

• environment variables or uncommitted local configuration;
• never committed;
• never printed;
• .env.example contains variable names and harmless defaults only.

6.5 TLS

OpenShift/Loki TLS verification remains enabled.

Do not add trust-all TLS code.

For remote Docker, TLS is an optional connection mode because many development remote Docker endpoints may not use TLS. This is different from disabling TLS validation for a TLS connection.

────────

7. Source Abstraction

Create / retain a source-neutral abstraction such as LogSource.

Capabilities should be explicit and returned by the backend, for example:

• historical search
• live tail
• raw LogQL
• service discovery
• query statistics
• context view

The frontend must not infer source features.

Potential endpoints:

• GET /api/v1/sources
• GET /api/v1/sources/{sourceId}/health
• GET /api/v1/sources/{sourceId}/services
• POST /api/v1/logs/search

A registry resolves stable source IDs and rejects disabled/unknown sources.

A deterministic fixture source may exist only for test/dev profiles and must not pretend to be a production user source.

────────

8. Search Request Contract

Common request fields include:

• sourceId
• start
• end
• direction
• limit
• services
• levels
• text
• traceId
• spanId
• correlationId
• journeyId
• eventId
• errorCode
• businessStep
• optional simpleQuery

Later UX also added:

• uiIdentifier
• logger/class
• device platform
• language
• protected user/customer/CIF/device filters

8.1 Guardrails

• start < end
• safe default limit
• configurable maximum; initial design capped request max at <= 5,000
• per-source maximum time range
• safe timeout
• bounded concurrency
• cancellation
• truncation metadata
• no unbounded scans or buffers

Search responses should expose truthful metadata such as:

• source ID;
• execution duration;
• returned count;
• estimated/total when actually known;
• warnings;
• truncation;
• pagination/cursor;
• safe query statistics.

Do not make contradictory count claims.

────────

9. Query Language

A small deterministic source-independent query language was specified.

Required syntax examples:

• level = "ERROR"
• service != "gateway"
• message contains "timeout"
• and
• or
• parentheses
• quoted strings with safe escaping

Never use:

• SpEL evaluation
• JavaScript eval
• SQL eval
• reflection-based expression execution

Supported aliases included:

• service
• level
• message
• logger
• traceId
• spanId
• correlationId
• journeyId
• eventId
• errorCode
• businessStep
• uiIdentifier
• device.platform
• language
• userName
• customerId
• cif

Sensitive aliases are search-only; raw values must never appear in logs/errors/explanations.

Implementation components:

• tokenizer
• parser
• typed AST
• semantic validation
• in-memory predicate compiler
• Loki query planner
• query-plan explanation with sensitive redaction

Structured filters are ANDed with parsed expression.

9.1 Raw LogQL

Raw LogQL:

• OpenShift/Loki only;
• separate explicit mode;
• disabled by default;
• enabled by configuration;
• still obeys time/limit/timeout/concurrency restrictions;
• never shown as supported for Docker;
• later UX says unsupported LogQL should not dominate the UI as a huge disabled control.

────────

10. Local Docker Compose Source

Stable source identity originally:

• ID: local-docker
• display: Local Docker Compose

Implementation should use a maintained Java Docker Engine client compatible with Java 21, behind a restricted internal gateway.

Do not parse human formatted docker compose logs.

Required behavior:

• honor standard Docker connection configuration, including DOCKER_HOST;
• discover Compose containers using com.docker.compose.* labels;
• running + stopped-but-readable containers;
• optional Compose project filter;
• unique service discovery with running/container counts;
• read stdout/stderr via Docker log APIs;
• support since/until/tail;
• correctly decode Docker stream framing;
• normalize lines with canonical parser;
• enrich with:
  • source
  • Compose project
  • Compose service
  • container name/ID
  • stdout/stderr stream
• merge multiple containers;
• deterministic ordering;
• bounded scans/results;
• truncated flag;
• clear unavailable / unsupported logging driver states.

Strictly read-only Docker operations:

Allowed conceptually:

• list
• inspect
• read logs
• follow logs

Do not expose APIs to:

• start
• stop
• create
• remove
• exec
• mutate containers.

────────

11. Remote Docker Evolution

This area evolved after initial implementation.

11.1 UX requirement

Remote Docker connection should be easy to configure.

The user later requested:

• remote Docker port should have a default value unless the user chooses another port;
• TLS should be optional, because many remote Docker endpoints being tested do not use TLS.

Reasonable implementation behavior:

• infer common scheme/port defaults from selected mode;
• allow override;
• do not force certificate fields when TLS is off;
• if TLS is on, require proper verification configuration rather than trust-all.

11.2 Connectivity problem discovered

Testing remote Docker using port 2375 showed:

• telnet from another machine did not connect;
• using the target machine’s own LAN IP on that same machine also did not connect;
• localhost:2375 on the Docker machine worked.

This means that simply telling users to point Log Explorer at tcp://host:2375 is not a dependable deployment strategy.

Likely causes in such environments include:

• daemon bound only to loopback;
• OS firewall;
• network firewall;
• corporate policy;
• Docker Desktop/Engine security constraints.

The user explicitly wanted a simpler verification path and then concluded this remote networking method likely would not work in the work environment.

11.3 Current operational direction

Do not make externally exposed remote Docker TCP a prerequisite.

Portable deployment using Docker images and Compose is a key solution.

Remote Docker can remain a capability, but the architecture should not require every user to modify Docker daemon listeners or corporate firewall rules.

────────

12. OpenShift Loki Source

OpenShift source is a read-only adapter through the OpenShift Loki gateway/API.

Configurable parameters must include:

• base/gateway URL;
• gateway prefix/path;
• tenant/application path;
• namespace label;
• service label;
• limits/timeouts;
• token location;
• TLS configuration.

Do not dangerously hardcode:

• gateway prefix;
• tenant;
• namespace label key;
• service label key.

Required behavior:

• query range;
• correct start/end/direction/limit/timestamp semantics;
• safe selector escaping;
• push down safe filters;
• exact post-filtering when necessary;
• normalize streams;
• enrich source metadata;
• merge/sort results;
• distinguish:
  • 401
  • 403
  • 429
  • timeout
  • 5xx
• sanitize all errors.

Real OpenShift integration must be read-only.

Do not change:

• operators;
• routes;
• cluster RBAC;
• Loki configuration;
• cluster-wide roles.

Phase 12 guidance required tiny bounded checks:

• max ~5 minute range;
• max 20 results;
• one authorized namespace/service;
• sanitized integration report;
• no raw messages/customer IDs in committed evidence.

Later UX work explicitly treated live OpenShift verification as DEFERRED BY SCOPE rather than failing the entire UX if the environment is unavailable.

────────

13. Historical Search UX

The UI evolved from a functional form into a professional investigation surface.

13.1 Main shell

Use:

• one product title;
• active source/environment;
• compact health state;
• retry for unhealthy source;
• optional help / keyboard shortcuts.

No duplicated titles such as both “Multi-Source Log Explorer” and “Log Explorer”.

13.2 Default visible toolbar

Visible by default:

1. source
2. searchable service multi-select
3. time range
4. severity
5. universal search
6. Search
7. Live (only when supported)
8. More filters + active count

13.3 Service selector

Do not use a native multi-select that requires Ctrl/Cmd.

Use accessible searchable checkbox-style multi-select with:

• All services
• selected count
• clear
• running/health metadata where available
• keyboard navigation
• viewport-safe dropdown

13.4 Severity

First-time default should avoid TRACE/DEBUG noise.

Preferred:

• INFO
• WARN
• ERROR

Also offer:

• All
• Errors only
• individual levels

Severity cannot be color-only.

13.5 Universal search

Suggested label:

> Search messages, errors, users or paste an ID

Behavior:

• message + error code default search;
• detect possible trace/correlation/journey/event IDs;
• do not silently classify;
• show confirmable field suggestion;
• never persist sensitive input;
• Enter runs search;
• Ctrl/Cmd+Enter also runs;
• Escape closes suggestions without destructive clearing.

13.6 Advanced filters

Organize by user question, not raw JSON structure.

Who / customer

• user name
• customer ID
• CIF
• device ID
• device IP

Applied representation must not expose raw value; use protected/masked wording.

Request flow

• trace
• span
• correlation
• journey
• event

What happened

• error code
• business step
• UI identifier
• logger/class
• text contains

Client context

• device platform
• language

Advanced filters should use draft/apply/cancel semantics rather than running queries during editing.

────────

14. Time Range — Screenshot-Driven Requirements

A real UI regression was reported via screenshots and became a strict acceptance area.

14.1 Presets

Preserve relative presets and include Last 1 day.

When a shorter search returns zero results, offer one-click:

> Search last 1 day

14.2 Custom range

Opening Custom must prefill valid values:

• End = now
• Start = end minus previous preset
• 30 minute fallback

Custom editor must be temporary:

• popover/dropdown;
• Start/End labels;
• Apply;
• Cancel;
• not permanently expanded in the form.

On valid Apply:

• commit;
• close immediately;
• restore focus to the Time Range control;
• display the actual interval, not generic Custom range;
• reflect same value in active filters.

Example:

> 13 Aug, 1:39 PM – 2:09 PM

If dates differ, show both.

Timezone:

> Asia/Kuwait (UTC+03:00)

The effective interval should also be shown after search.

Reopen should restore committed values.

Cancel / Escape / outside click:

• close;
• do not mutate committed range.

Selecting a relative preset:

• closes custom editor;
• restores preset label.

Validation messages must distinguish:

• missing start/end;
• start >= end;
• future end;
• maximum-range violation.

Convert display-zone values to UTC exactly once.

The custom editor must not overlap severity.

At narrow widths fields should stack.

Accessibility must include keyboard/focus/error behavior.

────────

15. Results Table — Screenshot-Driven Requirements

Another reported visual regression was critical.

Observed bad behavior:

• headers spanned full width but rows used different geometry;
• message text appeared under Service;
• action ... appeared as a second line/row;
• missing fields shifted later values.

The fix became a strict semantic contract.

15.1 Exact column order

Exactly seven columns:

1. Time
2. Level
3. Service
4. What happened
5. User/Customer
6. Correlation/Trace
7. Actions

Mapping:

• Service = application / Compose service fallback
• What happened = message only

Missing value:

> `—`

Never omit a cell.

15.2 Table structure

For ordinary table rendering:

• use one semantic <table>;
• one <colgroup> / one column sizing definition;
• table-layout: fixed;
• header and body must share same geometry;
• do not apply independent grid/flex layouts to header and body;
• no block/grid styling that breaks native table alignment.

If table min-width exceeds viewport:

• horizontal scroll belongs around the table;
• the entire page must not horizontally overflow.

15.3 Row invariant

One event = one <tr>.

The Actions ... is cell 7 in the same row.

No second action row / blank line.

15.4 Time

Show:

• date
• time
• milliseconds

because Last 1 day can cross date boundaries.

15.5 Message

Largest/flexible column.

Use intentional wrap or ellipsis with accessible expansion.

15.6 Sort

Newest first for normal search.

No dropped or duplicated rows.

15.7 Pagination

One model only.

Do not simultaneously show competing “Load next page” and Prev/Next patterns.

Prefer bounded cursor/server pagination where suitable.

15.8 Counts

Keep concepts distinct:

• total / estimated
• returned
• visible
• page
• truncation

Never show contradictory copy.

15.9 Measurable geometry regression test

Browser test should compare each visible header and its cell:

• getBoundingClientRect().left
• getBoundingClientRect().width

Tolerance:

> <= 2 CSS pixels

Test at:

• desktop;
• narrow viewport;
• zoom/reflow where practical.

The later verification explicitly used desktop, narrow, and 200% zoom; custom range verification also tested very high zoom.

Do not claim the table is fixed if geometry assertions still fail.

────────

16. Event Details / Inspector

The initial details UI evolved into a professional resizable event inspector.

Behavior:

• right-side beside results on wide screens;
• sheet/overlay on narrow screens;
• safe min/max resizing;
• result list remains present;
• selected row remains identifiable;
• Previous / Next / Close;
• accessible focus behavior.

16.1 Header

Show:

• severity;
• service;
• title derived from message/error code.

Do not invent diagnosis/root cause.

16.2 Overview

Answer:

• What happened?
• When?
• Where?

Include:

• full message;
• local timestamp with ms and named timezone;
• UTC;
• source;
• service;
• Compose project;
• container / pod / namespace / stream;
• level;
• logger;
• thread;
• schema version.

16.3 Actor & client

When present:

• masked username
• customer ID
• CIF
• device ID
• device IP
• device platform
• language

Label values as protected/masked.

No reveal action.

16.4 Request flow

• journeyId
• correlationId
• traceId
• spanId
• eventId

Actions:

• find related logs;
• copy non-sensitive IDs;
• surrounding context.

16.5 Business/error

• business step
• UI identifier
• error code
• formatted exception

16.6 All fields

• searchable key/value tree or table;
• canonical fields first;
• unknown fields after;
• raw JSON further behind disclosure;
• text rendering only;
• sensitive values stay masked.

16.7 Context

Show ±30 seconds was explicitly specified.

Scope context to service/container/pod when possible.

Display bounded query/time range before execution.

Preserve breadcrumb/back to original search.

────────

17. Trace / Correlation / Journey Investigation

Supported click actions on non-sensitive IDs:

• Find this trace
• Find this correlation
• Find this journey
• Find this event

Never create raw customer identifier click-search actions.

Timeline behavior:

• same active source only;
• bounded time window;
• ascending timestamp order for flow;
• visually distinguish services;
• display:
  • timestamp
  • service
  • level
  • business step
  • message
  • trace/span
  • event/protocol metadata when available
• support multiple traces in one journey;
• state clearly that timestamp ordering is not guaranteed causality;
• preserve original search state;
• handle missing identifier/no results.

This capability is fundamental to the value proposition.

────────

18. Live Tail

18.1 Browser protocol

Server-to-browser live events use SSE.

Do not put tokens or sensitive filter values in URL.

18.2 Docker live

Docker source follows bounded stdout/stderr through Docker client.

Disconnect must cancel upstream callback/resource.

18.3 Loki live

If configured and supported:

• connect through OpenShift gateway WebSocket / tail-equivalent API.

If unsupported:

• capability false / clear unsupported state.

Do not fake it.

18.4 Safety

Backend:

• normalize/mask before emit;
• heartbeat;
• cancellation;
• connection timeout;
• max concurrent tails;
• bounded buffers;
• backpressure/dropped notice.

Frontend:

• Start
• Pause
• Resume
• Stop
• follow behavior
• visible counts/state
• bounded client buffer
• initial specified display cap: 1,000 events
• dropped/buffered counts
• source navigation/unmount closes stream

Live mode must be visually distinct from historical search.

Do not imply live tail represents complete historical data.

────────

19. Professional UX Design Direction

19.1 Principles

1. Progressive disclosure
2. Recognition over recall
3. Immediate feedback
4. Investigation continuity
5. Dense readability
6. Accessibility by default
7. Safety by default
8. Responsive desktop-first

19.2 Layout targets

Optimize for:

• 1920
• 1440
• 1280

Remain usable at:

• 1024
• 768
• 390

Later acceptance explicitly tested these widths.

19.3 Visual language

• neutral enterprise canvas;
• one restrained accent;
• semantic severity colors;
• 4/8px spacing system;
• centralized typography/spacing/radius/border/shadow tokens;
• monospace only for timestamps, IDs, query syntax, stack traces.

Avoid:

• gradients;
• glassmorphism;
• excessive cards;
• excessive rounded pills;
• novelty animation;
• huge empty hero areas;
• uncontrolled inline colors.

Light theme required.

Dark theme only if complete and accessible.

19.4 Accessibility

Target WCAG 2.2 AA principles.

Must support:

• semantic HTML;
• labeled controls;
• keyboard workflows;
• visible focus;
• screen-reader labels;
• color contrast;
• non-color meaning;
• logical focus restoration;
• reduced motion;
• helpful live announcements;
• zoom/reflow.

No page-level horizontal overflow.

────────

20. Portable Docker Compose Delivery

This is a later critical requirement.

The user wants the project deliverable to be easy to verify and move to other machines.

Claude Code should treat portable Compose as a first-class deployment mode.

Expected deliverables:

• Dockerfile / images needed by project;
• Docker Compose file;
• environment template;
• documented volumes / network requirements;
• health checks;
• startup ordering where needed;
• optional demo log generator;
• exact commands for:
  • build;
  • start;
  • health check;
  • source discovery;
  • search smoke test;
  • UI load;
  • stop;
  • cleanup limited to this stack.

Requirements documentation must explain:

• Docker requirement/version expectations;
• Docker Compose plugin requirement;
• ports used;
• environment variables;
• optional Docker access configuration;
• security consequences of Docker socket mount;
• remote Docker options;
• TLS optionality for remote Docker;
• how to change remote Docker port;
• OpenShift variables if used;
• troubleshooting.

20.1 Docker socket note

Original packaging design allowed a Docker socket mount only behind an explicit profile and documented it as privileged.

That remains a strong default for a local portable stack if the explorer needs to inspect Docker on the same host.

Do not silently mount /var/run/docker.sock.

20.2 Remote Docker portability

If remote Docker configuration is retained:

• default port should be prefilled;
• custom port is supported;
• TLS toggle is optional;
• only show certificate settings when TLS is enabled;
• provide clear connectivity/health diagnostics;
• do not automatically expose a daemon;
• do not require users to reconfigure firewall/daemon just to run Log Explorer.

────────

21. OpenShift Deployment Assets

Original deployment scope included deploy/openshift assets:

• Deployment
• Service
• Route
• ConfigMap
• ServiceAccount

Security posture:

• non-root;
• read-only filesystem where practical;
• resource requests/limits;
• probes;
• Loki configuration via ConfigMap;
• token/credentials via Secret references only;
• no committed secret;
• no cluster-wide role binding;
• document namespace-scoped role binding an administrator may choose to apply;
• TLS verification enabled.

────────

22. Verification Philosophy

A major project pattern was:

> Implementation phase -> independent verification -> recovery prompt -> re-verification.

This must be preserved.

Claude Code should not produce a plan that treats compilation as sufficient proof.

22.1 General verification rules

• inspect repository before editing;
• preserve unrelated user changes;
• do not jump ahead;
• do not weaken/disable/ignore tests for green builds;
• do not fabricate connectivity or success;
• deterministic tests may pass while an external live check is BLOCKED;
• report actual commands and outcomes;
• distinguish PASS / FAIL / BLOCKED / DEFERRED.

22.2 Recovery philosophy

When verification fails:

• fix only failed/incomplete requirements;
• preserve working behavior;
• rerun exact failed checks;
• rerun relevant regression suite;
• report remaining blockers honestly.

The user requested dedicated recovery prompts after verification failures, including around later phases.

────────

23. Screenshot / Visual Bug Lessons

Several important requirements came directly from screenshots and visual inspection rather than abstract requirements.

Do not lose these lessons:

1. Working backend search does not prove UI correctness.
2. Table alignment must be verified at rendered-pixel geometry level.
3. Optional/missing data must never change semantic column positions.
4. Action cells must not accidentally create another row.
5. A custom time control must visibly show the interval the user actually committed.
6. Time controls must not overlap adjacent controls.
7. Real API response -> normalized frontend model -> React state -> DOM -> computed layout is the required debug path.
8. Before declaring a visual fix:
  • reproduce;
  • capture baseline;
  • inspect network payload;
  • inspect DOM;
  • define invariant;
  • implement smallest fix;
  • add regression test;
  • verify rendered result.

────────

24. Known / Reported Issues to Avoid Reintroducing

24.1 Remote Docker reachability assumption

Do not assume that because Docker listens on localhost:2375, another machine can reach HOST_IP:2375.

Do not make port 2375 exposure a prerequisite.

24.2 Forced TLS

Do not force TLS for remote Docker.

TLS should be selectable/optional for the remote Docker connection mode.

24.3 Hardcoded remote port

Provide sensible default port and allow override.

24.4 Header/body table mismatch

Do not build header and body using different layout systems.

24.5 Conditional cell omission

Do not omit empty optional cells.

Use —.

24.6 Message/service confusion

message must render under What happened, not Service.

24.7 Duplicate action row

Actions belong in seventh cell of same event row.

24.8 Generic “Custom range” after apply

Show actual committed interval.

24.9 Time double-conversion

Convert user display-zone interval to UTC exactly once.

24.10 Contradictory result counts

Do not mix total, estimated, returned, visible, truncation into misleading text.

24.11 Query persistence

Do not store sensitive/raw query terms or results in URL/localStorage.

24.12 Unsafe HTML

No dangerouslySetInnerHTML.

24.13 Unbounded live/history data

No unbounded arrays, scans, buffers, or DOM rows.

24.14 Fake source capabilities

Do not show raw LogQL/live functions when source cannot support them.

24.15 External availability becoming false PASS

Use BLOCKED/DEFERRED when real Docker/OpenShift connectivity is unavailable.

────────

25. Non-Goals / Deferred Capabilities

Original MVP non-goals:

• production corporate SSO;
• per-user OpenShift OAuth;
• long-term log storage;
• SIEM;
• alerting platform;
• full APM;
• modifying/deleting source logs;
• cross-source query in one request;
• custom application database;
• cluster-wide production permission.

Post-MVP deferred ideas explicitly listed:

• corporate SSO and user-token delegation;
• production namespace RBAC;
• query audit persistence;
• HA / horizontal scale;
• PostgreSQL saved/team queries;
• production retention / DR;
• alerts / scheduled queries;
• distributed tracing backend integration;
• pseudonymized lookup service;
• multi-cluster / cross-source queries;
• penetration testing / formal production approval.

Later UX completion guidance also said not to add yet:

• AI root-cause diagnosis;
• analytics;
• production identity features.

These should not sneak into the initial execution plan unless repository reality shows they were already intentionally added.

────────

26. Expected Documentation

At minimum reconcile/create as appropriate:

• docs/MVP_SPEC.md
• docs/UX_SPEC.md
• docs/UX_QA.md
• docs/MVP_ACCEPTANCE_REPORT.md
• docs/UX_ACCEPTANCE_REPORT.md
• docs/INTEGRATION_REPORT.md
• docs/DEMO_SCRIPT.md
• docs/SECURITY_NOTES.md
• portable Compose run guide / requirements guide

Documentation must match actual commands.

No secret values / raw customer samples.

────────

27. Stakeholder Acceptance Tasks

Final UX acceptance was framed around actual tasks, not aesthetic opinion.

Task 1 — What failed recently?

• select service;
• last 30 minutes;
• Errors only;
• run;
• identify count/time/service/message without raw JSON.

Task 2 — What happened for a user/customer?

• More filters;
• anonymized user/customer test input;
• search;
• rows + inspector remain masked.

Task 3 — Follow a request

• paste trace/correlation/journey ID;
• confirm detected field;
• open timeline;
• understand service sequence/errors/time gaps/business steps.

Task 4 — Explain one event

• select by mouse and keyboard;
• answer what/when/where/who/request flow;
• show ±30 seconds;
• return to original results.

Task 5 — Monitor live logs

• start;
• pause;
• resume;
• follow;
• stop;
• verify state/counts/cleanup.

Task 6 — Failure states

• source unavailable;
• no services;
• no results;
• invalid custom time;
• invalid advanced query;
• truncated results;
• malformed raw line.

────────

28. Quality Gates

Claude Code should preserve these as plan gates.

Backend

• parser tests
• masking tests
• source abstraction tests
• Docker gateway/adapter tests
• Loki mock-server tests
• query parser/planner tests
• cancellation/backpressure tests
• full backend regression

Frontend

• unit/component tests
• strict TS type-check
• production build
• accessibility tests
• request/cancellation tests
• source switching
• sensitive persistence restrictions
• custom-time tests
• semantic table tests
• inspector tests
• correlation workspace tests
• live lifecycle tests

Browser/visual

Viewports:

• 1920
• 1440
• 1280
• 1024
• 768
• 390

Zoom/reflow:

• 125%
• 200%
• targeted higher zoom for time-control overlap when reproducing bug

Table geometry:

• <=2px header/cell left/width mismatch.

Performance:

• 100 events
• 1,000 events
• configured max results

No page-level horizontal overflow.

────────

29. Current Decision Hierarchy

When implementation choices conflict, use this priority:

1. Security / privacy
2. Later explicit user decisions
3. Verified real-world behavior
4. Product usability
5. Original MVP prompt assumptions
6. Convenience

Examples:

Remote Docker

Later user decision overrides naïve original assumption that a remote DOCKER_HOST will simply be reachable.

OpenShift

Keep adapter/code and deployment intent, but unavailable external OpenShift should be DEFERRED/BLOCKED rather than breaking local validation.

Docker packaging

Portable Compose became a stronger requirement after remote connectivity problems.

────────

30. Claude Code: Required Repository Audit Before Planning

Before proposing implementation phases, Claude Code must inspect:

• repository tree;
• git status;
• active branch;
• README/docs;
• backend pom and dependencies;
• source abstraction;
• parser/masking implementation;
• Docker adapter;
• remote Docker configuration;
• Loki adapter;
• query DSL;
• API contracts;
• frontend architecture;
• search toolbar;
• custom range component;
• results table DOM/layout;
• inspector;
• correlation workspace;
• live SSE;
• Dockerfile;
• Compose assets;
• OpenShift manifests;
• tests;
• screenshots/browser tests;
• docs.

Then create a matrix:

|Capability|Required by handover|Present|Partial|Missing|Broken|Evidence|
|----------|--------------------|------:|------:|------:|-----:|--------|

Do not assume the old implementation phase number equals current repository state.

────────

31. Claude Code: What the Implementation Plan Must Contain

The requested next output is an execution plan, not immediate implementation.

The plan must include:

1. Repository state assessment
2. Gap inventory
3. Architecture reconciliation
4. Superseded decisions
5. Target end-state
6. Phased implementation
7. Dependencies
8. Migration/refactor strategy
9. Security plan
10. Portable Compose plan
11. Remote Docker plan
12. OpenShift plan
13. UX repair/modernization plan
14. Testing strategy
15. Browser/visual verification
16. Acceptance gates
17. Rollback/recovery strategy
18. Documentation deliverables
19. Known risks
20. Explicit out-of-scope list
21. Definition of done

Every phase must contain:

• goal;
• exact scope;
• files/modules likely touched;
• acceptance criteria;
• automated tests;
• manual/live checks;
• PASS/FAIL/BLOCKED rules;
• regression checks;
• recovery procedure.

────────

32. Suggested Plan Structure for Claude Code

Claude Code may rename phases based on actual repository state, but a sensible capability order is:

Phase A — Repository audit and baseline

No feature work.

Establish evidence and current state.

Phase B — Core correctness/security

Parser, masking, source contracts, guardrails.

Phase C — Docker local + remote connection model

Read-only Docker, local socket/profile, remote host with default port and optional TLS, diagnostics.

Phase D — OpenShift Loki

Preserve/read-only adapter, config, security, mocked deterministic validation.

Phase E — Query engine

Structured + simple DSL + capability-gated raw LogQL.

Phase F — Historical search UX

Professional toolbar, advanced filters, custom time.

Phase G — Results/table correctness

Seven-column invariant, truthful counts, pagination, geometry tests.

Phase H — Event inspector

Full event explanation and protected data behavior.

Phase I — Correlation/journey

Trace/correlation/journey/event investigation and context.

Phase J — Live mode

SSE, bounded buffers, lifecycle.

Phase K — Portable Compose

Images, Compose, profiles, requirements guide, smoke test.

Phase L — OpenShift deployment assets

Only after local/package correctness.

Phase M — Final acceptance

Task-based acceptance + security/visual/regression audit.

This is a suggested decomposition, not a command to ignore the actual repo.

────────

33. Prompt to Give Claude Code

Copy the following together with this handover file.

```text
You are taking over the Log Explorer project.

Your first task is NOT to implement features.

Read this handover completely, then inspect the entire repository and all existing project documentation/tests/configuration.

The handover is the consolidated product and technical history from prior ChatGPT/OpenCode work, including later corrections that supersede older assumptions.

Critical rules:

1. Do not lose any capability or small UX/security requirement from the handover.
2. When older and newer decisions conflict, explicitly identify the conflict and apply the later decision.
3. Do not assume historical phase numbers reflect the repository's actual implementation state.
4. Use repository evidence, not assumptions.
5. Do not claim external Docker/OpenShift behavior passed unless you actually verify it.
6. Preserve all security/masking/bounded-query rules.
7. Treat portable Docker Compose deployment as a first-class requirement.
8. Treat remote Docker as optional; it must support a sensible default port, custom port, and optional TLS. Do not require users to expose Docker TCP in environments where that is blocked or unsuitable.
9. Preserve the exact time-range and seven-column results-table behavioral invariants from the screenshot-driven fixes.
10. Do not begin coding until the implementation plan is complete.

Produce:

A. Repository/current-state assessment.
B. Requirement-to-code traceability matrix.
C. Missing/partial/broken capability inventory.
D. Architecture and security assessment.
E. Conflicts/superseded decisions list.
F. Detailed phased execution plan from the CURRENT repo state to the full target state.
G. For every phase: scope, files/modules, dependencies, tests, manual checks, PASS/FAIL/BLOCKED criteria, regressions, and recovery strategy.
H. Portable Docker Compose deployment plan and verification.
I. Remote Docker connectivity/configuration plan.
J. OpenShift/Loki plan.
K. UX/browser/accessibility verification plan.
L. Final acceptance checklist.

Do not silently omit requirements because they appear small.

At the end, include a completeness checklist that maps every numbered section of the handover to at least one planned phase or an explicit “already complete / no work required” determination.
```

────────

34. Handover Completeness Checklist

Claude Code must explicitly account for all of these:

☐ problem statement
☐ two logical sources
☐ portable Compose
☐ remote Docker port default
☐ remote Docker custom port
☐ remote Docker optional TLS
☐ remote Docker reachability failure lesson
☐ Java 21 / Spring Boot / WebFlux
☐ React/TS/Vite
☐ no MVP DB
☐ single deployable image
☐ canonical top-level fields
☐ all MDC fields
☐ literal dotted correlation key
☐ correlation precedence
☐ unknown fields
☐ malformed raw fallback
☐ timestamp normalization
☐ sensitive masking
☐ no raw/sensitive logs
☐ safe text rendering
☐ source capability model
☐ source registry/APIs
☐ bounded query
☐ time limits
☐ result limits
☐ concurrency limits
☐ cancellation
☐ simple query DSL
☐ raw LogQL gating
☐ Docker Compose labels
☐ Docker framing
☐ Docker read-only rule
☐ OpenShift Loki gateway
☐ tenant/path/labels configurable
☐ TLS verification
☐ compact professional shell
☐ searchable services
☐ severity behavior
☐ universal search
☐ advanced filters
☐ Last 1 day
☐ no-result “Search last 1 day”
☐ custom range draft/apply/cancel
☐ Asia/Kuwait display
☐ UTC exactly once
☐ time validation
☐ seven table columns
☐ missing cell —
☐ semantic table
☐ action seventh cell
☐ message vs service mapping
☐ newest-first
☐ one pagination model
☐ truthful counts
☐ <=2px geometry verification
☐ loading state
☐ error state
☐ empty state
☐ cancelled state
☐ partial/truncated state
☐ event inspector
☐ local + UTC timestamps
☐ protected actor section
☐ request-flow section
☐ business/error section
☐ raw/all-fields secondary
☐ ±30 sec context
☐ trace investigation
☐ correlation investigation
☐ journey multi-trace investigation
☐ JMS event correlation
☐ timestamp order ≠ guaranteed causality
☐ previous search restoration
☐ SSE live
☐ Docker upstream cancellation
☐ Loki capability gating
☐ bounded backend buffer
☐ bounded frontend buffer
☐ 1,000 initial displayed-live cap
☐ pause/resume/stop
☐ dropped counts
☐ responsive widths
☐ accessibility
☐ zoom/reflow
☐ no page horizontal overflow
☐ centralized design tokens
☐ no fabricated branding
☐ non-root image
☐ Compose profile for Docker socket
☐ Docker socket security warning
☐ .env.example
☐ portable run requirements doc
☐ deterministic smoke tests
☐ OpenShift manifests
☐ no cluster-wide RBAC
☐ secret refs only
☐ independent verification
☐ recovery prompts/process
☐ PASS/FAIL/BLOCKED honesty
☐ final stakeholder tasks
☐ deferred/non-goals preserved

────────

35. Provenance / Historical Sources Used for This Handover

The consolidated handover was reconstructed from the project conversation history and the project artifacts previously generated during the Log Explorer work, including:

1. OpenCode_Qwen_Log_Explorer_MVP_Prompt_Pack.md
  • original project contract;
  • canonical fields and masking;
  • phases for source abstraction, Docker, Loki, query language, frontend, search, correlation, live tail, packaging, integration, final acceptance.
2. OpenCode_Qwen_Log_Explorer_Professional_UX_Prompt_Pack.md
  • enterprise UX redesign;
  • personas;
  • toolbar;
  • advanced filters;
  • inspector;
  • correlation workspace;
  • accessibility/responsive/performance gates;
  • final stakeholder acceptance.
3. OpenCode_Qwen_Docker_Search_Diagnose_Fix_Verify.md
  • screenshot-driven time-range fixes;
  • exact seven-column table rules;
  • layout regression symptoms;
  • truthful count requirements;
  • <=2px browser geometry verification.
4. Project conversation decisions after these packs:
  • remote Docker port default + override;
  • TLS optional for remote Docker;
  • failed port 2375 external reachability;
  • preference for a simpler verification path;
  • conclusion that direct remote Docker exposure likely will not fit the work environment;
  • requirement to generate Docker image(s) and run the solution through Docker Compose on other machines;
  • requirement for a Markdown run/requirements guide;
  • phase-verification recovery workflow.

────────

36. Final Instruction to the Next Agent

The biggest handover risk is not technical complexity; it is requirement loss.

Do not simplify the project by silently dropping “small” behaviors. Many of the small items came from real failures observed during validation:

• incorrect time semantics;
• broken table alignment;
• shifted columns;
• duplicated rows;
• misleading counts;
• unreachable Docker endpoints;
• unsafe assumptions about TLS/networking.

Treat them as product requirements, not incidental bug notes.

The implementation plan must therefore be evidence-driven, traceable, phased, independently verifiable, and portable.
