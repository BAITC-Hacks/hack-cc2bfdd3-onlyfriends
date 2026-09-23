import { windFlow } from '../forecast/windApi';

export function windStep(speed: number, direction: number, elapsedSeconds: number): [number, number] {
  const [east, south] = windFlow(direction);
  const distance = Math.max(0.08, Math.min(2.5, speed * 0.15)) * Math.max(0, elapsedSeconds);
  return [east * distance, south * distance];
}
