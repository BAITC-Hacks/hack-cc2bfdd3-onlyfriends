import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { latLonToVector3, surfacePlacement, PLANET_RADIUS } from './placement';

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
});
