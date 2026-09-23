// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createForecast } from '../forecast/forecast';
import { ShapPanel } from './ShapPanel';

afterEach(cleanup);

describe('archived model explanations', () => {
  it('shows real SHAP contributions for selected issue, hour and turbine', () => {
    const date = '2026-02-01';
    const hours = createForecast(date);
    render(<ShapPanel date={date} hour={hours[0]} selected={['1']} />);

    expect(screen.getByRole('heading', { name: 'Why this forecast?' })).toBeTruthy();
    expect(screen.getByText(/Model 7a9f78e7185f367e/)).toBeTruthy();
    expect(screen.getByText('Density adjusted wind')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Explain turbine'), { target: { value: '2' } });
    expect((screen.getByLabelText('Explain turbine') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 25 features' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
  });
});
