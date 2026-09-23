import type { ForecastHour, Reading, Turbine } from '../forecast/forecast';

export interface TurbineRow extends Turbine { reading?: Reading }
export type TurbineSort = 'wind-desc' | 'wind-asc' | 'power-desc' | 'name';
export interface TurbineFilters { query: string; selectedOnly: boolean; sort: TurbineSort }
export const DEFAULT_FILTERS: TurbineFilters = { query: '', selectedOnly: false, sort: 'wind-desc' };
export const PAGE_SIZE = 8;

export function filterTurbines(rows: TurbineRow[], filters: TurbineFilters, selected: readonly string[]): TurbineRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(row =>
    (!query || `${row.id} ${row.name}`.toLowerCase().includes(query)) &&
    (!filters.selectedOnly || selected.includes(row.id)),
  ).sort((a, b) => {
    if (filters.sort === 'name') return a.id.localeCompare(b.id, undefined, { numeric: true });
    const field = filters.sort === 'power-desc' ? 'power' : 'windSpeed';
    const av = a.reading?.[field], bv = b.reading?.[field];
    if (av === undefined || bv === undefined) return av === bv ? a.id.localeCompare(b.id) : av === undefined ? 1 : -1;
    return (av - bv) * (filters.sort === 'wind-asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
}

export function paginateTurbines(rows: TurbineRow[], requestedPage: number, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  return { page, pageCount, items: rows.slice(page * pageSize, (page + 1) * pageSize) };
}

export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
}

/** Empty selection is genuinely empty; the overview explicitly opts into whole-farm fallback. */
export function selectionForecast(hour: ForecastHour, selected: readonly string[]): ForecastHour {
  return { ...hour, readings: hour.readings.filter(reading => selected.includes(reading.turbineId)) };
}
