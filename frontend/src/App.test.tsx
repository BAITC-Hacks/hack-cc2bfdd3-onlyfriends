// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { fixture } from './forecast/testFixture';

vi.mock('./scene/PlanetScene', () => ({ default: ({ selected, hour, zoom, environment }: { selected: string[]; hour: { at: string }; zoom: number; environment: { season: string } }) => <div data-testid="scene-state">{selected.join(',')}/{hour.at}/{zoom}/{environment.season}</div> }));
beforeEach(() => {
  window.history.replaceState(null, '', '#overview');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => fixture(url.includes('mode=live') ? 'live' : 'historical') })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('forecast dashboard', () => {
  it('renders the loaded model output and synchronizes selected turbine and hour', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    expect(screen.getByText('2 TURBINES · HISTORICAL')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('mode=historical'));
    expect(screen.getByTestId('forecast-power').textContent).toContain('0.021');
    fireEvent.change(screen.getByLabelText('Explore a turbine'), { target: { value: '2' } });
    expect(screen.getByTestId('scene-state').textContent).toContain('2/');
    const initialScene = screen.getByTestId('scene-state').textContent;
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '23' } });
    expect(screen.getByTestId('scene-state').textContent).not.toBe(initialScene);
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    expect((screen.getByLabelText('Forecast hour') as HTMLInputElement).max).toBe('23');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it('passes forecast time environment and 5x zoom to the scene', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.click(screen.getByRole('button', { name: '5×' }));
    expect(screen.getByTestId('scene-state').textContent).toContain('/5/');
    expect(screen.getByRole('button', { name: '5×' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('main').getAttribute('data-season')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset planet view' }));
    expect(screen.getByRole('button', { name: '1×' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('checks live weather again after fifteen minutes while the page is visible', async () => {
    Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' });
    const intervals = vi.spyOn(window, 'setInterval');
    try {
      render(<App />);
      await screen.findByTestId('scene-state');
      fireEvent.change(screen.getByLabelText('Forecast mode'), { target: { value: 'live' } });
      await screen.findByText('2 TURBINES · LIVE');
      const initialCalls = vi.mocked(fetch).mock.calls.length;
      const poll = intervals.mock.calls.find(([, delay]) => delay === 15 * 60 * 1000)?.[0] as (() => void) | undefined;
      expect(poll).toBeTruthy();
      await act(async () => { poll?.(); await Promise.resolve(); });
      expect(vi.mocked(fetch).mock.calls.length).toBe(initialCalls + 1);
    } finally { intervals.mockRestore(); }
  });
  it('shows model-unavailable status without a forecast or false power', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error_code: 'MODEL_UNAVAILABLE', message: 'Trained power model file is missing.' }) }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('MODEL_UNAVAILABLE'));
    expect(screen.queryByLabelText('Forecast metrics')).toBeNull();
    expect(screen.queryByTestId('scene-state')).toBeNull();
  });
  it('keeps the hackathon date range in historical replay only', async () => {
    render(<App />);
    await screen.findByTestId('scene-state');
    expect(screen.getByLabelText('Issue date')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Forecast mode'), { target: { value: 'live' } });
    expect(screen.queryByLabelText('Issue date')).toBeNull();
    fireEvent.change(screen.getByLabelText('Forecast mode'), { target: { value: 'historical' } });
    const date = screen.getByLabelText('Issue date') as HTMLInputElement;
    expect(date.min).toBe('2026-01-31');
    expect(date.max).toBe('2026-02-28');
    await screen.findByText('2 TURBINES · HISTORICAL');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('mode=historical'));
  });
  it('shows an explicit service error when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect refused')));
    render(<App />);
    expect((await screen.findByRole('status')).textContent).toContain('API_UNAVAILABLE');
    expect(screen.queryByLabelText('Forecast metrics')).toBeNull();
  });
  it('asks about the selected 23 February forecast and sends its hour and turbine', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/ask') return { ok: true, json: async () => ({ answer: '23 февраля ветер по прогнозу усиливается.' }) };
      const issue = new URL(url, 'http://localhost').searchParams.get('issue') ?? undefined;
      return { ok: true, json: async () => fixture('historical', issue) };
    }));
    render(<App />);
    await screen.findByTestId('scene-state');
    fireEvent.change(screen.getByLabelText('Forecast mode'), { target: { value: 'historical' } });
    fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-02-23' } });
    await screen.findByText('2 TURBINES · HISTORICAL');
    fireEvent.change(screen.getByLabelText('Explore a turbine'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Ask forecast assistant'), { target: { value: 'почему за этот день такой сильный ветер' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }));
    expect((await screen.findByRole('status')).textContent).toContain('23 февраля ветер');
    const askCall = vi.mocked(fetch).mock.calls.find(call => call[0] === '/api/ask');
    expect(JSON.parse((askCall?.[1] as RequestInit).body as string)).toMatchObject({
      question: 'почему за этот день такой сильный ветер', selected_lead_hour: 4,
      selected_turbine_id: '2', horizon: 48, run_id: 'test',
    });
  });
});
