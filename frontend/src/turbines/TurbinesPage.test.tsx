// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../App';
import { fixture } from '../forecast/testFixture';

vi.mock('../scene/PlanetScene', () => ({ default: (props: Record<string, unknown>) => <div data-testid="scene-state">{JSON.stringify(props)}</div> }));
beforeEach(() => {
  window.history.replaceState(null, '', '#turbines');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture('live') }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '#overview'); });

function table() { return within(screen.getByRole('table', { name: /Turbine forecasts/ })); }

describe('Turbines page', () => {
  it('opens with the two API turbines and normalized readings', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Turbines' })).toBeTruthy();
    expect(table().getAllByRole('row')).toHaveLength(3);
    expect(screen.getByLabelText('Select Turbine 1')).toBeTruthy();
    expect(screen.getByLabelText('Select Turbine 2')).toBeTruthy();
    expect(table().getAllByText('0.021 / 1')).toHaveLength(2);
  });
  it('keeps selection while searching, then clears filters and selection', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Turbines' });
    fireEvent.click(screen.getByLabelText('Select Turbine 1'));
    fireEvent.change(screen.getByLabelText('Search turbines'), { target: { value: 'Turbine 2' } });
    fireEvent.click(screen.getByLabelText('Selected only'));
    expect(screen.getByText('No matching turbines')).toBeTruthy();
    expect(screen.getByLabelText('Remove 1 from selection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(table().getAllByRole('row')).toHaveLength(3);
    expect((screen.getByLabelText('Select Turbine 1') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Remove 1 from selection'));
    expect((screen.getByLabelText('Select Turbine 1') as HTMLInputElement).checked).toBe(false);
  });
  it('bulk-selects visible turbines and shows mean and individual forecasts', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Turbines' });
    fireEvent.click(screen.getByLabelText('Select Turbine 1'));
    expect((screen.getByLabelText('Select visible turbines') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByLabelText('Select visible turbines'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(within(screen.getByLabelText('Selected turbine summary')).getByText('0.021 / 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Individual' }));
    expect(screen.getByLabelText('Individual selected forecasts').textContent).toContain('1');
    expect(screen.getByLabelText('Individual selected forecasts').textContent).toContain('2');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect((screen.getByRole('button', { name: 'View selected in 3D' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('sorts by wind and synchronizes hour and selection with the 3D view', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Turbines' });
    fireEvent.change(screen.getByLabelText('Sort turbines'), { target: { value: 'wind-asc' } });
    expect(table().getAllByRole('row')[1].textContent).toContain('1');
    fireEvent.click(screen.getByLabelText('Select Turbine 2'));
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '17' } });
    const row = screen.getByLabelText('Select Turbine 2').closest('tr')!;
    expect(row.textContent).toContain('0.375');
    fireEvent.click(screen.getByRole('button', { name: 'View selected in 3D' }));
    expect(JSON.parse((await screen.findByTestId('scene-state')).textContent!).selected).toEqual(['2']);
    fireEvent.click(screen.getByRole('link', { name: 'Turbines' }));
    expect((screen.getByLabelText('Select Turbine 2') as HTMLInputElement).checked).toBe(true);
  });
});
