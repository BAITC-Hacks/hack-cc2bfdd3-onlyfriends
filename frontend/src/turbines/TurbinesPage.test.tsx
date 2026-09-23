// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../App';
import { forecast, turbines } from '../forecast/forecast';

vi.mock('../scene/PlanetScene', () => ({ default: (props: Record<string, unknown>) => <div data-testid="scene-state">{JSON.stringify(props)}</div> }));
beforeEach(() => {
  window.history.replaceState(null, '', '#turbines');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '#overview'); });

describe('Turbines page', () => {
  it('opens the bookmarked page with the existing six turbines and working status filters', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Turbines' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(turbines.length + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByLabelText('Select Turbine 05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    expect(screen.getByLabelText('Select Turbine 06')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('0.00 MW')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getAllByRole('row')).toHaveLength(5);
  });
  it('combines search and selection, clears empty filters, and keeps hidden selections', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Select Turbine 01'));
    fireEvent.click(screen.getByLabelText('Select Turbine 03'));
    fireEvent.change(screen.getByLabelText('Search turbines'), { target: { value: 'T02' } });
    fireEvent.click(screen.getByLabelText('Selected only'));
    expect(screen.getByText('No matching turbines')).toBeTruthy();
    expect(screen.getByLabelText('Remove T01 from selection')).toBeTruthy();
    expect(screen.getByLabelText('Remove T03 from selection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getAllByRole('row')).toHaveLength(7);
    expect((screen.getByLabelText('Select Turbine 01') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Remove T01 from selection'));
    expect((screen.getByLabelText('Select Turbine 01') as HTMLInputElement).checked).toBe(false);
  });
  it('selects only visible rows and shows an indeterminate bulk checkbox', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Select Turbine 05'));
    expect((screen.getByLabelText('Select visible turbines') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    fireEvent.click(screen.getByLabelText('Select visible turbines'));
    expect(screen.getByText('5 selected')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select visible turbines'));
    expect(screen.getByLabelText('Remove T05 from selection')).toBeTruthy();
    expect(screen.queryByLabelText('Remove T01 from selection')).toBeNull();
  });
  it('sorts by wind and switches between aggregate and individual selected forecasts', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Sort turbines'), { target: { value: 'wind-asc' } });
    const first = screen.getAllByRole('row')[1].textContent;
    const expected = [...forecast[0].readings].sort((a, b) => a.windSpeed - b.windSpeed)[0];
    expect(first).toContain(expected.turbineId);
    fireEvent.click(screen.getByLabelText('Select Turbine 01'));
    fireEvent.click(screen.getByLabelText('Select Turbine 03'));
    const total = forecast[0].readings[0].power + forecast[0].readings[2].power;
    expect(within(screen.getByLabelText('Selected turbine summary')).getByText(`${total.toFixed(2)} MW`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Individual' }));
    expect(screen.getByLabelText('Individual selected forecasts').textContent).toContain('T01');
    expect(screen.getByLabelText('Individual selected forecasts').textContent).toContain('T03');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'View selected in 3D' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('updates forecast time, power and weather with the shared timeline and retains selection in 3D', async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Select Turbine 02'));
    fireEvent.click(screen.getByLabelText('Select Turbine 04'));
    fireEvent.change(screen.getByLabelText('Forecast hour'), { target: { value: '17' } });
    const row = screen.getByLabelText('Select Turbine 02').closest('tr')!;
    expect(row.textContent).toContain('02:00');
    expect(row.textContent).toContain(forecast[17].readings[1].power.toFixed(2));
    fireEvent.click(screen.getByRole('button', { name: 'View selected in 3D' }));
    const scene = await screen.findByTestId('scene-state');
    expect(JSON.parse(scene.textContent!).selected).toEqual(['T02', 'T04']);
    expect(JSON.parse(scene.textContent!).environment.timeOfDay).toBe('night');
    expect(window.location.hash).toBe('#overview');
    fireEvent.click(screen.getByRole('link', { name: 'Turbines' }));
    expect((screen.getByLabelText('Select Turbine 02') as HTMLInputElement).checked).toBe(true);
  });
});
