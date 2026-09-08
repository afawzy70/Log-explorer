/**
 * The exact seven columns, in order (IMPLEMENTATION_PLAN.md "Phase G"
 * scope item 1) - a single source of truth for both the `<colgroup>` and
 * the `<thead>`, so header/body column count can never silently drift
 * apart (the exact bug class HANDOVER.md §15 describes: "missing fields
 * shifted later values").
 */
export interface ColumnDef {
  id: string;
  header: string;
  /** CSS width for this column's `<col>` - fixed px for narrow columns, left as `auto` only for the one flexible column (Message). */
  width?: string;
}

export const RESULT_COLUMNS: ColumnDef[] = [
  { id: 'time', header: 'Time', width: '190px' },
  { id: 'level', header: 'Level', width: '90px' },
  { id: 'service', header: 'Service', width: '160px' },
  { id: 'whatHappened', header: 'What happened' },
  { id: 'userCustomer', header: 'User/Customer', width: '160px' },
  { id: 'correlationTrace', header: 'Correlation/Trace', width: '170px' },
  { id: 'actions', header: 'Actions', width: '56px' },
];
