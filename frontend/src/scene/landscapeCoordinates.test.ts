import { expect, it } from 'vitest';
import { localPosition } from './Landscape';
import terrain from '../data/shelek-terrain.json';

it('places the two turbines at their actual relative coordinates on the local terrain', () => {
  const first = localPosition(43.64515, 78.535604);
  const second = localPosition(43.643198, 78.538828);
  expect(first[0]).toBeLessThan(second[0]);
  expect(first[2]).toBeLessThan(second[2]);
  expect(Math.abs(first[0] - second[0])).toBeGreaterThan(0.2);
});

it('bundles sampled local and mountain terrain with mapped waterways', () => {
  const local = terrain.heights.flat();
  const regional = terrain.regionalHeights.flat();
  expect(local).toHaveLength(65 * 65);
  expect(Math.max(...regional) - Math.min(...regional)).toBeGreaterThan(1000);
  expect(terrain.waterways.length).toBeGreaterThan(0);
  expect(terrain.roads.length).toBeGreaterThan(0);
});
