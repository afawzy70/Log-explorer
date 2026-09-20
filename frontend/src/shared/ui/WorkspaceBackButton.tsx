import { Button } from './Button';
import { Icon } from './Icon';

export interface WorkspaceBackButtonProps {
  /**
   * The TRUE destination this Back actually returns to - must never contradict the workspace's own
   * breadcrumb (PR61_OWNER_NAVIGATION_RECOVERY_2, mission's own explicit requirement). Plain text, e.g.
   * "Settings" or "Search results" - the leading "← " is added by this component so every caller renders the
   * identical grammar, never a hand-typed arrow character.
   */
  destination: string;
  onClick: () => void;
}

/**
 * One consistent Back-navigation grammar for every full-takeover workspace (Settings, Field Mapping,
 * Classification Rules) - PR61_OWNER_NAVIGATION_RECOVERY_2. Owner-observed defect: "← Back to search
 * results" was shown unconditionally in Field Mapping/Classification Rules even when the user had actually
 * arrived from Settings, contradicting those workspaces' own breadcrumb. A real left-arrow icon (`Icon.tsx`'s
 * existing `arrow-left`, never introduced solely for this), never icon-only (destination text always
 * present), `Button`'s own `ghost` variant for consistent visual weight with every other secondary action in
 * these workspaces, one placement (first element in the workspace header) across all three call sites.
 */
export function WorkspaceBackButton({ destination, onClick }: WorkspaceBackButtonProps) {
  return (
    // aria-label is "Back to X", not just "X": a plainer name would collide with (and be genuinely
    // ambiguous against) a same-page breadcrumb link to that same destination, and "Back to X" is honestly
    // more informative for assistive tech anyway - this is a navigation-history action, not a plain link.
    <Button variant="ghost" onClick={onClick} aria-label={`Back to ${destination}`}>
      <Icon name="arrow-left" size="sm" />
      {destination}
    </Button>
  );
}
