import { ArrowDown, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, CloudSun, CloudMoon, Moon, Compass, Globe2, Leaf, Maximize2, Pause, Play, RotateCcw, Search, Settings2, Sparkles, Sun, Thermometer, Wind, X, Zap } from 'lucide-react';

const icons = { arrow: ArrowRight, diagonal: ArrowUpRight, down: ArrowDown, box: Box, check: Check, chevron: ChevronDown, left: ChevronLeft, right: ChevronRight, search: Search, cloud: Cloud, weather: CloudSun, cloudMoon: CloudMoon, moon: Moon, compass: Compass, globe: Globe2, leaf: Leaf, expand: Maximize2, pause: Pause, play: Play, reset: RotateCcw, settings: Settings2, sparkles: Sparkles, sun: Sun, temperature: Thermometer, wind: Wind, close: X, power: Zap };
export type IconName = keyof typeof icons;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.6} aria-hidden="true" />;
}
