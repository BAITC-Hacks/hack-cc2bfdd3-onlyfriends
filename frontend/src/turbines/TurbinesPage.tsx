import { useState } from 'react';
import { turbines, type ForecastHour } from '../forecast/forecast';
import { Icon } from '../components/Icon';
import { DEFAULT_FILTERS, filterTurbines, paginateTurbines, PAGE_SIZE, toggleSelection, type TurbineFilters as Filters } from './tableModel';
import { TurbineFilters } from './TurbineFilters';
import { TurbineTable } from './TurbineTable';
import { SelectionSummary } from './SelectionSummary';
import './turbines.css';

interface Props { hour: ForecastHour; selected: string[]; onSelection: (selected: string[]) => void; onView3D: () => void }
export function TurbinesPage({ hour, selected, onSelection, onView3D }: Props) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [requestedPage, setRequestedPage] = useState(0);
  const rows = turbines.map(turbine => ({ ...turbine, reading: hour.readings.find(reading => reading.turbineId === turbine.id) }));
  const filtered = filterTurbines(rows, filters, selected);
  const { page, pageCount, items } = paginateTurbines(filtered, requestedPage);
  function changeFilters(value: Filters) { setFilters(value); setRequestedPage(0); }
  function toggle(id: string) { onSelection(toggleSelection(selected, id)); }
  function selectPage(checked: boolean) {
    const ids = items.map(row => row.id);
    onSelection(checked ? [...new Set([...selected, ...ids])] : selected.filter(id => !ids.includes(id)));
  }
  return <section className="turbines-page" aria-labelledby="turbines-heading">
    <div className="turbines-toolbar"><div className="turbines-heading"><h1 id="turbines-heading">Turbines</h1><p>{turbines.length} turbines · {selected.length} selected</p></div><TurbineFilters value={filters} onChange={changeFilters} /></div>
    <div className="selected-chips" aria-label="Selected turbines">{selected.length ? <>{selected.map(id => <button className="turbine-chip" key={id} onClick={() => toggle(id)} aria-label={`Remove ${id} from selection`}>{id}<Icon name="close" size={11} /></button>)}<button className="clear-selection" onClick={() => onSelection([])}>Clear selection</button></> : <span>Select turbines to compare or highlight in 3D.</span>}</div>
    <TurbineTable rows={items} timestamp={hour.at} selected={selected} onToggle={toggle} onSelectPage={selectPage} onReset={() => changeFilters(DEFAULT_FILTERS)} />
    <div className="table-footer"><span>{filtered.length ? `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + items.length} of ${filtered.length}` : 'Showing 0'} <span className="filtered-count">/ {turbines.length} turbines</span></span>
      <nav className="table-pagination" aria-label="Turbine table pages"><button disabled={page === 0} aria-label="Previous page" onClick={() => setRequestedPage(page - 1)}><Icon name="left" size={14} /></button>{Array.from({ length: pageCount }, (_, index) => <button key={index} aria-label={`Page ${index + 1}`} aria-current={page === index ? 'page' : undefined} onClick={() => setRequestedPage(index)}>{index + 1}</button>)}<button disabled={page === pageCount - 1} aria-label="Next page" onClick={() => setRequestedPage(page + 1)}><Icon name="right" size={14} /></button></nav>
      <button className="view-in-3d" disabled={!selected.length} onClick={onView3D}><Icon name="box" size={16} />View selected in 3D</button>
    </div>
    <SelectionSummary hour={hour} selected={selected} />
  </section>;
}
