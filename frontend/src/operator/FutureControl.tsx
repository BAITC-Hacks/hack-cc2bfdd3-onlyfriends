import { availableDates, createForecast, hourLabel, turbines, type ForecastHour } from '../forecast/forecast';
import { explainHour, forecastRevision, futureEvents } from './future';
import { localDayBounds, planMaintenance, type MaintenanceWindow } from './maintenance';
import './future-control.css';

interface Props {
  hours: ForecastHour[];
  horizon: 24 | 48;
  date: string;
  activeHour: number;
  turbineId: string;
  duration: number;
  tomorrow: boolean;
  onTurbine: (id: string) => void;
  onDuration: (hours: number) => void;
  onTomorrow: (tomorrow: boolean) => void;
  onHour: (index: number) => void;
  onSimulate: (window: MaintenanceWindow) => void;
  onClose: () => void;
}

const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

export function FutureControl({ hours, horizon, date, activeHour, turbineId, duration, tomorrow, onTurbine, onDuration, onTomorrow, onHour, onSimulate, onClose }: Props) {
  const visible = hours.slice(0, horizon);
  const tomorrowDate = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const bounds = tomorrow && horizon === 48 ? localDayBounds(visible, tomorrowDate) : { startIndex: 0, endIndex: horizon };
  const plan = planMaintenance(visible, turbineId, duration, bounds.startIndex, bounds.endIndex);
  const events = futureEvents(visible, plan.recommended.startIndex);
  const priorIndex = availableDates.indexOf(date) - 1;
  const revision = priorIndex >= 0 ? forecastRevision(visible, createForecast(availableDates[priorIndex])) : null;
  const explanationIndex = activeHour > 0 ? activeHour : plan.recommended.startIndex;
  const explanation = explainHour(visible, explanationIndex);
  const turbine = turbines.find(item => item.id === turbineId)!;
  const recommended = plan.recommended;
  return <div className="future-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="future-dialog" role="dialog" aria-modal="true" aria-label="Future Control">
      <header className="future-header">
        <div>
          <span className="future-kicker">WindOS · decision preview</span>
          <h2>Future Control<span>.</span></h2>
          <p>Find the lowest forecast output window for a planned turbine stop.</p>
        </div>
        <button className="future-close" onClick={onClose} aria-label="Close Future Control">×</button>
      </header>

      <div className="future-controls">
        <label>Maintenance turbine
          <select aria-label="Maintenance turbine" value={turbineId} onChange={event => onTurbine(event.target.value)}>
            {turbines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Duration
          <select aria-label="Duration" value={duration} onChange={event => onDuration(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value} {value === 1 ? 'hour' : 'hours'}</option>)}
          </select>
        </label>
        <div className="future-scope">
          <span>Search period</span>
          {horizon === 48 ? <div role="group" aria-label="Maintenance search period">
            <button aria-pressed={!tomorrow} onClick={() => onTomorrow(false)}>Next 48h</button>
            <button aria-pressed={tomorrow} onClick={() => onTomorrow(true)}>Tomorrow</button>
          </div> : <strong>Next 24h</strong>}
        </div>
      </div>

      <div className="future-decision">
        <div className="future-recommendation">
          <span className="future-kicker">Recommended maintenance · {turbine.name}</span>
          <h3>{hourLabel(recommended.startAt, true)}<small> to </small>{hourLabel(recommended.endAt, true)}</h3>
          <p>{plan.candidateCount} windows checked · {duration} consecutive hours</p>
          <div className="future-numbers">
            <div><span>Expected shutdown loss</span><strong>{recommended.lost.toFixed(3)}</strong><small>normalized turbine-hours</small></div>
            <div><span>Farm output during window</span><strong>{recommended.farmAfter.toFixed(3)}</strong><small>vs {recommended.farmBefore.toFixed(3)} baseline</small></div>
          </div>
          <button className="future-primary" onClick={() => onSimulate(recommended)}>Simulate shutdown <span>↗</span></button>
        </div>
        <div className="future-comparison">
          <span className="future-kicker">Another non-overlapping window</span>
          {plan.alternative ? <>
            <strong>{hourLabel(plan.alternative.startAt, true)}–{hourLabel(plan.alternative.endAt)}</strong>
            <p>{plan.alternative.lost.toFixed(3)} normalized turbine-hours lost</p>
            {plan.avoidedLossPercent !== null && <div className="future-saving">{plan.avoidedLossPercent.toFixed(0)}% less predicted loss <span>than this alternative</span></div>}
          </> : <p>No second non-overlapping window fits this horizon.</p>}
          <div className="future-caveat">
            <strong>Confidence · not calibrated</strong>
            <p>Point forecast only. No calibrated per-hour interval or validated wake model. Review before scheduling real work.</p>
          </div>
        </div>
      </div>

      <div className="future-lower">
        <section>
          <span className="future-kicker">Events across the selected issue</span>
          <div className="future-events">{events.map(event => <button key={`${event.kind}-${event.index}`} className={event.kind} onClick={() => onHour(event.index)}>
            <time>{hourLabel(visible[event.index].at)}</time>
            <span><strong>{event.label}</strong><small>{event.detail}</small></span>
          </button>)}</div>
        </section>
        <section className="future-context">
          <span className="future-kicker">What changed?</span>
          {revision ? <p>Largest shared-hour revision: <strong>{signed(revision.powerChange, 3)} normalized</strong> at {hourLabel(revision.at, true)}. At that hour, wind direction changed {signed(revision.directionChange, 0)}° between issues. Compared {revision.comparedHours} matching hours.</p> : <p>No earlier issue is available for comparison.</p>}
          <span className="future-kicker">Why this hour looks different</span>
          {explanation ? <p>At {hourLabel(visible[explanationIndex].at, true)}, versus the prior hour: output {signed(explanation.powerChange, 3)}, wind {signed(explanation.windChange, 1)} m/s, direction {signed(explanation.directionChange, 0)}°. These are forecast changes, not causal attribution.</p> : <p>Select a later hour to compare it with the previous forecast hour.</p>}
        </section>
      </div>
      <footer className="future-footer">Archived ECMWF input · model forecast · 0–1 normalized output per turbine · no physical MWh estimate</footer>
    </section>
  </div>;
}
