# Log Explorer — User Guide

This guide explains how to use Log Explorer to investigate application
logs. It does not assume you know anything about how the application is
built — only what you see on screen.

New to Log Explorer? Start with **[QUICK_START_EN.md](QUICK_START_EN.md)**
for a 10-minute walkthrough. This guide goes deeper into each area.

**Other guides in this folder:**
- [QUICK_START_EN.md](QUICK_START_EN.md) — the fastest way to get going
- [TROUBLESHOOTING_EN.md](TROUBLESHOOTING_EN.md) — symptom → cause → fix
- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) — what each source can and can't do
- Arabic versions: `USER_GUIDE_AR.md`, `QUICK_START_AR.md`, `TROUBLESHOOTING_AR.md`

---

## 1. What Log Explorer is for

Log Explorer helps you answer four questions about something that
happened in your application:

- **WHO** did it, or who was involved? (a user, a customer, a device)
- **WHAT** happened? (the message, the error, the business step)
- **WHY** did it happen? (the error details, related events, the request flow)
- **WHERE** did it happen? (which service, container, pod, or environment)

It reads logs from one **source** at a time — a local Docker setup, a
remote Docker host, or an OpenShift cluster (directly, or through Loki) —
and gives you one consistent way to search, inspect, and follow them
live, regardless of where they come from.

---

## 2. The main screen, at a glance

Across the top:

- **Source** — a dropdown choosing where logs come from (see §4).
- **Time range** — a preset button (e.g. "Last 1 day") that opens a menu
  of other presets, or a custom start/end you set yourself.
- Quick severity buttons (**All**, **Errors only**) and a **Trace/Debug**
  toggle for noisy levels that are hidden by default.
- **More filters** — opens a drawer with every other filter, grouped by
  question (see §9).
- **Search** — runs the search with whatever is currently set.
- **Live** — starts streaming new events as they arrive (only shown when
  the selected source supports it).

In the top-right corner:

- **Privacy & masking** — a global setting, not tied to any one source (§16).
- **Docker settings** / **OpenShift** — settings specific to that one source (§17).
- A keyboard-shortcuts button and a source **health** indicator.

Below that: your active filters as removable chips, then the results
table, which fills most of the screen.

![Search results screen, Fixture source](screenshots/01-search-results.png)

*Screenshot note: every screenshot in this guide is captured against the
built-in Fixture source (fully fake, safe sample data) at the current
functional baseline. They document how the app works today — they are
NOT the visual target for the upcoming redesign.*

---

## 3. Sources overview

| Source | What it is | When to use it |
|---|---|---|
| **Fixture** | A built-in, deterministic set of sample events. Not connected to anything real. | Trying out Log Explorer, or verifying it works, without any real system. |
| **Docker** | Reads container logs from a Docker engine — local or remote. | Investigating a service running in Docker Compose or a plain Docker host. |
| **OpenShift** | Reads pod logs directly from an OpenShift/Kubernetes cluster via its API. | Investigating a service running on OpenShift, with the richest set of capabilities (Live, Context, Correlation). |
| **OpenShift Loki** | Reads the same cluster's logs through a Loki gateway instead of the pod-log API. | An alternative view of OpenShift logs when a LokiStack is deployed. Currently has fewer capabilities than direct OpenShift (see the [Capability Matrix](CAPABILITY_MATRIX.md)). |

Not every source supports every feature — Log Explorer only ever shows
you a control (Live, Context, Correlation, Raw query) when the currently
selected source actually supports it. If you don't see a button, that
source doesn't offer it; nothing is hidden arbitrarily.

Full detail on each source: §4 (Docker), §5 (OpenShift), §6 (Loki).

---

## 4. Docker — connecting and using it

### Local Docker

If Log Explorer is running on the same machine as your Docker engine,
select **Docker** as the source — nothing else to configure. Log
Explorer only ever reads container information and logs; it never
starts, stops, or changes anything in Docker.

### Remote Docker

Click **Docker settings** in the top-right corner:

1. Set **Mode** to **Remote**.
2. Enter the **Host** (the machine's address).
3. **Port** defaults to `2375`. Change it only if your Docker daemon
   listens on a different port.
4. Turn on **Use TLS** only if your remote Docker daemon requires it,
   and provide the **Certificate directory path** on the machine
   running Log Explorer's backend. TLS verification is always fully
   checked when enabled — there is no way to turn verification off
   while TLS is on.
5. Click **Test Connection** to confirm before relying on it.

You are **not** required to expose your Docker daemon's TCP port just to
use Log Explorer with a local setup — remote mode is only needed when
Log Explorer itself runs somewhere other than the Docker host.

### Compose projects, services, and containers

Once connected, Log Explorer discovers any Docker Compose projects it
can see. Selecting one scopes your search to that project's containers.
You can further narrow by service inside the **More filters** drawer.
Both running and stopped containers' logs are readable, where Docker
itself still has them.

### Common Docker errors

See [TROUBLESHOOTING_EN.md](TROUBLESHOOTING_EN.md) for "Docker
unreachable," "Remote Docker port blocked," and "Remote Docker TLS
failure."

---

## 5. OpenShift — connecting and using it

Click **OpenShift** in the top-right corner. You will see a form asking
for a **Connection name** (optional, just a label for yourself) and a
place to paste your `oc login` command.

**Important:** Log Explorer reads the `--server`, `--token`, and
`--certificate-authority` values out of the command you paste — it never
**runs** `oc`, and it never needs the `oc` tool installed. Paste exactly
what `oc login` printed for you (or what you'd type to run it), for
example:

```
oc login --token=sha256~xxxxxxxx --server=https://api.example.com:6443
```

The token is held in memory for this session only. It is never written
to disk, never shown again once submitted, and never appears in any
screen you can copy from.

### Proxy settings

If your network requires a proxy to reach the cluster, the same
**OpenShift** panel has a **Proxy** section with three choices:

- **Use system proxy** (the default) — honors your machine's
  `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` environment variables,
  exactly the way command-line tools like `oc` or `curl` already do.
- **Direct connection** — never uses a proxy, even if one is configured
  on your machine.
- **Custom proxy** — enter a **Proxy server** and **Proxy port**
  directly in Log Explorer. This does not depend on any environment
  variable, so it works the same way no matter how you started Log
  Explorer (Start Menu, a `.app` from Finder, or a terminal).

Whichever mode you choose applies consistently to both the OpenShift API
and OpenShift Loki — you never end up with one going through a proxy
and the other not.

Never paste your token into a proxy field, a URL, or anywhere other than
the `oc login` box — Log Explorer has no use for it there and it would
not be protected.

### Project, Workload, Pod, Container

After connecting, choose a **Project** (or **Namespace**, if your
cluster only exposes that). Underneath it you can optionally narrow
further:

- **Workload** — a specific Deployment/DeploymentConfig/StatefulSet/
  DaemonSet, or **All workloads** to search everything in the project.
- **Pod** — a specific pod, or **All matching pods**.
- **Container** — a specific container once a pod is selected, or **All
  applicable containers**.

Leaving a level at "All" is normal and often what you want — it searches
across every replica of a workload, for example, which is useful when
you don't yet know which specific pod is involved.

### Search, Inspector, Context, Correlation, Live

Once a project (and optionally a narrower scope) is selected, Search,
the Inspector, Context ("Show surrounding logs"), Correlation, and Live
all work exactly as described in their own sections below (§9, §14–§17,
§19) — OpenShift is the source with the fullest set of capabilities.

**During a rolling update:** if a workload is being redeployed while you
are using Live, Log Explorer keeps following the same pods it started
with rather than silently switching to new ones mid-investigation — if
those pods terminate, it tells you plainly rather than pretending
nothing changed.

---

## 6. OpenShift Loki

Loki reads the same cluster's logs, but through a Loki gateway instead
of the direct pod-log API. Select the **OpenShift Loki** source the same
way you'd select any other source.

**Be aware of what's different from direct OpenShift:**

- No Project → Workload → Pod → Container scope selector — Loki search
  is scoped by label filters instead.
- No Live tail and no "Show surrounding logs" context view currently.
- A **Raw query** mode may be available if your administrator has
  enabled it, letting you write a LogQL query directly — this is
  strictly optional and off by default.

See the [Capability Matrix](CAPABILITY_MATRIX.md) for the exact,
current, row-by-row comparison — Log Explorer never implies Loki
supports something it doesn't.

**Honesty about verification:** the Loki-specific proxy and connection
logic is implemented and tested the same way as OpenShift's, but running
it against a real Loki gateway has not been possible in this project's
own development/testing environment (no reachable Loki instance was
available). If something about your specific Loki gateway behaves
differently than expected, that is the most likely reason — please
report it.

---

## 7. The Fixture source

**Fixture** is a safe, self-contained, deterministic set of sample log
events built into Log Explorer. It requires no connection to anything.
Use it to learn the tool, or to confirm Log Explorer itself is working,
before connecting to a real system.

---

## 8. Time range

Click the time-range button to open a menu of presets: **Last 15
minutes, Last 30 minutes, Last 1 hour, Last 4 hours, Last 1 day, Last 7
days**, or **Custom**.

Choosing **Custom** opens a small popover with **Start** and **End**
fields, an **Apply**, and a **Cancel**. Apply commits your range and
shows you exactly which dates/times and time zone are now active — never
a vague "Custom range" label. Cancel, pressing Escape, or clicking
outside the popover closes it without changing anything.

If a search returns zero results, Log Explorer offers a one-click
**"Search last 1 day"** shortcut rather than leaving you guessing.

---

## 9. Search and filters

### Newest / Oldest

A toggle near the results controls whether the newest or oldest matching
events load first. This is the same setting the Time column's own
sort button uses (see §11) — there is always exactly one current sort
direction, never two disagreeing controls.

### Quick filters (always visible)

- **Service** — pick one or more services/applications.
- **Severity** — **All** or **Errors only**, plus a separate toggle to
  include the noisier **Trace/Debug** levels (hidden by default).
- The search box — free text, and it also recognizes when you paste in
  something that looks like a known identifier (a trace ID, a
  correlation ID, etc.) and offers to search that field specifically.

### More filters (the drawer)

Opens a set of fields grouped by the question they answer:

**Who / customer** (masked by default — see §16)
- User name, Customer ID, CIF, Device ID, Device IP

**Request flow**
- Trace ID, Span ID, Correlation ID, Journey ID, Event ID

**What happened**
- Error code, Business step, UI identifier, Logger/class contains, Message contains

**Client context**
- Device platform, Language

Each field is labeled with how it matches — **exact** match (the value
must match precisely) or **contains** (a substring match), so you always
know what kind of search you're running.

### Example

To find everything related to one failed payment, you might: set
**Severity** to Errors only, open **More filters**, and enter the
**Trace ID** you already have from a support ticket — or, if you don't
have one yet, search **Message contains** for `payment failed` first,
open one result, and get the Trace ID from its Inspector (§15) to search
more broadly from there.

### Advanced query and Raw LogQL

An advanced query builder is available for combining conditions beyond
what the quick filters/drawer expose. **Raw LogQL** (writing a native
Loki query directly) is offered only for the OpenShift Loki source, only
when your administrator has enabled it, and is always bounded — never a
way to run an unrestricted query.

---

## 10. Results table

Each row is one log event. Default columns:

| Column | Meaning |
|---|---|
| Time | When the event happened (date, time, milliseconds) |
| Level | Severity (Trace/Debug/Info/Warn/Error) |
| Service | Which application/service produced it |
| What happened | The log message |
| User/Customer | Who was involved (masked by default) |
| Correlation/Trace | The request-flow identifier, if any |
| Actions | A "…" menu with row-level actions |

A missing value always shows as `—` — a cell is never left blank, so you
can always tell "no value" apart from "didn't load yet."

### Sorting

Click any sortable column header to sort by it: first click sorts
ascending, a second click sorts descending, and the header shows an
arrow so you always know which way it's sorted. Clicking the **Time**
header is the same action as the Newest/Oldest toggle (§9) — there is
never a second, silently-different sort happening underneath.

### Choosing and reordering columns

Click **Columns** to open a panel where you can:
- Check or uncheck any column to show/hide it.
- **Drag a row using its handle (⠿)** to reorder columns, or use the
  **Move up/Move down** buttons if you prefer the keyboard.
- Switch **density** between comfortable and compact.
- Click **Reset table** to return everything to the default seven
  columns, in their original order and density.

Changing one of these (reordering, density, sorting) never resets any
of the others — they're independent, and your choices are remembered
the next time you open Log Explorer.

### Selecting a row, and Load More

Click any row (or press Enter on a focused row) to open it in the
Inspector (§15). The selected row stays visibly marked even after you
resize columns, change density, or load more results.

If more results exist than are currently loaded, a **Load More** action
appends the next page — your current column/sort/selection state is
preserved across it.

### If results are cut off

If a search hits its bounds (a very large time range, a very common
filter), Log Explorer tells you plainly how many results are shown out
of how many actually matched, rather than silently truncating.

---

## 11. The Event Inspector

Click a row to open the Inspector. It always has exactly five tabs, in
this order:

1. **Overview** — the core facts: message, time, source, service, level, logger.
2. **Actor & client** — who/what was involved (masked fields, device, language).
3. **Request flow** — Trace/Span/Correlation/Journey/Event IDs, each with a Copy button, and a "Find this…" action where applicable (§13).
4. **Business / error** — business step, UI identifier, error code, and the full exception text if one exists.
5. **Technical / all fields** — every field the event carries, including ones Log Explorer doesn't specifically recognize. A search box lets you filter a long field list; a **Raw JSON** disclosure shows the complete underlying record.

**All five tabs are always there, for every event — this is deliberate.**
If an event genuinely has no actor/client data, that tab still appears
and says so plainly (e.g. "No actor or client data on this event")
instead of disappearing. A tab that vanishes could mean "this category
doesn't apply here" or "the UI hid something" — Log Explorer never makes
you guess which. Unknown/custom fields are never discarded; they always
remain visible on the Technical / all fields tab.

Use **Previous**/**Next** (or the `[`/`]` keys) to step through the
currently loaded results without closing the Inspector. Selecting a
different event always returns you to the Overview tab.

![Event Inspector, Overview tab](screenshots/02-inspector-overview.png)
![Event Inspector, Request flow tab](screenshots/03-inspector-request-flow.png)

**What the Inspector will not do:** it will never guess at a cause it
can't prove from the data. If an error's root cause isn't in the log
event itself, the Inspector shows you what evidence does exist (the
exception, related identifiers) rather than inventing an explanation.

---

## 12. Show surrounding logs

From an open event, click **Show surrounding logs** in the Inspector's
header. It shows the exact ±30-second window before and after that
event, from the **same execution context** — the same container, pod,
or equivalent scope the original event came from, never silently
widened to a different pod or service.

- The event you started from is clearly marked — a visible highlight, a
  label, and it is automatically scrolled into view — so you never lose
  track of which one you were originally looking at.
- Events are shown in true chronological order, independent of whatever
  Newest/Oldest setting was active in your main search.
- If the window is only partially available (e.g. you were looking at
  the very first or last event in the stream), Log Explorer says so
  rather than pretending the context is complete.
- A **"Back to search"** action returns you to your original results,
  filters and all, exactly as you left them.

![Show surrounding logs, with a detected gap](screenshots/04-surrounding-logs.png)

**This is not the same thing as Correlation** — surrounding logs answers
"what happened right around this one event, in this one place," while
Correlation (§13) answers "what other events across services share this
request." Use surrounding logs when you want tight, local context; use
Correlation when you're following one request across your system.

---

## 13. Correlation, Trace, and Journey — following a request

Many events carry one or more of: a **Trace ID**, **Correlation ID**, or
**Journey ID** — identifiers meant to tie related events together, even
across different services.

A practical flow:

1. Open an event in the Inspector and go to **Request flow**.
2. If a **"Find this Trace/Correlation/Journey"** button appears next to
   an identifier, click it to open a timeline of every event sharing
   that identifier, across every service that logged one.
3. Read the timeline in order to see the sequence: which service acted
   first, what happened next, and where (if anywhere) an error appears.
4. Open any entry in that timeline for its own full Inspector detail.
5. Return to your original results whenever you're done — nothing about
   your original search is lost while you were following the journey.

**Important:** this shows you the observed **order** of events — it does
not prove that one event *caused* the next. Two events can be close in
time without one being the reason for the other; Log Explorer only ever
tells you what the timestamps and identifiers actually show.

---

## 14. Live logs

Click **Live** (shown only when the selected source supports it) to
start streaming new events as they happen.

- **Start** begins streaming. The panel shows how many events have been
  **Received** and how many are currently **Visible** (your filters
  still apply to a live stream).
- **Pause** stops new events from appearing in the list, but keeps
  counting them in the background as **Buffered**, so nothing is lost —
  click **Resume** to catch up.
- **Stop** ends the stream. **Start** again begins an entirely fresh
  session (the counts reset — the previous connection is genuinely
  closed, not just hidden).
- **Clear** empties the visible list without stopping the connection.
- **"← Back to search results"** exits Live and returns you to Search.
  This button is a real, native button — reachable and usable with the
  Tab key and Enter/Space, not just a mouse click.

For an OpenShift workload with multiple replicas, Live can follow all of
them together, and honestly shows you if only some are currently
reachable (e.g. "LIVE (2/4 active)") rather than a plain "LIVE" that
would overstate what's actually connected. If the connection drops, Log
Explorer reconnects automatically where possible; if it can't, it tells
you plainly rather than silently going quiet.

Live tail is **not** a substitute for a complete historical record — it
only shows what arrives while you're watching, and a disclaimer to that
effect is always visible while it's running.

![Live logs streaming, Fixture source](screenshots/05-live-tail.png)

---

## 15. Privacy & masking

Click **Privacy & masking** in the top-right corner. This setting is
**global** — it applies the same way no matter which source you're
using (Fixture, Docker, OpenShift, or Loki).

![Privacy & masking settings](screenshots/06-privacy-masking.png)

Five fields are protected: **CIF, Username, Customer ID, Device ID,
Device IP**. Each has its own checkbox:

- **Checked (the default)** — the field is masked. The server never
  sends the real value to your browser at all for this field.
- **Unchecked** — you have explicitly chosen to allow this field to
  appear in **new** search results and events going forward.

A few things to understand clearly:

- Unmasking a field does **not** reveal values you already have on
  screen. Log Explorer never keeps a hidden, unmasked copy of anything
  in your browser to "reconstruct" later — only requests made *after*
  you change the setting can return the raw value.
- There is no per-row "reveal" button anywhere in the product. The only
  way to see a raw value is to disable masking for that field in this
  global setting, run a new search, and look at the new results.
- Turning masking off, even briefly, means that field's real values can
  appear on your screen, in screenshots you take, and potentially in
  anything else pointed at your screen while it's off. Only disable a
  field's masking when you genuinely need to, and re-enable it
  afterward.

Never copy an unmasked value into an insecure place (chat, an unencrypted
file, a ticket visible to people who shouldn't see it) — treat an
unmasked value exactly as sensitively as you would the original system's
own raw data, because that is exactly what it is.

---

## 16. Settings — what's global vs. source-specific

It helps to know which settings affect the whole application and which
only affect one source:

| Setting | Scope |
|---|---|
| **Privacy & masking** | Global — the same policy applies to every source |
| **Docker settings** | Only affects the Docker source (local/remote connection) |
| **OpenShift** (connection + proxy) | Only affects OpenShift and OpenShift Loki |

Changing a source-specific setting never affects a different source —
switching your Docker connection, for example, has no effect on your
OpenShift connection or your masking policy.

---

## 17. Keyboard basics

Most of the core workflow is reachable without a mouse:

- Tab moves between controls; the results table is one stop, and
  Arrow keys move between rows once it has focus.
- Enter opens the focused row's Inspector.
- `[` / `]` move to the Previous/Next event while the Inspector is open.
- Escape closes the topmost open panel (a menu, the Inspector, a
  popover) without affecting anything behind it.
- In the Inspector's tab list, Left/Right arrows move between tabs, and
  Home/End jump to the first/last tab.
- Live's "← Back to search results" button, like every other control in
  the product, is a real button — Tab reaches it, Enter/Space activates it.

A full shortcuts list is available from the keyboard icon in the
top bar.

---

## 18. Getting help when something goes wrong

See **[TROUBLESHOOTING_EN.md](TROUBLESHOOTING_EN.md)** for specific
symptoms and fixes. It covers connection failures, TLS/certificate
errors, proxy issues, permission errors, Live disconnects, and more.
