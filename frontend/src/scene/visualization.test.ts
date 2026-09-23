import { describe, expect, it } from 'vitest';
import { visualizationState } from './visualization';
import type { Reading } from '../forecast/forecast';

const reading: Reading = { turbineId: '1', windSpeed: 0, windSpeed10m: 0, direction: 0,
  temperature: 0, pressure: 1000, power: 0.5 };

describe('weather to visual state', () => {
  it('stops at zero wind and clamps extreme wind without changing model power', () => {
    expect(visualizationState(reading).rotorSpeed).toBe(0);
    expect(visualizationState({ ...reading, windSpeed: 10 }).rotorSpeed).toBeGreaterThan(0);
    expect(visualizationState({ ...reading, windSpeed: 100 }).rotorSpeed).toBe(3);
    expect(visualizationState({ ...reading, windSpeed: 100, power: 0 }).rotorSpeed).toBe(3);
  });
  it('maps forecast direction to a stable visual yaw', () => {
    expect(visualizationState({ ...reading, direction: 270 }).yawRadians).toBeCloseTo(3 * Math.PI / 2);
    expect(visualizationState({ ...reading, direction: 630 }).yawRadians).toBeCloseTo(3 * Math.PI / 2);
  });
});
