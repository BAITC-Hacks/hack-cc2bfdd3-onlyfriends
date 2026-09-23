import { Icon } from '../components/Icon';
import type { TurbineFilters as Filters, TurbineSort } from './tableModel';

export function TurbineFilters({ value, onChange }: { value: Filters; onChange: (filters: Filters) => void }) {
  return <div className="turbine-filters">
    <label className="turbine-search"><Icon name="search" size={15} /><input type="search" aria-label="Search turbines" placeholder="Search turbines…" value={value.query} onChange={e => onChange({ ...value, query: e.target.value })} /></label>
    <div className="status-filters" role="group" aria-label="Filter by turbine status">{(['all', 'active', 'warning', 'offline'] as const).map(status => <button key={status} aria-pressed={value.status === status} onClick={() => onChange({ ...value, status })}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div>
    <label className="selected-only"><input type="checkbox" checked={value.selectedOnly} onChange={e => onChange({ ...value, selectedOnly: e.target.checked })} /><span>Selected only</span></label>
    <select aria-label="Sort turbines" className="turbine-sort" value={value.sort} onChange={e => onChange({ ...value, sort: e.target.value as TurbineSort })}><option value="wind-desc">Wind speed ↓</option><option value="wind-asc">Wind speed ↑</option><option value="power-desc">Power ↓</option><option value="name">Turbine A–Z</option></select>
  </div>;
}
