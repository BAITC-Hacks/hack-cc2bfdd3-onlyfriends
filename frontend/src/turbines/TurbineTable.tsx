import { useEffect, useRef } from 'react';
import { hourLabel } from '../forecast/forecast';
import { Icon } from '../components/Icon';
import type { TurbineRow } from './tableModel';

interface Props { rows: TurbineRow[]; timestamp: string; selected: string[]; onToggle: (id: string) => void; onSelectPage: (checked: boolean) => void; onReset: () => void }
export function TurbineTable({ rows, timestamp, selected, onToggle, onSelectPage, onReset }: Props) {
  const checkbox = useRef<HTMLInputElement>(null);
  const count = rows.filter(row => selected.includes(row.id)).length;
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = count > 0 && count < rows.length; }, [count, rows.length]);
  return <div className="turbine-table-scroll" tabIndex={0} role="region" aria-label="Turbine forecast table">
    <table className="turbine-table"><caption className="sr-only">Turbine forecasts for {hourLabel(timestamp, true)}, UTC+5</caption>
      <thead><tr><th scope="col"><input ref={checkbox} type="checkbox" aria-label="Select visible turbines" checked={rows.length > 0 && count === rows.length} disabled={!rows.length} onChange={e => onSelectPage(e.target.checked)} /></th><th scope="col">Turbine</th><th scope="col">Wind at 100 m</th><th scope="col">Direction</th><th scope="col">Normalized power</th><th scope="col">Temperature</th><th scope="col">Pressure</th><th scope="col">Forecast time</th></tr></thead>
      <tbody>{rows.map(row => { const reading = row.reading; return <tr key={row.id} data-selected={selected.includes(row.id)}>
        <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={() => onToggle(row.id)} /></td>
        <th scope="row"><span title={row.name}>{row.name}</span></th>
        <td>{reading ? `${reading.windSpeed.toFixed(1)} m/s` : '—'}</td>
        <td>{reading ? `${reading.direction.toFixed(0)}°` : '—'}</td>
        <td className="table-power">{reading ? `${(reading.power * 100).toFixed(1)}%` : '—'}</td>
        <td>{reading ? `${reading.temperature > 0 ? '+' : ''}${reading.temperature.toFixed(1)}°C` : '—'}</td>
        <td>{reading ? `${reading.pressure.toFixed(0)} hPa` : '—'}</td>
        <td><time dateTime={timestamp}>{hourLabel(timestamp)}</time></td>
      </tr>; })}</tbody>
    </table>
    {!rows.length && <div className="table-empty"><Icon name="search" size={24} /><strong>No matching turbines</strong><p>Try another search or adjust the filters.</p><button onClick={onReset}>Reset filters</button></div>}
  </div>;
}
