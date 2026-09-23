// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./scene/PlanetScene', () => ({ default: (props: Record<string, unknown>) => <div data-testid="scene-state">{JSON.stringify(props)}</div> }));
beforeEach(() => {
  window.history.replaceState(null, '', '#overview');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dashboard interactions', () => {
  it('offers only February 2026 dates in the forecast picker', () => {
    render(<App />);
    const picker = screen.getByLabelText('Forecast start date') as HTMLSelectElement;
    expect(picker.tagName).toBe('SELECT');
    const dates = Array.from(picker.options, option => option.value);
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe('2026-02-01');
    expect(dates.at(-1)).toBe('2026-02-28');
    expect(dates.every(value => value.startsWith('2026-02-'))).toBe(true);
  });
  it('selects a turbine and restores whole-farm metrics', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.change(screen.getByLabelText('Explore a turbine'), { target: { value: '2' } });
    expect(screen.getByRole('heading', { name: 'Turbine 2' })).toBeTruthy();
    expect(screen.getByTestId('scene-state').textContent).toContain('"selected":["2"]');
    fireEvent.click(screen.getByLabelText('Show whole farm'));
    expect(screen.queryByRole('complementary', { name: 'Turbine insight' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Farm forecast metrics' })).toBeTruthy();
  });
  it('clamps the selected hour when switching from 48 to 24 hours', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    const slider = screen.getByLabelText('Forecast hour') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '47' } });
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    expect(slider.value).toBe('23');
    expect(slider.max).toBe('23');
    fireEvent.click(screen.getByRole('button', { name: 'When is peak power?' }));
    expect(screen.getByRole('status').textContent).toContain('24-hour archived forecast');
  });
  it('plays, wraps at the horizon, and stops when scrubbing', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    vi.useFakeTimers();
    const slider = screen.getByLabelText('Forecast hour') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '47' } });
    fireEvent.click(screen.getByLabelText('Play forecast'));
    act(() => { vi.advanceTimersByTime(1200); });
    expect(slider.value).toBe('0');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(screen.getByLabelText('Play forecast')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2400); });
    expect(slider.value).toBe('7');
  });
  it('changes zoom, resets it and propagates display settings to the scene', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    expect(screen.getByTestId('scene-state').textContent).toContain('"zoom":2');
    for (const zoom of [1, 3, 4, 5, 8, 12]) {
      fireEvent.click(screen.getByRole('button', { name: `${zoom}×` }));
      expect(screen.getByTestId('scene-state').textContent).toContain(`"zoom":${zoom}`);
    }
    fireEvent.click(screen.getByLabelText('Reset planet view'));
    expect(screen.getByTestId('scene-state').textContent).toContain('"zoom":1');
    fireEvent.click(screen.getByLabelText('Display settings'));
    fireEvent.click(screen.getByLabelText('Weather markers'));
    fireEvent.click(screen.getByLabelText('Use supplied GLB turbine'));
    expect(screen.getByTestId('scene-state').textContent).toContain('"weather":false');
    expect(screen.getByTestId('scene-state').textContent).toContain('"suppliedModel":true');
  });
  it('handles unsupported assistant questions and closes the response', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.change(screen.getByLabelText('Ask the demo forecast assistant'), { target: { value: 'buy a car' } });
    fireEvent.click(screen.getByLabelText('Ask assistant'));
    expect(screen.getByRole('status').textContent).toContain('No live AI service');
    fireEvent.click(screen.getByLabelText('Dismiss answer'));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('honors reduced-motion preference on first render', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    render(<App />);
    expect((await screen.findByTestId('scene-state')).textContent).toContain('"motion":false');
  });
  it('synchronizes date, lighting, power and season from the selected forecast', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    const initialPower = screen.getByTestId('forecast-power').textContent;
    fireEvent.change(screen.getByLabelText('Forecast start date'), { target: { value: '2026-02-02' } });
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '17' } });
    expect(screen.getByLabelText('Scene environment').textContent).toContain('winter');
    expect(screen.getByTestId('scene-state').textContent).toContain('2026-02-02');
    expect(screen.getByTestId('forecast-power').textContent).not.toBe(initialPower);
    const picker = screen.getByLabelText('Forecast start date') as HTMLSelectElement;
    expect(Array.from(picker.options, option => option.value)).not.toContain('2026-07-01');
    expect(picker.value).toBe('2026-02-02');
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '4' } });
    expect(screen.getByLabelText('Scene environment').textContent).toContain('winter');
    expect(screen.getByRole('heading', { name: 'The story behind the wind.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full February' }));
    expect(screen.getByText('1–28 Feb · every local hour')).toBeTruthy();
  });
  it('keeps analytics below the assistant and exposes all February hours by scrolling', () => {
    render(<App />);
    const assistant = screen.getByLabelText('Ask the demo forecast assistant');
    const analytics = screen.getByRole('region', { name: 'Hourly forecast readings' });
    expect(assistant.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full February' }));
    expect(analytics.querySelectorAll('tbody tr')).toHaveLength(672);
    expect(analytics.querySelector('th')?.textContent).toBe('Local time');
    expect(analytics.textContent).toContain('Δ 24 hours');
    fireEvent.click(screen.getByRole('link', { name: 'Analytics' }));
    expect(window.location.hash).toBe('#analytics');
  });
  it('opens Future Control, ranks the selected window, and applies a turbine-off scenario to the scene and metrics', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.click(screen.getByRole('button', { name: 'Plan maintenance' }));
    expect(screen.getByRole('dialog', { name: 'Future Control' })).toBeTruthy();
    expect(screen.getByText(/21 windows checked/)).toBeTruthy();
    expect(screen.getAllByText(/normalized turbine-hours/i).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Maintenance turbine'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '6' } });
    expect(screen.getByText(/19 windows checked/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Simulate shutdown/ }));
    expect(screen.queryByRole('dialog', { name: 'Future Control' })).toBeNull();
    expect(screen.getByTestId('scene-state').textContent).toContain('"offlineTurbineId":"1"');
    expect(screen.getByTestId('forecast-power').textContent).toContain('0.000');
    expect(screen.getByText(/What-if output/)).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Active what-if scenario' })).toBeTruthy();
    expect(screen.getByText(/What-if view · selected issue only/)).toBeTruthy();
    const plannedHour = (screen.getByLabelText('Forecast hour') as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '0' } });
    expect(screen.getByTestId('scene-state').textContent).toContain('"offlineTurbineId":null');
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: plannedHour } });
    expect(screen.getByTestId('scene-state').textContent).toContain('"offlineTurbineId":"1"');
    fireEvent.click(screen.getByRole('button', { name: 'Clear what-if scenario' }));
    expect(screen.getByTestId('scene-state').textContent).toContain('"offlineTurbineId":null');
  });
  it('turns the maintenance prompt into a reviewable plan and uses next hours on a 24-hour horizon', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.change(screen.getByLabelText('Ask the demo forecast assistant'), { target: { value: 'Tomorrow I need to stop turbine 2 for four hours. Find the best window.' } });
    fireEvent.click(screen.getByLabelText('Ask assistant'));
    expect(screen.getByRole('dialog', { name: 'Future Control' })).toBeTruthy();
    expect((screen.getByLabelText('Maintenance turbine') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Close Future Control' }));
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan maintenance' }));
    expect(screen.getByText(/21 windows checked/)).toBeTruthy();
    expect(screen.getByText('Next 24h')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Future Control' }));
    fireEvent.change(screen.getByLabelText('Ask the demo forecast assistant'), { target: { value: 'Service turbine 1 for 7 hours' } });
    fireEvent.click(screen.getByLabelText('Ask assistant'));
    expect((screen.getByLabelText('Duration') as HTMLSelectElement).value).toBe('7');
  });
});
