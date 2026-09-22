import type { SVGProps } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpNarrowWide,
  Ban,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePlus,
  Clock,
  Columns3,
  Copy,
  Crosshair,
  Database,
  Download,
  Ellipsis,
  EyeOff,
  FileJson,
  Filter,
  FlaskConical,
  GitBranch,
  Globe,
  GripVertical,
  History,
  Info,
  Keyboard,
  ListChecks,
  LoaderCircle,
  Lock,
  Minus,
  Pause,
  Pencil,
  PencilLine,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  Square,
  SunMoon,
  Tag,
  Tags,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
  Waypoints,
  WifiOff,
  X,
  type LucideProps,
} from 'lucide-react';

/**
 * Modern Developer Console (B1 "Instrument Neutral") icon primitive, Wave
 * 1 Foundations. One curated name -> component map, not a dynamic import
 * of the whole `lucide-react` icon set: every name here is one the
 * owner-approved design package actually draws (verified against every
 * `I('<name>', ...)` call across
 * `docs/ux-v2-modern-developer-console/prototype/scripts/{app,classification}.js`
 * on `design/v2-modern-developer-console`), so the bundle only ever pays
 * for icons a real slice uses, and a typo is a compile error, not a
 * silently blank icon.
 */
const ICONS = {
  activity: Activity,
  'arrow-down': ArrowDown,
  'arrow-down-wide-narrow': ArrowDownWideNarrow,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-up-narrow-wide': ArrowUpNarrowWide,
  ban: Ban,
  box: Box,
  braces: Braces,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  'circle-plus': CirclePlus,
  clock: Clock,
  'columns-3': Columns3,
  copy: Copy,
  crosshair: Crosshair,
  database: Database,
  download: Download,
  ellipsis: Ellipsis,
  'eye-off': EyeOff,
  'file-json': FileJson,
  filter: Filter,
  'flask-conical': FlaskConical,
  'git-branch': GitBranch,
  globe: Globe,
  'grip-vertical': GripVertical,
  history: History,
  info: Info,
  keyboard: Keyboard,
  'list-checks': ListChecks,
  'loader-circle': LoaderCircle,
  lock: Lock,
  minus: Minus,
  pause: Pause,
  pencil: Pencil,
  'pencil-line': PencilLine,
  play: Play,
  plug: Plug,
  plus: Plus,
  radio: Radio,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  'scan-search': ScanSearch,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  split: Split,
  square: Square,
  /*
   * PR61_OWNER_NAVIGATION_RECOVERY_2 - the one deliberate addition outside the design's own curated icon set
   * (see this map's own doc comment): the approved design prototype never depicted a runtime theme control at
   * all (its own `?theme=dark` is a design-preview URL param, not a UI element), so there was never an
   * `I('sun-moon', ...)` call to match - this is a genuinely new capability, not a drift from the design.
   */
  'sun-moon': SunMoon,
  tag: Tag,
  tags: Tags,
  timer: Timer,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  upload: Upload,
  waypoints: Waypoints,
  'wifi-off': WifiOff,
  x: X,
} as const satisfies Record<string, React.ComponentType<LucideProps>>;

export type IconName = keyof typeof ICONS;

/** `--v2-icon-sm` (14px, inline with 12/13px text) | `--v2-icon-md` (16px, default control size) | `--v2-icon-lg` (20px, empty-state/dialog headers). */
export type IconSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<IconSize, number> = { sm: 14, md: 16, lg: 20 };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  name: IconName;
  size?: IconSize;
  /** Decorative by default (`aria-hidden`), matching the prototype's own `aria-hidden="true"` on every icon glyph - the adjacent text or an explicit `aria-label` on the control carries the accessible name. Pass a string to make the icon itself the accessible name (rare: an icon-only control with no other label source). */
  label?: string;
}

/**
 * `--v2-icon-stroke` (1.75) is the design's stroke width at every size -
 * deliberately not Lucide's own default (2), which reads slightly heavy
 * against the B1 type scale.
 */
export function Icon({ name, size = 'md', label, className, ...rest }: IconProps) {
  const Glyph = ICONS[name];
  const px = SIZE_PX[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
      {...rest}
    />
  );
}
