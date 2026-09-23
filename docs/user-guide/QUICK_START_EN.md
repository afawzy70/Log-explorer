# Log Explorer — Quick Start

Get productive in about 10 minutes. For more detail on any step, see the
[full User Guide](USER_GUIDE_EN.md).

## 1. Install / start Log Explorer

- **Standalone jar (recommended for most local use):** `java -jar
  log-explorer-<version>.jar`, then open <http://localhost:3434>. See the
  root [`README.md`'s "Quick start — standalone JAR"](../../README.md#quick-start--standalone-jar-recommended)
  section for requirements, OpenShift certificate setup, and troubleshooting.
- **Desktop app (Windows or macOS):** run the installer, then launch Log
  Explorer like any other application. It opens in your default browser.
- **From the repository (developers):** follow `docs/RUN_GUIDE.md`.

The first time you launch it on Windows or macOS, you may see an
"unrecognized app" / "unidentified developer" warning — this is expected
for an unsigned build; see
[TROUBLESHOOTING_EN.md](TROUBLESHOOTING_EN.md#desktop) for how to proceed
safely.

## 2. Choose a source

At the top-left, open the **Source** dropdown. If you're just trying
things out, pick **Fixture** — it needs no setup at all.

## 3. Configure a connection (only if needed)

- **Docker (remote)** or **OpenShift**: click the matching settings
  button in the top-right corner and fill in what's asked. See the
  [Docker guide](USER_GUIDE_EN.md#4-docker--connecting-and-using-it) or
  [OpenShift guide](USER_GUIDE_EN.md#5-openshift--connecting-and-using-it).
- **Fixture** and already-configured **local Docker**: nothing to do —
  skip to the next step.

## 4. Run your first search

Set a **Time range** (or leave the default), optionally narrow
**Service**/**Severity**, and click **Search**.

## 5. Select a result

Click any row in the results table.

## 6. Inspect the event

The Inspector opens on the right, showing **Overview**, **Actor &
client**, **Request flow**, **Business**, and **Technical / all fields**
as five stable tabs — click through them; a tab with nothing to show
still appears and says so honestly, it never just disappears. If the
event actually contains error information (an ERROR/FATAL severity, or a
real exception or error code), a sixth **Error** tab appears too, with
the full readable exception/stack trace; Overview also shows an **Error
summary** near the top for that event, with a link straight to the Error
tab.

## 7. Show surrounding logs

Still inside the Inspector, click **Show surrounding logs**. You'll see
the exact events that happened right before and after, in the same
place — with the one you started from clearly marked.

## 8. Use correlation / request flow

Back in the Inspector's **Request flow** tab, if you see a **"Find this
Trace/Correlation/Journey"** button next to an identifier, click it to
follow that request across every service that logged something about it.

## 9. Start Live

If the source supports it, click **Live** in the toolbar to start
streaming new events as they arrive. Use **Pause**/**Resume** to hold
the view still without losing anything, or **Clear** to empty the view
while staying connected.

## 10. Stop Live safely

Click **Stop** to end the stream cleanly, or **"← Back to search
results"** to leave Live entirely and return to Search — both are real
buttons reachable by keyboard (Tab, then Enter).

---

That's the whole core loop: **Search → select → inspect → surrounding
logs / correlation → Live → back to Search.** Everything else in the
[full guide](USER_GUIDE_EN.md) builds on these same steps.

**One thing you won't need on day one:** if a filter like CIF or Trace ID
ever finds nothing for a value you know is really in your logs, that's a
one-time field-mapping setup question, not a search problem — see
[USER_GUIDE_EN.md §19](USER_GUIDE_EN.md#19-log-schema--field-mapping) or
[TROUBLESHOOTING_EN.md](TROUBLESHOOTING_EN.md#a-filter-finds-nothing-even-though-the-value-is-in-the-log).
