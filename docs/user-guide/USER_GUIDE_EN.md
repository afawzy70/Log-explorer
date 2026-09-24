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
the Inspector, Show Surroundings, the Investigation Workspace, and Live
all work exactly as described in their own sections below (§9, §12–§17,
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
- No Live tail and no "Show Surroundings" context view currently.
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
fields, an **Apply**, and a **Cancel**. It floats above the toolbar as an
anchored overlay — opening or closing it never shifts or resizes any
other toolbar control (Source, Service, Severity, search, Search, Live all
stay exactly where they were). Apply commits your range and shows you
exactly which dates/times and time zone are now active — never a vague
"Custom range" label. Cancel, pressing Escape, or clicking outside the
popover closes it without changing anything.

If a search returns zero results, Log Explorer offers a one-click
**"Search last 1 day"** shortcut rather than leaving you guessing.

---

## 9. Search and filters

Changing a filter — typing in a field, checking a box, picking a
service — only ever edits your *draft* criteria; nothing is sent to the
source until you actually click **Search** (or press Enter in the search
box). There is no search-as-you-type. Every click of **Search** re-runs
the query against the selected source from scratch, with your full
current criteria (time range, severity, services, advanced filters, tags,
query text) — it is never a filter applied only to whatever page of
results happened to already be loaded, so if a matching event exists
further back in the source's own history but still inside your time
window, a fresh Search can find it even if an earlier, broader search's
results didn't happen to include it.

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

**Who / customer** (protected — masking is configurable per field, see §15)
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
| Tags | Classification tags a saved rule matched on this event (see "Event classification rules" below), shown as one chip plus a "+n" count when there's more than one |
| User/Customer | Who was involved (masked or not, per your current Privacy & masking settings — see §15) |
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

Log Explorer loads up to 500 matching events per page by default (an
administrator can change this bound), and **Load More** requests the same
page size again — your current column/sort/selection state is preserved
across it. "500" always means 500 events that actually matched your
filters, never 500 raw log lines minus whatever got filtered out.

### If results are cut off

If a search hits its bounds — more matches exist than fit in one page, or
(for the Docker source specifically) a very busy container's history
couldn't be fully scanned within Log Explorer's own bounded search
effort — Log Explorer tells you plainly that the results are partial
rather than silently truncating or claiming an exact total it can't
prove. Narrow your time range or filters, or use **Load More**, to see
more.

---

## 11. The Event Inspector

Click a row to open the Inspector. Five tabs are always there, for every
event, in this order:

1. **Overview** — the core facts: message, time, source, service, level, logger. For an event that
   carries real error information (see below), an **Error Summary** appears near the top — severity,
   error code, the exception's type where it can be determined, and a short readable preview of the
   exception message — with a **View full error details** button that jumps straight to the Error tab.
   A non-error event shows no Error Summary at all; Log Explorer never claims or implies an event failed
   when the data doesn't say so.
2. **Actor & client** — who/what was involved (masked fields, device, language).
3. **Request flow** — Trace/Span/Correlation/Journey/Event IDs, each with a Copy button, and an investigation action where the identifier is present (§13): **View Trace**, **View Span**, **Find same Correlation**, **Find same Journey**, or **Find same Event**.
4. **Business** — business step and UI identifier only. It never mixes in error or exception data.
5. **Technical / all fields** — every field the event carries, including ones Log Explorer doesn't specifically recognize. A search box lets you filter a long field list. Two separate disclosures underneath show the underlying record two different ways: **Canonical Event JSON** is Log Explorer's own parsed, normalized representation of the event, while **Raw source JSON (masked)** is the real, untouched line the source actually sent — real field names and any extra or unexpected field a parsing rule doesn't yet recognize, with the five protected fields (CIF, username, customer ID, device ID, device IP) masked the same way they are everywhere else. Use it to spot a field-mapping problem (a wrong path, a missing field, an unexpected shape) directly against the real data, without needing the separate Log Schema & Field Mapping workflow (§19) — that workflow's own "Original Source JSON" sample is intentionally unmasked instead, for the different, privileged job of setting mapping rules up in the first place.

A sixth tab, **Error**, appears only for an event that actually contains
error information — severity ERROR or FATAL, a real exception, or a real
error code. It shows the error code, the exception's type/class where
determinable, the exception message, and the complete exception/stack
trace, preserved with its original line breaks in a readable monospace
block (never squeezed onto one line, never truncated) with its own
**Copy** button. If the severity is ERROR/FATAL but the event carries no
exception or error code, the tab says so plainly rather than inventing a
trace. The Error tab is the one deliberate exception to "every tab is
always there": showing it for an event with nothing to say about an error
would be a diagnostically meaningless tab, not a diagnostically honest
empty one.

**The other five tabs are always there, for every event — this is
deliberate.** If an event genuinely has no actor/client data, that tab
still appears and says so plainly (e.g. "No actor or client data on this
event") instead of disappearing. A tab that vanishes could mean "this
category doesn't apply here" or "the UI hid something" — Log Explorer
never makes you guess which. Unknown/custom fields are never discarded;
they always remain visible on the Technical / all fields tab.

Use **Previous**/**Next** (or the `[`/`]` keys) to step through the
currently loaded results without closing the Inspector. Selecting a
different event always returns you to the Overview tab — including when
the Error tab you were just looking at doesn't exist for the newly
selected event.

![Event Inspector, Overview tab](screenshots/02-inspector-overview.png)
![Event Inspector, Request flow tab](screenshots/03-inspector-request-flow.png)

**What the Inspector will not do:** it will never guess at a cause it
can't prove from the data. If an error's root cause isn't in the log
event itself, the Inspector shows you what evidence does exist (the
exception, related identifiers) rather than inventing an explanation.

---

## 12. Show Surroundings

From an open event, click **Show Surroundings** in the Inspector's
header (it appears the same way, and does the same thing, from a
result row's own Actions menu, and from inside an investigation
timeline — see §13). It shows the exact ±30-second window before and
after that event, from the **same execution context** — the same
container, pod, or equivalent scope the original event came from, never
silently widened to a different pod or service.

- The event you started from is clearly marked — a visible highlight, a
  label, and it is automatically scrolled into view — so you never lose
  track of which one you were originally looking at.
- Events are shown in true chronological order, independent of whatever
  Newest/Oldest setting was active in your main search.
- If the window is only partially available (e.g. you were looking at
  the very first or last event in the stream), Log Explorer says so
  rather than pretending the context is complete.
- A **Back** action returns you to wherever you actually launched it
  from — your original results if you started from Search, or the same
  investigation timeline (Trace/Span/Correlation/Journey) if you started
  from inside one, exactly as you left it.

![Show Surroundings, with a detected gap](screenshots/04-surrounding-logs.png)

**This is not the same thing as following a request** — Show
Surroundings answers "what happened right around this one event, in this
one place," while the Investigation Workspace (§13) answers "what other
events, anywhere, share this request." Use Show Surroundings when you
want tight, local context; use the Investigation Workspace when you're
following one request across your system.

---

## 13. The Investigation Workspace — following a request

Many events carry one or more of: a **Trace ID**, **Span ID**,
**Correlation ID**, **Journey ID**, or **Event ID** — identifiers meant
to tie related events together, even across different services. Opening
any of them replaces your results table with a dedicated **Investigation
Workspace**: a distinct surface from Search/Results (which finds events)
and the Inspector (which explains one event) — this one exists to
investigate relationships and context *across* multiple events.

A practical flow:

1. Open an event in the Inspector and go to **Request flow**.
2. Click whichever investigation action is offered for the identifier you
   want to follow: **View Trace**, **View Span**, **Find same
   Correlation**, **Find same Journey**, or **Find same Event**. (The
   same actions are also offered directly from the results table's
   Correlation/Trace column, for the two most common cases.)
3. The timeline that opens always tells you, up front, how many events it
   found and — clearly marked — **which position the event you started
   from is at** (e.g. "Selected event: 4 of 12"), so you never lose track
   of where you came from. If your starting event genuinely isn't in the
   returned window (a bounded search has limits), Log Explorer says so
   honestly rather than marking a different event instead.
4. Read the timeline in order to see the sequence: which service acted
   first, what happened next, and where (if anywhere) an error appears.
5. From any entry in that timeline, you can **Show Surroundings** (§12)
   for tight local context around that specific entry, then **Back** to
   return to the same timeline — or open the entry's own full Inspector
   detail.
6. Return to your original results whenever you're done — nothing about
   your original search is lost while you were investigating.

**Important:** this shows you the observed **order** of events — it does
not prove that one event *caused* the next. Two events can be close in
time without one being the reason for the other; Log Explorer only ever
tells you what the timestamps and identifiers actually show. Each action
also means exactly what it says: "View Trace"/"Find same Correlation"/
etc. describe exactly that one relationship, and "Show Surroundings"
means nearby time/place context only — never a stand-in for one another.

---

## 14. Live logs

Click **Live** (shown only when the selected source supports it) to
start streaming new events as they happen.

- **Start** begins streaming. The panel shows how many events have been
  **Received** and how many are currently **Visible** (your filters
  still apply to a live stream, including an Include/Exclude service
  filter, if you set one in Search before starting Live).
- Once connected, if nothing has arrived yet, the panel says plainly that
  it's **waiting for new events** — never a blank space that leaves you
  guessing whether it's actually working. For a Docker source, Live only
  ever follows containers that are genuinely running right now; a
  container that has since stopped is correctly excluded (its own
  historical logs are still fully searchable — Live is specifically
  about new events from a live process).
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

- **Checked** — the field is masked. The server never sends the real
  value to your browser at all for this field.
- **Unchecked (the current default on a fresh installation)** — this
  field's real value is allowed to appear in search results and events.

**On a fresh installation, all five fields start unchecked (unmasked).**
This is a deliberate, owner-approved default — see the note below if
you remember an earlier version of Log Explorer starting masked. You can
check any field's box at any time to turn masking on for it; the change
applies immediately to new results going forward.

> **Historical note (superseded).** An earlier version of Log Explorer
> shipped with every field masked by default, requiring an explicit
> action to unmask anything. The owner later changed this default so a
> fresh installation starts fully unmasked instead — the checkbox
> control, the "no reveal action" guarantee, and every other behavior on
> this screen are unchanged; only the starting value of the five
> checkboxes moved. Like the other runtime settings in Log Explorer (the
> one exception is classification rules, which are saved configuration —
> see [Event classification rules](EVENT_CLASSIFICATION_RULES.md)), this
> policy lives only for as long as the application is running — it is
> never written to disk, so restarting the server always returns to the
> current default (now unmasked). While the server keeps running,
> nothing but an explicit click on one of these checkboxes ever changes
> the policy — an edit you make elsewhere (mapping, connection settings,
> and so on) never silently touches it.

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
| **Log Schema & Field Mapping** | Applies to how logs from any source are interpreted — see §19 |

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

---

## 19. Log Schema & Field Mapping

This is an advanced, occasional-use setting — most people never need to
open it, because Log Explorer already understands the log format its
built-in default mapping was designed for. You need it only if you
connect a source whose logs put fields (like the customer identifier or
a trace ID) in different places than Log Explorer expects by default —
for example, a field at the top level of the JSON instead of nested
under `mdc`.

**Why this exists:** every canonical field Log Explorer understands (CIF,
Username, Trace ID, Business Step, and so on) has to be found somewhere
in your actual log JSON. The built-in default mapping covers the
structure Log Explorer already knows. If your real logs use a different
structure, a field can be genuinely present in your data and still not
show up correctly in search or filtering — not because it's missing, but
because Log Explorer was never told where to look for it. This setting
lets you tell it, without needing a code change.

### The workflow

Click **Log schema & field mapping** in the top bar to open its own
dedicated page (it replaces your results while open — click **← Back to
search results** at any time to return to exactly what you had before).
The steps, in order:

1. **Connect** — make sure the source you want to configure is selected
   and connected (Docker, OpenShift, etc. — see their own sections
   above).
2. **Select the project/namespace** — for a source with a real
   sub-project concept (a Docker Compose project, an OpenShift project/
   namespace), pick the specific one you want to configure using that
   source's own scope selector (the same selector you already use to
   scope search itself). **The scan and the mapping you save both apply
   to that exact scope only** — a different project on the same source
   has its own completely separate mapping, never silently shared with
   this one. A source with no sub-project concept (Fixture, Loki) skips
   this step.
3. **Run a Quick Schema Scan** — click to scan a bounded batch of real,
   recent events **from the selected project/namespace only** (not the
   whole source, and never mixed with another project's events). Unlike a
   single sample, the scan deliberately looks for *diversity* — different
   severities (INFO/WARN/ERROR/...), different services within that same
   project, and different JSON shapes — because different kinds of events
   often carry different fields (an error event's stack trace field, for
   example, may never appear on an INFO event). The scan is bounded (by
   default up to 200 events, a few seconds, and a few megabytes) and
   always tells you truthfully if a limit was hit before it finished. The
   summary line shows the selected scope, which services were observed
   inside it, how many events were structured JSON versus non-JSON/
   infrastructure noise (e.g. a proxy's own access-log line), and how
   many distinct JSON shapes (structural variants) were found.
4. **Review Original Event Samples** — a small set of the real,
   structured-JSON events the scan actually saw **in that scope**, shown
   exactly as your source sent them, before Log Explorer changes
   anything. This is different from the Inspector's "Canonical Event
   JSON" (§11) — that one shows Log Explorer's own normalized version of
   an event; this one shows the untouched original. Non-JSON/
   infrastructure lines never appear here — they are excluded from field
   mapping entirely and, when present, are shown separately under a
   collapsed "non-JSON/malformed lines (diagnostics only)" section, purely
   so you can see why they were excluded — never usable as a mapping
   sample.
5. **Review the Discovered Source Schema** — a table of every JSON path
   the scan found across all the structured events it inspected in this
   scope, with how many events had it and what type of value it held.
   Real field names and nesting are exactly what they are in your source
   — `cif`, `cifId`, `customer.cif`, `mdc.cif` are all shown as genuinely
   distinct paths, never blurred together. This table is labeled
   **observed**, not complete — a scan can only report what it actually
   saw; it is not a mathematical proof that no other shape exists in this
   scope.
6. **Map fields** — for each canonical field Log Explorer understands
   (CIF, Username, Customer ID, Trace ID, Journey Name, and so on), pick
   a path directly from the Discovered Source Schema using the dropdown
   picker next to each field — the normal way to map a field now, no
   typing required. You can add more than one path per field, in
   priority order; Log Explorer tries them in that order and uses the
   first one that actually has a value for a given event. This is what
   fixes the "field is there but doesn't show up" problem: if your logs
   sometimes use `cif` and sometimes `mdc.cif`, add both. An "Advanced:
   enter a path manually" option remains available for a path the scan
   didn't happen to discover.
7. **Validate** — run your mapping against the samples the scan
   collected for this scope. You'll see, per field, whether it was
   actually found, what real value it resolved to, and whether any path
   has a mistake in it.
8. **Save** — commits your mapping **for the selected project/namespace
   only**. You can only save after a validation that found no path
   mistakes.
9. **Search becomes available again** — if Search was temporarily
   disabled because this scope's own mapping needed attention (see
   below), saving a valid mapping turns it back on immediately, for that
   scope. Switching to a different project/namespace immediately
   recalculates whether Search is ready **for that other scope's own
   saved mapping** — it is never silently treated as ready or blocked
   because of what you just did somewhere else.

A **Reset to defaults** action is always available if you want to
discard your changes for the currently selected scope and go back to the
built-in mapping.

### Rescanning

If your source's log shape changes later, click **Rescan** to run the
scan again at any time, for the currently selected project/namespace.
Rescanning never changes your saved mapping by itself — it only refreshes
the Original Event Samples and Discovered Source Schema for that same
scope, and:

- Highlights any path that's **newly discovered** since your last scan.
- Highlights any path that was seen before but is **no longer
  observed**.
- Warns you if one of your **saved mapping's own paths** wasn't seen in
  this scan, so you know to check whether that field's real location
  changed.

Nothing about your saved mapping changes until you explicitly edit it
and click Save.

### Verifying your mapping

A saved, search-ready mapping and a **verified** one are not the same
thing. Every canonical field starts as **Unverified** — including one
using the built-in default candidate — because Log Explorer has no
actual evidence yet that the candidate is correct for *your* source, only
that it parses without error. Each field shows one of exactly three
statuses, for the selected project/namespace only:

- **Unverified** — a candidate is set (maybe the built-in default, maybe
  one you mapped yourself), but nobody has confirmed it against real
  evidence yet.
- **Verified** — you confirmed it, and Log Explorer checked it for real:
  clicking **Verify** re-checks the field's current saved candidate
  against the real samples from your last Quick Schema Scan, and only
  turns the badge to Verified if it actually found a real value there.
  If it didn't, you'll see exactly why (e.g. "not found in any of the
  given samples") instead of a silent success. Verify needs a Quick
  Schema Scan to have been run first, and is unavailable while you have
  an unsaved edit pending for that field — save it first, so Verify
  checks what's actually live.
- **Needs change** — you reviewed a field and decided it's wrong, without
  needing to prove why first. Click **Mark needs change** to flag it;
  from there, edit its candidate path(s) (the Discovered Source Schema
  picker works the same way here as anywhere else), validate, save, and
  Verify again once you're confident.

Each candidate path also shows whether it was **observed in your latest
scan** — useful evidence when deciding whether to verify or change it.
Editing a Verified field's candidates automatically reverts it to
Unverified (the evidence that supported it no longer applies to the new
candidate); a save alone never silently turns a field back to Verified —
Verify is always its own explicit step.

### Why Search can be temporarily disabled

If you've started editing your field mapping but haven't yet validated
and saved it, Log Explorer disables Search for that data rather than
running it against a mapping it can't yet vouch for — you'll see a clear
message explaining why, instead of a search that silently comes back
empty or wrong. This only happens while you're actively mid-edit; the
built-in default mapping is always ready to search with, and finishing
the validate-and-save steps above turns Search back on right away.

### A note on privacy for this one screen

The five protected fields (CIF, Username, Customer ID, Device ID, Device
IP) may or may not currently be masked elsewhere in Log Explorer,
depending on your current Privacy & masking settings (§15). This screen
is unaffected by that setting either way: because you need to see your
*real* field names and values to set up the mapping correctly, the
Original Event Samples and validation results on this screen always show
real, unmasked values, regardless of whether masking is currently on or
off for normal search results. This is why it matters to treat this
screen carefully:

- Sample data and validation results are **never saved anywhere** — not
  to your browser's local storage, not to a file, not anywhere on the
  server. They exist only while this screen is open, in your browser's
  own memory, and disappear the moment you close the panel or reload the
  page.
- This does not change how normal search results behave anywhere else
  in the app — masking there is completely unaffected. This one setup
  screen is the only place unmasked values are ever shown, and only
  because you specifically opened it to configure the mapping.
- Treat anything you see on this screen (screenshots, screen shares) with
  the same care you'd give the original system's own raw data — because
  that is exactly what it is.

## Event classification rules

Classification rules tag events with your own labels (for example
`middleware` or `external-api`) and extract structured values such as a
URL, response code, or duration. Create one from any event with **Create
tag rule from this event** in the Event Inspector, detect a pattern from
a bounded sample of the search you are looking at, test it, and save it.
After you re-run Search, matching events show their tag — in the colour
you chose for the rule — in the **Tags** column, without opening anything.
Rules are saved on the server as
a JSON configuration file (never a database, never your logs) and can be
exported and imported as portable rule packs. Full guide:
[Event classification rules](EVENT_CLASSIFICATION_RULES.md).
