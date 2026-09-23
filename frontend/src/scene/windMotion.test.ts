import { expect, it } from 'vitest';
import { windStep } from './windMotion';

it('moves visible wind streaks downwind faster as API speed increases', () => {
  const slow = windStep(2, 90, 1);
  const fast = windStep(10, 90, 1);
  expect(slow[0]).toBeLessThan(0);
  expect(fast[0]).toBeLessThan(slow[0] * 2);
  expect(Math.abs(fast[1])).toBeLessThan(0.001);
});
