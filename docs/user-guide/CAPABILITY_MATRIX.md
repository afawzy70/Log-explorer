# Log Explorer — Capability Matrix

This matrix is taken directly from what the backend actually declares
for each source (`SourceCapabilities`, `backend/src/main/java/com/logexplorer/core/model/SourceCapabilities.java`
and each source's own `capabilities()` implementation) — Log Explorer's
frontend never guesses or assumes a capability; it only ever shows a
control when the connected source reports it supports that capability.
This table is the same truth the application itself uses, so it will
never claim uniform capability across sources that don't actually have
it.

Values used: **YES**, **NO**, **PARTIAL**, **ENVIRONMENT-DEPENDENT**.

| Feature | Fixture | Docker | OpenShift | OpenShift Loki |
|---|:---:|:---:|:---:|:---:|
| Historical search | YES | YES | YES | YES |
| Live tail | YES | YES | YES | NO |
| Context / surrounding logs | YES | YES | YES | NO |
| Correlation / Trace / Journey follow-up | YES¹ | YES¹ | YES¹ | YES¹ |
| Raw query (Raw LogQL) | NO | NO | NO | ENVIRONMENT-DEPENDENT² |
| Historical query | YES | YES | YES | YES |
| Project / Workload / Pod / Container scope | NO | NO | YES | NO |
| Docker Compose project scope | NO | YES | NO | NO |
| Service discovery (list of services to filter by) | YES | YES | NO³ | NO |
| Sensitive filtering (search by protected fields) | YES | YES | YES | YES |
| Configurable masking (Privacy & masking) | YES | YES | YES | YES |
| TLS | N/A⁴ | PARTIAL⁵ | YES | YES |
| Proxy (System/Direct/Custom) | N/A⁴ | NO⁶ | YES | YES |
| Query statistics | NO | NO | NO | NO |
| Desktop support (Windows/macOS) | YES | YES | YES | YES |

**Notes**

1. Correlation/Trace/Journey "Find this…" actions work on any event that
   actually carries the identifier — this depends on your logs
   populating those fields, not on which source produced them. All four
   sources use the identical mechanism once an event has the data.
2. Raw LogQL is a configuration flag
   (`logexplorer.loki.raw-log-ql-enabled`), off by default. Whether it's
   available to you depends on how your administrator configured the
   Loki source — hence "environment-dependent," not a fixed yes/no.
3. OpenShift Direct does not offer a separate "list of services"
   dropdown the way Docker/Fixture do — you instead narrow by
   Project/Workload/Pod/Container (its own, richer scope model).
4. Fixture is a built-in sample dataset with no real network connection
   at all — TLS and proxy settings are not applicable to it.
5. Docker's TLS is optional and only relevant in Remote mode; Local mode
   has no TLS concept (nothing to encrypt on a local socket).
6. Log Explorer's proxy configuration (System/Direct/Custom) currently
   applies to OpenShift and OpenShift Loki only — Docker connections do
   not currently go through this proxy setting.

**On "real Loki verification":** the Raw query/Live/Context rows for
OpenShift Loki reflect what is *implemented*, tested, and deterministic
against a fake Loki gateway. Running Log Explorer against a **real**
Loki gateway has not been possible to verify in this project's own
development environment (no reachable real instance was available) —
see `docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_REPORT.md` and
`docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md` for the
full detail. This is stated here plainly rather than implying a level of
real-world verification that hasn't happened.

**On real OpenShift verification:** unlike Loki, direct OpenShift
connectivity — connection, discovery, search, context, correlation, and
Live, including multi-replica and rolling-update scenarios — **has**
been verified against a real OpenShift cluster (a Red Hat Developer
Sandbox). See `docs/verification/FINAL_FUNCTIONAL_CLOSURE_REPORT.md` §4.1.
