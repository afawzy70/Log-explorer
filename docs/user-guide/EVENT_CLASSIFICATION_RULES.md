# Event classification rules

Event classification rules add your own tags to log events — for example `middleware`, `frontend-call`,
`mobile-call`, `external-api`, or `database-call` — and can pull structured values out of them, such as a
target URL, a response code, or a duration.

Nothing about a tag is built in. `middleware` is just a name you choose. You can create a rule for any kind of
event without changing Log Explorer itself.

The server applies rules to every event as it is read, whatever the source: Docker, Loki, OpenShift, or Fixture.
Tags and extracted values show up in the Event Inspector and in every workspace: Search, Investigation,
Surroundings, and Live.

## What a rule is

Every rule has:

- **Name** and optional **description**.
- One to five **tags**. These are lowercase letters, digits, `.`, `_` and `-`.
- One or more **conditions**. Each condition has:
  - a **field** — usually `message`, but also `service`, `logger`, `businessStep`, `errorCode`, other mapped
    fields, `extra.<key>` for unmapped top-level JSON fields, or `mdc.<key>` for unmapped MDC fields;
  - a **matcher** — `EXACT`, `CONTAINS`, `STARTS_WITH`, or `REGEX`;
  - a **value**.
- A **match mode**: `ALL` (every condition must match) or `ANY` (at least one).
- Optional **extractions** — named values to pull out of matching events.
- An **enabled** switch and a **priority**. Rules run in priority order, lowest first, then by id. Every enabled rule
  that matches adds its tags. Evaluation never stops at the first match.

The five protected identifier fields (CIF, username, customer ID, device ID, device IP) cannot be used as rule
fields.

## Create a rule from an event

1. **Pick the event.** Search, then open an event in the Event Inspector.
2. **Start the rule.** Choose **Create tag rule from this event**.
3. **Source.** Pick the field to classify on. `message` is selected when the event has one. The current value is
   shown so you can check it.
4. **Detect.** Choose **Detect pattern**. Log Explorer reads a bounded sample of up to 200 events **from the search
   you are looking at** — the same source, project, time range, services, severities, search text, query and
   advanced filters — and compares them with the selected event. If you can see events in the results table, the
   sample comes from that same population; the selected event always takes part, even if the sample would
   otherwise have stopped short of it.

   One filter is deliberately left out: a **classification tag** filter. Tags only exist after your saved rules
   have run, so sampling through them while you are writing a rule would make the evidence depend on the
   classification you are creating.

   You see:
   - **Sampled**: how many events were really read (fewer than 200 if fewer exist);
   - **Similar**: how many look structurally like the selected event;
   - **Stable structure**: the fixed text they share, for example `Make webhook call to`, `responseCode=`,
     `duration=`;
   - **Variable parts**: what changes between events, for example the URL, request ID, response code, or duration;
   - **Suggested pattern** and how it behaves on the sample: similar events matched, and other events it would also
     match.

   Choose **Use this suggestion** to copy it into the rule, or skip and write the conditions yourself.
5. **Classification.** Enter the rule name and tags, for example `middleware`, and choose a **tag colour**. The
   preview chip shows how the tag will look in search results and the inspector. Colour is only a label — it never
   means severity or success — and the tag text is always shown, so nothing depends on seeing colour. A tag that
   another rule already uses keeps that rule's colour. Conditions are under **Advanced**.
6. **Extraction.** Extraction pulls named values out of matching events — a URL, a status, a duration, a request
   path — so you can read them in the inspector instead of hunting through the message.

   Log Explorer looks at the events this rule actually matches in your current search and suggests values it can
   read deterministically, each with how many of those events it really found a value in (for example
   *Found in 17 / 18*). Tick the ones you want, rename them, mark any that must never be shown, and choose **Add
   selected values**. You can also add one yourself; the regular expression or JSON pointer behind a value lives
   under **Advanced: how this value is read**.

   If nothing can be inferred safely, Log Explorer says so and offers **Detect extractable values again**, **Add
   extraction manually**, or **Skip extraction** — a rule works perfectly well with no extractions at all.
7. **Test.** Choose **Test rule**. The rule runs against a new bounded real sample without saving anything. You see:
   - matched and not-matched counts;
   - extraction coverage per value, for example *Response code 17 / 17*;
   - up to five matched examples, plus borderline events that matched only some conditions.

   **Review these matches for false positives.** Log Explorer has no way to know which events you meant, so it never
   claims a rule has no false positives.
8. **Save.** Choose **Save rule**.

## Why detection is only a suggestion

Pattern detection is local and deterministic. No AI service or network call is involved: the same events always
produce the same suggestion. It only ever suggests; nothing is saved until you choose **Save rule**.

When there is not enough evidence, you see **No safe pattern could be suggested** instead of a guess. That happens
when:
- fewer than three similar events are found;
- the value has too little fixed text;
- no simple matcher describes the similar events.

You can still write the rule yourself.

Detection prefers the simplest matcher that works:
1. `EXACT`
2. `STARTS_WITH` or `CONTAINS`
3. combinations of those
4. `REGEX` — only when nothing simpler describes the sample.

Values that vary between events, such as IDs, numbers, durations, and URLs, are never copied into a suggestion as
fixed text, so a rule does not end up tied to one customer's or one request's values.

## Add extraction from an event you are looking at

When an event is already classified, the Event Inspector offers **Add extraction from this event**. It opens the
rule that classified it, on the extraction step, with suggestions read from your current search. If several rules
classified the event, Log Explorer asks which one to extend. Nothing changes until you choose **Save rule**, and
the save is refused if someone else changed the rules in the meantime.

The same inspector also offers **Create another tag rule** when you want a new rule instead of extending one.

## After saving

- New searches, investigations, surroundings, and new Live events are classified with the saved rule.
- Events already on screen are not changed. You see: **Rule saved. Re-run Search to classify currently loaded
  results.**
- In Live, only events that arrive after the save are classified with the new rule.

## Tags in the results table

After you re-run Search, every matching event shows its classification in the **Tags** column, in the rule's
colour: the first tag, plus **+n** when the event has more. The full list is in the cell's tooltip and screen
reader label, and in the Event Inspector. You do not have to open an event to see that it is classified.

You can hide or move the column like any other, under **Columns**.

## Tags and extracted values in the Event Inspector

When an event is classified, the **Overview** tab shows a **Classification** section:
- each tag as a badge, for example **MIDDLEWARE**;
- for each matching rule, its name and the values it extracted.

A value the rule could not find shows **—** ("Not found in this event"). A value that was found but could not be
converted to its type also shows **—** ("Could not be read"). Log Explorer never makes values up.

## Filter by tag

In **More filters → Classification tags**, select one or more tags. The search keeps events that have **any**
selected tag.

The server applies tag filtering after it classifies the events a source returned. Docker, Loki, and OpenShift
have no idea what tags are, so a tag filter works within each source's normal read limits. It does not make a
source read more history than a normal search would.

## Manage rules

Open **Classification rules** from the header. There you can:
- search the list;
- see each rule's tags, fields, and matcher;
- enable or disable a rule;
- edit, duplicate, or test a rule;
- delete a rule (you are asked to confirm).

If the rules were changed in another browser window after you opened them, saving shows a conflict instead of
overwriting the other change. Choose **Reload rules**, then apply your change again.

## Import and export

Rules move between installations as a portable JSON **rule pack**
(`log-explorer-classification-pack.json`).

- **Export all** or **Export selected** downloads a pack. It contains rule definitions only — never log events,
  sampled data, extracted values, credentials, tokens, connection settings, or local file paths.
- **Import…** always shows a preview before anything changes:
  - **Rules in pack**
  - **New** — no rule with this id exists yet
  - **Identical** — already present with the same content
  - **Conflicts** — same id, different content
  - **Invalid** — fails validation, for example an unsupported regular expression

  A pack with invalid rules cannot be applied.
- Choose how to apply:
  - **Merge** keeps your existing rules and adds new ones. If there are conflicts, you must choose **Keep existing
    rule** or **Use imported rule** — conflicts are never overwritten silently.
  - **Replace all rules** deletes every rule not in the pack. You must confirm this explicitly.
  - **Cancel** leaves everything unchanged.

## Where rules are stored

Rules are **configuration**, saved on the Log Explorer server as a JSON file named `classification-rules.json`.
There is no database. Log events are never stored. Extracted values are computed each time an event is read and
are never saved.

| Installation | Rules file |
|---|---|
| Docker Compose | the `log-explorer-data` volume, mounted at `/app/data` in the container. It survives `docker compose down` / `up` and container recreation. `docker compose down -v` deletes it. |
| OpenShift | the persistent volume claim mounted at `/app/data` |
| Windows desktop | `%LOCALAPPDATA%\LogExplorer\data\classification-rules.json` — outside the install folder, so upgrades and reinstalls keep your rules |
| macOS desktop | `~/Library/Application Support/LogExplorer/data/classification-rules.json` |
| Local development | `backend/data/classification-rules.json`, unless `LOGEXPLORER_DATA_DIR` is set |

Set `LOGEXPLORER_DATA_DIR` to choose another folder, or `LOGEXPLORER_CLASSIFICATION_RULES_FILE` to choose the exact
file. The **Classification rules** screen shows the file the server is using.

Every save is written safely:
1. to a temporary file first;
2. the previous good version is kept as `classification-rules.json.bak`;
3. the new file replaces the old one in a single atomic step.

## Security and masking

Extracted values pass the same server-side protections as the rest of an event before they reach your browser:
- `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, and common API-key and token headers are
  redacted;
- bearer tokens, passwords and secrets written as key-values, JWTs, and card numbers are redacted;
- protected identifiers (CIF, username, customer ID, device ID, device IP) follow your **Privacy & masking**
  settings;
- an extraction marked **Sensitive** is never shown at all — only `[REDACTED]`;
- an extraction whose name looks like a credential, such as `authorization`, `cookie`, `token`, `secret`, or
  `password`, is also never shown.

Rule tests and pattern detection use the same redaction. Rule packs never contain event data.

## Advanced: regular expressions

`REGEX` conditions and extractions use **RE2** syntax. It runs in linear time, so a pattern cannot slow the server
down, whatever the log line.

- Named groups use `(?P<name>…)` or `(?<name>…)`. Example: `responseCode=(?P<responseCode>\d{3})`.
- Lookahead, lookbehind, and backreferences are **not supported**. Such a rule is rejected with a clear message
  when you save or test it; it is never run on a slower engine instead.
- A regular expression can be up to 1,000 characters.

For JSON values, use a **JSON_POINTER** extraction instead of a regular expression. For example, `/response/status`
reads `status` inside `response`. It works on fields whose value is a JSON object or array. If the value is not JSON,
the extraction simply finds nothing.

## Limits

| Limit | Default |
|---|---|
| Rules | 200 |
| Conditions per rule | 10 |
| Extractions per rule | 20 |
| Tags per rule | 5 (40 characters each) |
| Regular expression / condition value length | 1,000 characters |
| Pattern detection and rule test sample | 200 events (at most 500) |
| Test preview | 5 matched and 5 borderline events |
| Extracted value shown | 2,000 characters |
| Import file | 256 KB, 200 rules |

## Troubleshooting

| What you see | What to do |
|---|---|
| **No safe pattern could be suggested** | Widen the time range so more similar events are sampled, or write the conditions under **Advanced**. |
| **These rules were changed elsewhere** | Choose **Reload rules**, then apply your change again. |
| **Invalid or unsupported regular expression** | Remove lookaround and backreferences. Use simpler conditions, or several conditions with `ALL`. |
| **The rules could not be saved to the server's data directory** | Make sure the data directory exists and the Log Explorer process can write to it. In Docker, check that the volume is mounted. Search keeps working. |
| A warning that the rules file is invalid and a backup is active | Log Explorer loaded the last good copy (`.bak`). The next save moves the damaged file aside as `.corrupt-<time>` instead of overwriting it. |
| A warning that the rules file is invalid and there is no backup | Classification is off, but search keeps working. Fix the JSON file, or import or save rules — the damaged file is kept as a `.corrupt` copy. |
| A tag filter returns fewer events than expected | Tags are applied to the events each search reads. Narrow the time range or services, or re-run Search after saving a rule. |
| A value shows **—** | The rule did not find that value in this event. Test the rule to see its extraction coverage. |

See also: [Classification rule file formats](EVENT_CLASSIFICATION_RULES_SCHEMA.md).
