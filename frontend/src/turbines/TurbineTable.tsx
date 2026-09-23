import { useEffect, useRef } from 'react';
import { hourLabel } from '../forecast/forecast';
import { environmentAt } from '../forecast/environment';
import { Icon } from '../components/Icon';
import type { TurbineRow } from './tableModel';

interface Props { rows: TurbineRow[]; timestamp: string; selected: string[]; onToggle: (id: string) => void; onSelectPage: (checked: boolean) => void; onReset: () => void }
export function TurbineTable({ rows, timestamp, selected, onToggle, onSelectPage, onReset }: Props) {
  const checkbox = useRef<HTMLInputElement>(null);
  const count = rows.filter(row => selected.includes(row.id)).length;
  const night = environmentAt(timestamp).timeOfDay === 'night';
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = count > 0 && count < rows.length; }, [count, rows.length]);
  return <div className="turbine-table-scroll" tabIndex={0} role="region" aria-label="Turbine forecast table">
    <table className="turbine-table"><caption className="sr-only">Turbine forecasts for {hourLabel(timestamp, true)}, UTC+5</caption>
      <thead><tr><th scope="col"><input ref={checkbox} type="checkbox" aria-label="Select visible turbines" checked={rows.length > 0 && count === rows.length} disabled={!rows.length} onChange={e => onSelectPage(e.target.checked)} /></th><th scope="col">Turbine</th><th scope="col">Status</th><th scope="col">Wind speed</th><th scope="col">Direction</th><th scope="col">Predicted power</th><th scope="col">Temperature</th><th scope="col">Weather</th><th scope="col">Forecast time</th></tr></thead>
      <tbody>{rows.map(row => {
        const reading = row.reading;
        const cloud = reading?.condition === 'cloud';
        return <tr key={row.id} data-selected={selected.includes(row.id)}>
          <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={() => onToggle(row.id)} /></td>
          <th scope="row"><span title={row.name}>{row.id}</span></th>
          <td><span className={`turbine-status status-${row.status}`} title={row.status === 'warning' ? 'Demo maintenance advisory' : row.status === 'offline' ? 'Demo turbine unavailable; forecast output is zero' : 'Demo available turbine'}><i />{row.status[0].toUpperCase() + row.status.slice(1)}</span></td>
          <td>{reading ? `${reading.windSpeed.toFixed(1)} m/s` : '—'}</td>
          <td>{reading ? `${reading.direction}°` : '—'}</td>
          <td className="table-power">{reading ? `${reading.power.toFixed(2)} MW` : '—'}</td>
          <td>{reading ? `${reading.temperature > 0 ? '+' : ''}${Math.round(reading.temperature)}°C` : '—'}</td>
          <td>{reading ? <span className="table-weather"><Icon name={night ? cloud ? 'cloudMoon' : 'moon' : cloud ? 'cloud' : 'sun'} size={15} />{cloud ? 'Cloudy' : night ? 'Clear' : 'Sunny'}</span> : '—'}</td>
          <td><time dateTime={timestamp}>{hourLabel(timestamp)}</time></td>
        </tr>;
      })}</tbody>
    </table>
    {!rows.length && <div className="table-empty"><Icon name="search" size={24} /><strong>No matching turbines</strong><p>Try another search or adjust the filters.</p><button onClick={onReset}>Reset filters</button></div>}
  </div>;
}
