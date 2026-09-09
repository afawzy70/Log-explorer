# Stakeholder Demo Script — Multi-Source Log Explorer MVP

**Estimated duration:** 5–10 minutes

## 0. Setup (before demo)

- Ensure backend is running: `cd backend && mvnw spring-boot:run`
- Ensure frontend is running: `cd frontend && npm run dev`
- Open http://localhost:5173 in browser
- Have the Docker desktop / Docker daemon running on your machine

---

## Step 1: Starting the App (~30s)

> "Log Explorer is a web tool that lets you explore structured Spring Boot logs from multiple sources through a single clean interface."

- Open the application in the browser.
- Highlight the initial page: source selector, filters, search area.
- Point out the **System Info** badge showing version.

---

## Step 2: Switching Sources (~60s)

> "The app supports multiple log sources. You switch between them explicitly — it never silently changes."

- Click the source selector dropdown.
- Select **Local Docker Compose** (badge: `⬡ Local`).
  - Note the health indicator turns green when Docker is reachable.
  - The available services list populates from running containers.
- Switch to **OpenShift Development** (badge: `◆ OpenShift`).
  - Show the health indicator state (green if configured, or red with a Retry button).
  - Emphasize that switching aborts any in-flight request and clears results.
- Switch back to **Local Docker Compose** for the rest of the demo.

---

## Step 3: Running a Search with Filters (~90s)

> "Let's search for recent log events with some filters applied."

- Set time range: click **Last 30 min**.
- Set level filter: toggle **ERROR** and **WARN** chips.
- Enter a free-text query in the search box, e.g., `timeout` or `error`.
- Click **Run** (or press **Ctrl+Enter**).
- Show the results table:
  - Timestamp column (ISO 8601)
  - Severity badge with color and text class
  - Service name
  - Message (truncated)
  - Origin badge (Docker container name)
- Point out the **Search Meta** bar: execution duration, result count, truncated badge if applicable.

---

## Step 4: Examining Event Details (~60s)

> "Click any row to see the full event details."

- Click a result row to open the **Event Detail** drawer.
- Highlight:
  - Canonical fields: timestamp, level, logger, thread, message
  - IDs: traceId, spanId, correlationId, eventId
  - MDC section with **masked** sensitive fields (`cif: ***`, `CustomerId: C***`, etc.)
  - Raw fields for unknown MDC entries
  - Exception stack trace in a formatted `<pre>` block (if present)
- Point out that sensitive fields are masked server-side and never returned in raw form.
- Show the copy button on traceId (present) vs. absence of copy on MDC (sensitive data guard).
- Press **Escape** or click outside to close the drawer.

---

## Step 5: Following a Trace (~60s)

> "When you find an interesting event, you can trace its journey across services."

- Open an event detail that has a traceId or correlationId.
- Click the **Show timeline** button (or the **Find** button on the traceId).
- Show the **Event Timeline**:
  - Events sorted chronologically across services
  - Per-service left-border color coding
  - Multiple trace IDs visible when they belong to one journey
  - The "Return to search" button to go back
- Emphasize: "This is timestamp-based chronological order, not guaranteed causal order."
- Click **← Return to search** to go back to the results list.

---

## Step 6: Starting Live Tail (~45s)

> "For real-time monitoring, we have a live tail feature."

- Scroll to the **Live Tail** section.
- Click **Start** to begin the live stream.
- Show events arriving in real time.
- Point out the bounded buffer and current event count.
- Emphasize: "Live tail only captures new events — it does not contain complete historical data."

---

## Step 7: Pausing and Resuming Live Tail (~30s)

> "If the stream gets too fast, you can pause it to review."

- Click **Pause** — the display freezes but the connection stays open.
- Note the buffered/dropped event counts.
- Click **Resume** — rendering resumes, buffering continues.

---

## Step 8: Stop Live Tail and Return to Search (~15s)

> "When you're done with live tail, stop it and return to search."

- Click **Stop** — the SSE connection closes.
- Scroll back up to the search area.
- Run a new search or adjust existing filters.
- Point out that preferences (source, time range, levels) are persisted in the browser.

---

## Closing (~15s)

> "This MVP demonstrates source-agnostic log exploration with sensitive data masking,
> guided queries, cross-service correlation, and real-time tailing.
> It's not production-ready — SSO, RBAC, and audit are planned for later —
> but the core UX is here and working. Thank you."
