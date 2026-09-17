# Motion System — Modern Developer Console

Design proposal (LERDESIGN-1). Not implemented in production. Prototype tokens live in
`prototype/styles/tokens.css`; acceptance belongs to LERUX-1 after implementation.

## 1. What motion is for here

Log Explorer is used for long, time-pressured scanning sessions. Motion exists only to explain a
change the investigator would otherwise have to re-find with their eyes:

- **Where did that panel come from, and where did it go?** (Inspector, More filters, popovers)
- **Which event am I still looking at?** (selection carried into an investigation and back)
- **Is something still running?** (search in flight, Live acquisition, reconnecting)
- **Did my action land?** (copy, apply, save, verify)

Anything that does not answer one of those questions does not move. There is no entrance
choreography, no staggered rows, no hover lift, no bounce, no scroll-linked effect, and no motion
on the results table while scanning.

**Signature moment — the trigger.** Selecting a row plants a crosshair trigger mark. When the
investigator opens a trace, journey or surroundings capture, that mark is the one element that
travels: from the Inspector title to the capture's "Selected event" flag. On Back, the capture
collapses and the originating row takes focus again with a brief emphasis. This is the only
authored, spatial transition in the product; everything else is short state feedback.

## 2. Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80 ms | exits, menu close, press feedback |
| `--dur-fast` | 120 ms | hover/selection colour, popover open, tab indicator, status appear |
| `--dur-base` | 160 ms | disclosure expand, stale-to-fresh restore, Back return emphasis start |
| `--dur-panel` | 200 ms | Inspector open, sheet open (narrow widths) |
| `--dur-view` | 240 ms | workspace change: Search ⇄ Investigation / Context, the trigger travel |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | anything arriving |
| `--ease-in` | `cubic-bezier(0.5, 0, 0.75, 0)` | anything leaving (always shorter than its arrival) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | in-place colour/opacity changes |

Rules: exits use the next-shorter duration than their entrance. Nothing routine exceeds 240 ms.
The only loops are the Live acquisition pulse (1800 ms), the reconnecting icon (1600 ms), the
in-flight progress hairline (1100 ms) and the skeleton breathing (1400 ms), and each exists only
while its underlying state is true.

## 3. Interaction specifications

| Interaction | Enter | Exit | Properties | Why |
|---|---|---|---|---|
| Inspector open (desktop, docked) | 200 ms `--ease-out`, `translateX(12px)` → 0 + opacity 0 → 1 | 120 ms `--ease-in`, opacity only | transform, opacity | Shows the probe arriving from the right edge it docks to. Table columns re-flow instantly (no width animation). |
| Inspector as sheet (< 1366 px) | 200 ms `--ease-out`, `translateX(24px)` → 0; scrim opacity 0 → 1 in 120 ms | 120 ms `--ease-in` | transform, opacity | Distinguishes an overlay from the docked panel. |
| Next / previous event (`[` `]`) | Title and fields swap instantly; position readout updates via `aria-live` | — | none | Rapid key-repeat must never queue animations. |
| Tab switch | Indicator underline moves 120 ms `--ease-standard`; panel content swaps instantly | — | transform (indicator) | The indicator explains which tab is now active; sliding content would slow reading. |
| More filters panel | 120 ms `--ease-out`, `translateY(-4px)` → 0 + opacity | 80 ms opacity | transform, opacity | Anchors the panel to the query bar above it. |
| Menus and popovers (Services, Severity, Time, Columns, Health) | 120 ms `--ease-out`, `translateY(-4px)` + opacity | 80 ms opacity | transform, opacity | Same grammar for every anchored layer. |
| Row hover / selection | Background 120 ms `--ease-standard`; selection hairlines appear instantly | — | background-color | Arrowing through rows must feel immediate; colour easing only softens flicker. |
| Enter Investigation / Context (signature) | The trigger mark in the Inspector title morphs into the capture's "Selected event" flag, 240 ms `--ease-out`; the rest of the column cross-fades 160 ms | — | View Transitions (`view-transition-name: trigger`), opacity | Keeps "which event was I on" continuous across a full workspace change. Fallback where View Transitions are unavailable: 160 ms cross-fade only. |
| Back to search results | Capture fades 120 ms; originating row is focused, scrolled into view without smooth scrolling, and its background starts at `--accent-tint-strong` and settles to the normal selected tint over 400 ms | — | opacity, background-color | Answers "where was I?" without animated scrolling. |
| Surroundings root row | Root row is centred with instant scroll; the "Selected event" flag on the window ruler appears with the view | — | none | Smooth scrolling across a context window delays reading and moved the chrome off-screen in the baseline. |
| Search in flight | Search button swaps to a spinner and "Searching…" instantly; a 2 px progress hairline sweeps under the scope strip every 1100 ms; previous rows switch to tertiary ink (still ≥ 4.5:1) | Rows restore their ink colour over 160 ms when results land | transform (hairline), color | Truthful "still running" signal. It never shows a percentage it cannot know, and it does not make a slow backend look faster. |
| First search (no prior rows) | Skeleton rows breathe 1400 ms; replaced by real rows without stagger | Skeleton removed in one frame | opacity | Stable layout: skeleton rows use real row height so nothing jumps. |
| Load more | Button label swaps to "Loading…"; new rows append without animation | — | none | Appending must never shift the investigator's reading position. |
| Error / empty / gate panels | 120 ms opacity | — | opacity | No shake, no slide; the panel's words carry the meaning. |
| Copy ID confirmation | Button label swaps to "Copied" for 1200 ms, then back | — | none (text swap) | Confirms the action without a toast. |
| Live — LIVE | Pulse ring 1800 ms `--ease-out` on the status dot only | Stops the instant state leaves LIVE | box-shadow | The only animation tied to real, continuous activity. |
| Live — RECONNECTING | Refresh icon rotates 1600 ms linear; badge border dashed | Stops on reconnect or failure | transform | Shows an attempt in progress; attempt count is text. |
| Live — new events | Rows prepend in 100 ms batches with no animation; "Jump to newest · N new" appears with 120 ms opacity when following is off | — | opacity (button) | Hundreds of rows per minute must not animate. |
| Mapping verify / save result | Status tag colour changes 120 ms; result line appears 120 ms opacity | — | color, opacity | Makes the state change noticeable in a long table. |

## 4. Reduced motion

`prefers-reduced-motion: reduce` is a first-class mode, not "animations off":

| Normal | Reduced |
|---|---|
| Inspector / sheet / popover / panel translate + fade | Fade only, 120 ms |
| Trigger travel (View Transition) | No morph; capture appears in one frame and focus moves to its heading |
| Back return emphasis (400 ms tint settle) | Tint shown for 400 ms, then switched without easing |
| Progress hairline sweep | Static hairline at 50 % opacity for as long as the search runs |
| Skeleton breathing | Static skeleton |
| Live pulse | Static filled dot; the word "Live" is unchanged |
| Reconnecting icon rotation | Static icon; "Reconnecting · attempt n of 5" text unchanged |
| Spinner in Search button | Static loader icon; "Searching…" text unchanged |

Every state that motion helps explain is also stated in text, so nothing is lost when motion is
reduced.

## 5. Budget and implementation rules

- Animate only `transform`, `opacity`, `background-color`, `color` and `box-shadow` on small
  elements. Never animate `width`, `height`, `top`, `left`, margins, or any table/colgroup geometry.
- Never animate table rows during scanning, keyboard navigation, sorting, column reorder or
  density change.
- `will-change` only on the Inspector and the capture view during their transition.
- Interrupted transitions must resolve to the end state immediately (e.g. pressing `Esc` during the
  Inspector entrance closes it without waiting).
- View Transitions are progressive enhancement; the cross-fade fallback must be the complete
  experience.
- Focus management never waits for an animation: focus moves when the state changes, and motion
  follows.
- The existing `--motion-fast` (120 ms) / `--motion-base` (180 ms) tokens map to `--dur-fast` and
  `--dur-base` (160 ms) during implementation; the reduced-motion zeroing in today's
  `shared/tokens.css` is replaced by the table above.

## 6. Verification handed to LERUX-1

- Record each transition at 60 fps in the rendered app and confirm the durations above within
  ±20 ms, with no layout shift (CLS 0) during Inspector open, Load more and search completion.
- With OS reduced motion on, confirm every row of §4 and that no information disappears.
- Hold `]` for two seconds on a 200-row result: no queued animation, no dropped focus.
- Confirm Back restores focus to the originating row in Search, Trace, Journey and Surroundings.
- Confirm no loop runs when its state is false (Live stopped, search idle, reconnect finished).

## 7. Event classification (PR #59 design sync)

The same philosophy applies: motion only explains a change. Nothing below exceeds 160 ms, and nothing animates while
the investigator scans rows.

| Interaction | Enter | Exit | Properties | Reduced motion | Why |
|---|---|---|---|---|---|
| Detection result reveal (Observed and Suggested panels) | 160 ms `--ease-out`, `translateY(3px)` → 0 + opacity, both panels together, **no stagger** | — | transform, opacity | Opacity only | Marks that a measured result replaced the “Detecting…” state without implying a sequence of reasoning |
| Detect / Test in flight | The 2 px progress hairline at the top of the step content (1100 ms sweep); skeleton stats breathe (1400 ms) | Removed in one frame when the result lands | transform, opacity | Static hairline at 50 % opacity; static skeleton | Truthful “still reading the sample”; no percentage |
| Step change in the rule builder | Content swaps instantly; focus moves to the step heading; the rail's current marker changes colour in 120 ms | — | color, background-color | Instant | Reading the new step matters more than a slide |
| Extraction row added | 120 ms `--ease-out` opacity + `translateY(3px)` on the new row only | Row removal: 80 ms opacity | transform, opacity | Opacity only | Shows where the new value landed in the table |
| Edit row open (extraction) | Instant; the edited row's tint appears in 120 ms | Instant | background-color | Instant | Avoids height animation, which would move the table (§5) |
| Import conflict detail / advanced conditions disclosure | Chevron rotates 120 ms; content appears instantly | — | transform (chevron) | No rotation | Same grammar as every disclosure |
| Replace all chosen | Danger zone appears with 120 ms opacity | 80 ms opacity | opacity | Instant | Draws attention to the destructive scope without shaking or flashing |
| Destructive dialog (delete rule) | Scrim 120 ms opacity; dialog 120 ms `translateY(-4px)` + opacity | 80 ms opacity | transform, opacity | Opacity only | Same as popovers; focus moves to Cancel at open, not after the animation |
| Saved / import-applied banner | 120 ms opacity | — | opacity | Instant | Confirms the write landed |
| Tags tooltip in the results table | 120 ms opacity after the standard hover delay; instant on keyboard focus | 80 ms | opacity | Instant | Explains `+N` without moving the row |
| Tags column enabled from Columns | No animation; the table re-lays out in one frame | — | none | — | Column geometry is never animated (§5) |
