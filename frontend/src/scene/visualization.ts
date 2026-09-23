import type { Reading } from '../forecast/forecast';

export function visualizationState(reading: Reading) {
  return {
    // Animation scale only; no turbine RPM or power-curve claim.
    rotorSpeed: Math.max(0, Math.min(reading.windSpeed / 25, 1)) * 3,
    yawRadians: ((reading.direction % 360) + 360) % 360 * Math.PI / 180,
  };
}
