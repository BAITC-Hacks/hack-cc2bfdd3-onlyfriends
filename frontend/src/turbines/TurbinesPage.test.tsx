// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../App';
import { fixture } from '../forecast/testFixture';

vi.mock('../scene/PlanetScene', () => ({ default: (props: Record<string, unknown>) => <div data-testid="scene-state">{JSON.stringify(props)}</div> }));
beforeEach(() => {
  window.history.replaceState(null, '', '#turbines');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => fixture(url.includes('mode=live') ? 'live' : 'historical') })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '#overview'); });

describe('Turbines page with API forecasts', () => {
  it('opens a bookmark and shows only the two supplied turbines with normalized units', async () => {
    render(<App />);
    await screen.findByLabelText('Select Turbine 1');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'Normalized power' })).toBeTruthy();
    expect(within(screen.getByRole('table')).queryByText(/ MW/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Offline' })).toBeNull();
  });
  it('combines search, bulk selection and the comparison summary', async () => {
    render(<App />);
    await screen.findByLabelText('Select Turbine 1');
    fireEvent.click(screen.getByLabelText('Select Turbine 1'));
    expect((screen.getByLabelText('Select visible turbines') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByLabelText('Select visible turbines'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(within(screen.getByLabelText('Selected turbine summary')).getByText('2.1%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Individual' }));
    expect(screen.getByLabelText('Individual selected forecasts').textContent).toContain('1');
    fireEvent.change(screen.getByLabelText('Search turbines'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching turbines')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
  });
  it('retains selected turbines and hour when opening the 3D view', async () => {
    render(<App />);
    await screen.findByLabelText('Select Turbine 2');
    fireEvent.click(screen.getByLabelText('Select Turbine 2'));
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '17' } });
    expect(screen.getByLabelText('Select Turbine 2').closest('tr')?.textContent).toContain('37.5%');
    fireEvent.click(screen.getByRole('button', { name: 'View selected in 3D' }));
    const scene = await screen.findByTestId('scene-state');
    expect(JSON.parse(scene.textContent!).selected).toEqual(['2']);
    expect(window.location.hash).toBe('#overview');
    fireEvent.click(screen.getByRole('link', { name: 'Turbines' }));
    expect((screen.getByLabelText('Select Turbine 2') as HTMLInputElement).checked).toBe(true);
  });
});
