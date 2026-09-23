// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useWindAt } from './useWindAt';

const archive = { speed: 1.47, direction: 288 };
function Probe({ at }: { at: string }) {
  return <output>{JSON.stringify(useWindAt('2026-01-31T12:00:00Z', at, archive))}</output>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses API wind for the selected hour and reuses the run while scrubbing', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hourly: {
    time: ['2026-01-31T20:00', '2026-01-31T21:00'],
    wind_speed_100m: [4.2, 6.1], wind_direction_100m: [90, 180],
  } }) });
  vi.stubGlobal('fetch', request);
  const view = render(<Probe at="2026-01-31T20:00:00Z" />);
  expect(await screen.findByText(/"source":"api","speed":4.2/)).toBeTruthy();
  view.rerender(<Probe at="2026-01-31T21:00:00Z" />);
  expect(screen.getByText(/"source":"api","speed":6.1/)).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it('labels archived fallback when the provider fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<Probe at="2026-01-31T20:00:00Z" />);
  expect(await screen.findByText(/"source":"archive","speed":1.47/)).toBeTruthy();
  expect(screen.getByText(/"error":"Wind API returned 503/)).toBeTruthy();
});
