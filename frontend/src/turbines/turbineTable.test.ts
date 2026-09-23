import { describe, expect, it } from 'vitest';
import { filterTurbines, paginateTurbines, selectionForecast, toggleSelection, type TurbineRow } from './tableModel';
import { forecast, turbines } from '../forecast/forecast';

const rows: TurbineRow[] = [
  { id: 'T01', name: 'Turbine 01', region: '', lat: 0, lon: 0, status: 'active', reading: { ...forecast[0].readings[0], turbineId: 'T01', windSpeed: 7, power: 1.5 } },
  { id: 'T02', name: 'Turbine 02', region: '', lat: 0, lon: 0, status: 'warning', reading: { ...forecast[0].readings[0], turbineId: 'T02', windSpeed: 10, power: 2.5 } },
  { id: 'T03', name: 'Turbine 03', region: '', lat: 0, lon: 0, status: 'offline' },
];
const filters = { query: '', status: 'all' as const, selectedOnly: false, sort: 'wind-desc' as const };
describe('turbine table', () => {
  it('combines search, status and selection without discarding hidden selections', () => {
    const selected = ['T01', 'T02'];
    expect(filterTurbines(rows, { ...filters, query: ' turbine 02 ', status: 'warning', selectedOnly: true }, selected).map(r => r.id)).toEqual(['T02']);
    expect(filterTurbines(rows, { ...filters, query: 'not found' }, selected)).toEqual([]);
    expect(selected).toEqual(['T01', 'T02']);
  });
  it('sorts numeric readings and puts missing data last in either direction', () => {
    expect(filterTurbines(rows, filters, []).map(r => r.id)).toEqual(['T02', 'T01', 'T03']);
    expect(filterTurbines(rows, { ...filters, sort: 'wind-asc' }, []).map(r => r.id)).toEqual(['T01', 'T02', 'T03']);
  });
  it('clamps pagination after filtering and handles no results', () => {
    expect(paginateTurbines(rows, 8, 2)).toMatchObject({ page: 1, pageCount: 2, items: [rows[2]] });
    expect(paginateTurbines([], 4, 8)).toMatchObject({ page: 0, pageCount: 1, items: [] });
  });
  it('toggles IDs without duplicates and aggregates only selected readings', () => {
    expect(toggleSelection(['T01'], 'T01')).toEqual([]);
    expect(toggleSelection(['T01'], 'T02')).toEqual(['T01', 'T02']);
    expect(selectionForecast(forecast[0], [turbines[0].id]).readings).toEqual([forecast[0].readings[0]]);
    expect(selectionForecast(forecast[0], []).readings).toEqual([]);
  });
});
