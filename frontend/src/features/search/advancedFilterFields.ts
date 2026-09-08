export interface AdvancedFilterValues {
  text: string;
  userName: string;
  customerId: string;
  cif: string;
  deviceId: string;
  deviceIp: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  journeyId: string;
  eventId: string;
  errorCode: string;
  businessStep: string;
  uiIdentifier: string;
  loggerContains: string;
  devicePlatform: string;
  language: string;
}

export function emptyAdvancedFilterValues(): AdvancedFilterValues {
  return {
    text: '',
    userName: '',
    customerId: '',
    cif: '',
    deviceId: '',
    deviceIp: '',
    traceId: '',
    spanId: '',
    correlationId: '',
    journeyId: '',
    eventId: '',
    errorCode: '',
    businessStep: '',
    uiIdentifier: '',
    loggerContains: '',
    devicePlatform: '',
    language: '',
  };
}

export interface AdvancedFilterFieldDef {
  key: keyof AdvancedFilterValues;
  label: string;
  /** Applied chips show "Protected" instead of the raw value (CLAUDE.md §2 rule 1/5). */
  sensitive: boolean;
}

export interface AdvancedFilterGroup {
  id: string;
  title: string;
  fields: AdvancedFilterFieldDef[];
}

/** IMPLEMENTATION_PLAN.md "Phase F" scope item 6 - grouped by user question, in this exact order. */
export const ADVANCED_FILTER_GROUPS: AdvancedFilterGroup[] = [
  {
    id: 'who',
    title: 'Who / customer',
    fields: [
      { key: 'userName', label: 'User name', sensitive: true },
      { key: 'customerId', label: 'Customer ID', sensitive: true },
      { key: 'cif', label: 'CIF', sensitive: true },
      { key: 'deviceId', label: 'Device ID', sensitive: true },
      { key: 'deviceIp', label: 'Device IP', sensitive: true },
    ],
  },
  {
    id: 'flow',
    title: 'Request flow',
    fields: [
      { key: 'traceId', label: 'Trace ID', sensitive: false },
      { key: 'spanId', label: 'Span ID', sensitive: false },
      { key: 'correlationId', label: 'Correlation ID', sensitive: false },
      { key: 'journeyId', label: 'Journey ID', sensitive: false },
      { key: 'eventId', label: 'Event ID', sensitive: false },
    ],
  },
  {
    id: 'what',
    title: 'What happened',
    fields: [
      { key: 'errorCode', label: 'Error code', sensitive: false },
      { key: 'businessStep', label: 'Business step', sensitive: false },
      { key: 'uiIdentifier', label: 'UI identifier', sensitive: false },
      { key: 'loggerContains', label: 'Logger / class contains', sensitive: false },
      { key: 'text', label: 'Message contains', sensitive: false },
    ],
  },
  {
    id: 'client',
    title: 'Client context',
    fields: [
      { key: 'devicePlatform', label: 'Device platform', sensitive: false },
      { key: 'language', label: 'Language', sensitive: false },
    ],
  },
];

export const ALL_ADVANCED_FILTER_FIELDS: AdvancedFilterFieldDef[] = ADVANCED_FILTER_GROUPS.flatMap((g) => g.fields);

/** `text` has its own always-visible control (Universal Search) - not counted as an "advanced" filter for the badge. */
export function countActiveAdvancedFilters(values: AdvancedFilterValues): number {
  return ALL_ADVANCED_FILTER_FIELDS.filter((f) => f.key !== 'text' && values[f.key].trim() !== '').length;
}
