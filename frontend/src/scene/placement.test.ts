import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { latLonToVector3, spreadSurfacePlacement, surfacePlacement, PLANET_RADIUS } from './placement';

describe('spherical placement', () => {
  it('maps pole and equator to the sphere', () => {
    expect(latLonToVector3(90, 0, 2).distanceTo(new Vector3(0, 2, 0))).toBeLessThan(1e-9);
    expect(latLonToVector3(0, 0, 2).length()).toBeCloseTo(2);
  });
  it.each([[72, 20], [40, 80], [-30, -110]])('places %s/%s above the terrain and aligns local up', (lat, lon) => {
    const { position, quaternion } = surfacePlacement(lat, lon);
    expect(position.length()).toBeGreaterThan(PLANET_RADIUS);
    expect(new Vector3(0, 1, 0).applyQuaternion(quaternion).dot(position.clone().normalize())).toBeCloseTo(1);
  });
  it('visually separates near-identical globe markers while preserving sphere alignment', () => {
    const actual = surfacePlacement(43.64515, 78.535604).position.distanceTo(surfacePlacement(43.643198, 78.538828).position);
    const first = spreadSurfacePlacement(43.64515, 78.535604, -1);
    const second = spreadSurfacePlacement(43.643198, 78.538828, 1);
    expect(actual).toBeLessThan(0.001);
    expect(first.position.distanceTo(second.position)).toBeGreaterThan(0.6);
    expect(first.position.length()).toBeCloseTo(PLANET_RADIUS + 0.018);
    expect(second.position.length()).toBeCloseTo(PLANET_RADIUS + 0.018);
    expect(new Vector3(0, 1, 0).applyQuaternion(first.quaternion).dot(first.position.clone().normalize())).toBeCloseTo(1);
  });
});
