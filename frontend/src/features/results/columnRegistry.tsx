import type { ReactNode } from 'react';
import type { JourneyField, LogEvent } from '../../shared/api/types';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import {
  EMPTY_VALUE,
  formatTimestampCell,
  splitTimestampCell,
  resolveContainer,
  resolveCorrelationOrTrace,
  resolveService,
  resolveUserOrCustomer,
} from './columnMapping';
import { MessageCell } from './MessageCell';
import styles from './ResultsTable.module.css';

/**
 * The single authoritative column registry (Legacy Remediation Slice 4,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 4"). Every column this
 * table can ever render - default-visible or optional - is defined exactly
 * once here: id, label, default visibility, width, cell class, and
 * renderer. Nothing about a column's shape is duplicated in
 * `ResultsTable.tsx` or the Columns control - both only ever read this
 * registry.
 *
 * <p>{@code id} is the only thing ever persisted (see
 * `tablePreferences.ts`) - stable, independent of {@code label}, so a
 * future copy change to a column's display text can never invalidate a
 * saved preference.
 *
 * <p>{@code cellClassName} is applied to the `<td>` itself (never an inner
 * wrapper) - `.serviceCell`/`.idCell`'s `overflow: hidden` +
 * `text-overflow: ellipsis` only truncate correctly on the element that is
 * actually width-constrained by `table-layout: fixed`'s own `<col>` width,
 * which is the `<td>`, not a plain inline `<span>` inside it - the exact
 * bug class this table's own CSS comments already document for
 * `ActionsCell`'s clipped-clickable-area fix.
 *
 * <p>{@code actions} is deliberately NOT part of this registry (see
 * `ResultsTable.tsx`'s own comment on why it is pinned, mandatory, and
 * always rendered last) - every id here names a genuine, already-existing,
 * non-sensitive field on {@link LogEvent}. None of the five protected
 * fields (cif/userName/customerId/deviceId/deviceIp) are offered as a
 * dedicated column - the existing masked "User/Customer" column is the
 * only place any of them appear, unchanged by this slice (CLAUDE.md §2
 * rule 1).
 */
export type ColumnId =
  | 'time'
  | 'level'
  | 'service'
  | 'whatHappened'
  | 'userCustomer'
  | 'correlationTrace'
  | 'logger'
  | 'thread'
  | 'traceId'
  | 'spanId'
  | 'correlationId'
  | 'journeyId'
  | 'eventId'
  | 'errorCode'
  | 'businessStep'
  | 'uiIdentifier'
  | 'container'
  | 'pod'
  | 'namespace'
  | 'composeProject'
  | 'composeService'
  | 'devicePlatform'
  | 'language';

export interface ColumnRenderContext {
  onOpenJourney?: (field: JourneyField, value: string) => void;
}

export interface ColumnDefinition {
  id: ColumnId;
  label: string;
  /** Whether a fresh install (no saved preferences) shows this column - exactly the seven default columns say `true`. */
  defaultVisible: boolean;
  /** Fixed `<col>` width; `undefined` leaves the column flexible (only "What happened" does). */
  width?: string;
  /** Applied to the `<td>` itself - see this module's own doc comment for why. */
  cellClassName?: string;
  render: (event: LogEvent, ctx: ColumnRenderContext) => ReactNode;
}

function levelColor(severity: string | null): string | undefined {
  return SEVERITY_LEVELS.find((l) => l.id === severity?.toUpperCase())?.colorVar;
}

/** Every optional column below shares this look: monospace, no label prefix (unlike the label:value cells the default columns use) - `cellClassName: styles.idCell` on the owning definition does the actual truncation. */
function simpleValue(value: string | null): ReactNode {
  return value ?? EMPTY_VALUE;
}

/** The seven columns visible by default (IMPLEMENTATION_PLAN.md "Phase G", preserved byte-for-byte as the Legacy Remediation Slice 4 owner decision requires), plus every optional column Slice 4 adds. Order here is only the default (reset) order - `tablePreferences.ts` is the actual runtime source of order for a returning user. */
export const COLUMN_REGISTRY: ColumnDefinition[] = [
  {
    id: 'time',
    label: 'Time',
    defaultVisible: true,
    width: '190px',
    cellClassName: styles.timeCell,
    render: (event) => {
      // UX-R4 §13 - same text as `formatTimestampCell`, weighted so the
      // clock time (what actually varies row to row) reads first and the
      // repeated calendar date sits behind it. See `splitTimestampCell`.
      const split = splitTimestampCell(event.timestamp);
      if (!split) {
        return formatTimestampCell(event.timestamp);
      }
      return (
        <>
          {split.date ? <span className={styles.timeDatePart}>{split.date}</span> : null}
          <span className={styles.timeClockPart}>{split.time}</span>
        </>
      );
    },
  },
  {
    id: 'level',
    label: 'Level',
    defaultVisible: true,
    width: '90px',
    render: (event) => {
      const color = levelColor(event.severity);
      return (
        <span className={styles.levelCell}>
          {color ? <span className={styles.levelDot} style={{ background: color }} aria-hidden="true" /> : null}
          {event.severity ?? EMPTY_VALUE}
        </span>
      );
    },
  },
  {
    id: 'service',
    label: 'Service',
    defaultVisible: true,
    width: '160px',
    cellClassName: styles.serviceCell,
    render: (event) => resolveService(event),
  },
  {
    id: 'whatHappened',
    label: 'What happened',
    defaultVisible: true,
    /*
     * UX-R4 §13/§14 - the message is the primary scanning field, and it is
     * deliberately the one column with NO fixed width: it absorbs whatever
     * horizontal space is left over, so a wide desktop spends its extra
     * pixels on the thing investigators actually read.
     *
     * What UX-R4 changes is the *floor* underneath it, which lives on the
     * table's own `min-width` (see `ResultsTable.module.css`). Before
     * UX-R4 that floor was 900px - less than the six other default columns
     * plus a readable message - so being the only flexible column made
     * this the only one that shrank: opening the inspector, precisely when
     * an investigator most needs to read messages, collapsed it to roughly
     * 140px ("Payment authorizatio…") while Time, User/Customer and
     * Correlation/Trace held their fixed widths. Measured in a real
     * browser, not inferred - see `docs/verification/UX_R4_EVIDENCE/`.
     * Raising the floor keeps both properties at once: this column still
     * takes all the surplus when there is any, and can no longer be
     * squeezed below a readable width when there is not.
     */
    render: (event) => <MessageCell event={event} />,
  },
  {
    id: 'userCustomer',
    label: 'User/Customer',
    defaultVisible: true,
    width: '160px',
    cellClassName: styles.idCell,
    render: (event) => {
      const userOrCustomer = resolveUserOrCustomer(event);
      if (!userOrCustomer) {
        return EMPTY_VALUE;
      }
      return (
        <>
          <span className={styles.idLabel}>{userOrCustomer.label}:</span>
          <span className={styles.protectedValue}>{userOrCustomer.value}</span>
        </>
      );
    },
  },
  {
    id: 'correlationTrace',
    label: 'Correlation/Trace',
    defaultVisible: true,
    width: '170px',
    cellClassName: styles.idCell,
    render: (event, ctx) => {
      const correlationOrTrace = resolveCorrelationOrTrace(event);
      if (!correlationOrTrace) {
        return EMPTY_VALUE;
      }
      if (!ctx.onOpenJourney) {
        return (
          <>
            <span className={styles.idLabel}>{correlationOrTrace.label}:</span>
            {correlationOrTrace.value}
          </>
        );
      }
      // The whole cell is one button - a real, previously-caught bug
      // (Phase H's ActionsCell menu, and this same class of bug found
      // again here) showed that a clickable element whose own bounding
      // box exceeds an ancestor's `overflow: hidden` clip can be visually
      // correct yet unclickable in the clipped region - `.idLinkCell`'s
      // own `width: 100%` + `overflow: hidden` makes its clickable box
      // exactly match its visible, ellipsis-truncated box.
      return (
        <button
          type="button"
          className={styles.idLinkCell}
          onClick={() => ctx.onOpenJourney!(correlationOrTrace.field, correlationOrTrace.value)}
          title={`Find this ${correlationOrTrace.label}`}
        >
          <span className={styles.idLabel}>{correlationOrTrace.label}:</span>
          {correlationOrTrace.value}
        </button>
      );
    },
  },

  // --- optional columns (Legacy Remediation Slice 4) - hidden by default,
  // every one a genuine existing LogEvent field, never a sensitive one. ---
  { id: 'logger', label: 'Logger', defaultVisible: false, width: '200px', cellClassName: styles.idCell, render: (e) => simpleValue(e.logger) },
  { id: 'thread', label: 'Thread', defaultVisible: false, width: '140px', cellClassName: styles.idCell, render: (e) => simpleValue(e.thread) },
  { id: 'traceId', label: 'Trace ID', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.traceId) },
  { id: 'spanId', label: 'Span ID', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.spanId) },
  { id: 'correlationId', label: 'Correlation ID', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.correlationId) },
  { id: 'journeyId', label: 'Journey ID', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.journeyId) },
  { id: 'eventId', label: 'Event ID', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.eventId) },
  { id: 'errorCode', label: 'Error code', defaultVisible: false, width: '140px', cellClassName: styles.idCell, render: (e) => simpleValue(e.errorCode) },
  { id: 'businessStep', label: 'Business step', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.businessStep) },
  { id: 'uiIdentifier', label: 'UI identifier', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.uiIdentifier) },
  { id: 'container', label: 'Container', defaultVisible: false, width: '180px', cellClassName: styles.idCell, render: (e) => resolveContainer(e) },
  { id: 'pod', label: 'Pod', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.pod) },
  { id: 'namespace', label: 'Namespace', defaultVisible: false, width: '140px', cellClassName: styles.idCell, render: (e) => simpleValue(e.namespace) },
  { id: 'composeProject', label: 'Compose project', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.composeProject) },
  { id: 'composeService', label: 'Compose service', defaultVisible: false, width: '160px', cellClassName: styles.idCell, render: (e) => simpleValue(e.composeService) },
  { id: 'devicePlatform', label: 'Device platform', defaultVisible: false, width: '140px', cellClassName: styles.idCell, render: (e) => simpleValue(e.devicePlatformType) },
  { id: 'language', label: 'Language', defaultVisible: false, width: '110px', cellClassName: styles.idCell, render: (e) => simpleValue(e.language) },
];

export const COLUMN_REGISTRY_BY_ID: ReadonlyMap<ColumnId, ColumnDefinition> = new Map(
  COLUMN_REGISTRY.map((c) => [c.id, c]),
);

/** Every column id, in the registry's own default order - the definitive "what columns exist" list `tablePreferences.ts` validates saved preferences against. */
export const ALL_COLUMN_IDS: ColumnId[] = COLUMN_REGISTRY.map((c) => c.id);

export const DEFAULT_COLUMN_ORDER: ColumnId[] = ALL_COLUMN_IDS;

export const DEFAULT_HIDDEN_COLUMN_IDS: ColumnId[] = COLUMN_REGISTRY.filter((c) => !c.defaultVisible).map((c) => c.id);

/**
 * The mandatory eighth column (Legacy Remediation Slice 4 owner decision -
 * see `ResultsTable.tsx`'s own javadoc-style comment for the full
 * rationale): never hidden, never reordered, always rendered last. Not a
 * {@link ColumnDefinition} in {@link COLUMN_REGISTRY} at all - structurally
 * impossible for a preference (saved, malformed, or otherwise) to remove
 * or move it.
 */
export const ACTIONS_COLUMN_WIDTH = '56px';
