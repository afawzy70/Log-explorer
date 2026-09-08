export type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'paused' | 'stopped' | 'error';

/** The "status" SSE event's payload - mirrors backend `LiveTailService.StatusPayload` (IMPLEMENTATION_PLAN.md "Phase J"). */
export interface LiveStatusPayload {
  droppedCount: number;
  serverTime: string;
}

/** The initial displayed cap (HANDOVER.md §18.4: "initial specified display cap: 1,000 events"). */
export const VISIBLE_CAP = 1000;
