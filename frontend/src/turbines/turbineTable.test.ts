import { describe, expect, it } from 'vitest';
import { filterTurbines, paginateTurbines, selectionForecast, toggleSelection, type TurbineRow } from './tableModel';
import { parsedFixture } from '../forecast/testFixture';

const forecast = parsedFixture();
const rows: TurbineRow[] = forecast.turbines.map((turbine, index) => ({ ...turbine, reading: forecast.hours[0].readings[index] }));
const filters = { query: '', selectedOnly: false, sort: 'wind-desc' as const };
describe('turbine table', () => {
  it('combines search and selection without discarding hidden selections', () => {
    const selected = ['1', '2'];
    expect(filterTurbines(rows, { ...filters, query: ' turbine 2 ', selectedOnly: true }, selected).map(r => r.id)).toEqual(['2']);
    expect(filterTurbines(rows, { ...filters, query: 'not found' }, selected)).toEqual([]);
    expect(selected).toEqual(['1', '2']);
  });
  it('sorts readings and clamps pagination', () => {
    const varying = rows.map((row, index) => ({ ...row, reading: { ...row.reading!, windSpeed: index ? 10 : 7 } }));
    expect(filterTurbines(varying, filters, []).map(r => r.id)).toEqual(['2', '1']);
    expect(filterTurbines(varying, { ...filters, sort: 'wind-asc' }, []).map(r => r.id)).toEqual(['1', '2']);
    expect(paginateTurbines(varying, 8, 1)).toMatchObject({ page: 1, pageCount: 2, items: [varying[1]] });
    expect(paginateTurbines([], 4, 8)).toMatchObject({ page: 0, pageCount: 1, items: [] });
  });
  it('toggles IDs and includes only selected readings', () => {
    expect(toggleSelection(['1'], '1')).toEqual([]);
    expect(toggleSelection(['1'], '2')).toEqual(['1', '2']);
    expect(selectionForecast(forecast.hours[0], ['1']).readings).toEqual([forecast.hours[0].readings[0]]);
    expect(selectionForecast(forecast.hours[0], []).readings).toEqual([]);
  });
});
