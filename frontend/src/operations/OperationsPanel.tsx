import type { ForecastDocument, OperationSignal } from '../forecast/forecast';
import './operations.css';

function localTime(utc: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(utc));
}

function describe(signal: OperationSignal) {
  if (signal.kind === 'low_output') return {
    title: `${signal.hours}h low-output window`,
    detail: `Mean predicted output ${(100 * (signal.mean_power ?? 0)).toFixed(1)}%`,
    action: 'Check the reserve plan for this window.',
  };
  const change = Math.abs(100 * (signal.delta ?? 0)).toFixed(1);
  return signal.kind === 'ramp_down' ? {
    title: `Output falls ${change} points in 3h`,
    detail: `${(100 * (signal.power_before ?? 0)).toFixed(1)}% → ${(100 * (signal.power_after ?? 0)).toFixed(1)}%`,
    action: 'Review the expected generation shortfall.',
  } : {
    title: `Output rises ${change} points in 3h`,
    detail: `${(100 * (signal.power_before ?? 0)).toFixed(1)}% → ${(100 * (signal.power_after ?? 0)).toFixed(1)}%`,
    action: 'Review the expected injection increase.',
  };
}

export function OperationsPanel({ document, onHour }: { document: ForecastDocument; onHour: (hour: number) => void }) {
  const { operations, revision, metadata, events } = document;
  return <section className="operations-page" aria-labelledby="operations-heading">
    <div className="operations-head"><div><span className="eyebrow">Dispatch briefing · UTC+5</span><h1 id="operations-heading">Forecast intelligence</h1><p>Signals calculated from the two turbine forecasts. Review them before using this forecast in an operating plan.</p></div><span className="operations-mode">{metadata.mode === 'historical' ? 'Historical replay' : 'Live forecast'}</span></div>
    <div className="operations-metrics" aria-label="Station forecast summary">
      <div><small>Mean output · first 24h</small><strong>{(operations.mean_24h * 100).toFixed(1)}%</strong><span>normalized, two-turbine mean</span></div>
      <div><small>Mean output · 48h</small><strong>{(operations.mean_48h * 100).toFixed(1)}%</strong><span>normalized, two-turbine mean</span></div>
      <div><small>Peak forecast</small><strong>{(operations.peak_power * 100).toFixed(1)}%</strong><span>{localTime(operations.peak_time_utc)} · UTC+5</span></div>
    </div>
    <div className="operations-grid">
      <section className="operations-card" aria-labelledby="signals-heading"><div className="operations-card-head"><div><span className="eyebrow">Action windows</span><h2 id="signals-heading">What needs attention</h2></div><span className="operations-count">{operations.signals.length} signals</span></div>
        {operations.signals.length ? <div className="operations-signals">{operations.signals.map((signal, index) => { const item = describe(signal); return <button className={`operations-signal signal-${signal.kind}`} key={`${signal.kind}-${signal.start_lead_hour}-${index}`} onClick={() => onHour(signal.start_lead_hour - 1)} aria-label={`${item.title}, open hour ${signal.start_lead_hour}`}>
          <span className="signal-dot" /><span className="signal-content"><strong>{item.title}</strong><small>{localTime(signal.start_utc)} – {localTime(signal.end_utc)}</small><span>{item.detail} · {item.action}</span></span><span className="signal-link">View hour →</span>
        </button>; })}</div> : <p className="operations-empty">No 3-hour ramp of at least 25 percentage points and no low-output stretch of at least 3 hours.</p>}
        <p className="operations-rule">Screening thresholds: ±{(operations.thresholds.ramp_delta * 100).toFixed(0)} points over {operations.thresholds.ramp_window_hours}h; output ≤{(operations.thresholds.low_output_at_or_below * 100).toFixed(0)}% for ≥{operations.thresholds.low_output_min_hours}h. These are review triggers, not calibrated safety limits.</p>
      </section>
      <div className="operations-side"><section className="operations-card" aria-labelledby="revision-heading"><span className="eyebrow">Forecast revision</span><h2 id="revision-heading">What changed</h2>
        {revision ? <><strong className="revision-value">{(revision.mean_absolute_change * 100).toFixed(1)} points</strong><p>Mean absolute change across {revision.overlap_hours} shared forecast hours.</p><p>Largest change: {revision.largest_change >= 0 ? '+' : ''}{(revision.largest_change * 100).toFixed(1)} points at {localTime(revision.largest_change_time_utc)}.</p><div className="revision-tags"><span>Weather input hash {revision.weather_changed ? 'changed' : 'unchanged'}</span><span>Model {revision.model_changed ? 'changed' : 'unchanged'}</span></div><small>Compared with run {revision.previous_run_id}</small></> : <p>No earlier comparable {metadata.mode === 'historical' ? 'issue' : 'retrieval'} with overlapping hours is saved yet.</p>}
      </section><section className="operations-card" aria-labelledby="audit-heading"><span className="eyebrow">Agent audit trail</span><h2 id="audit-heading">Verified cycle</h2><ol className="operations-steps">{events.map((event, index) => <li key={`${event.step}-${index}`}><span className={event.status === 'SUCCESS' ? 'step-ok' : 'step-fail'} />{event.step.replaceAll('_', ' ')}</li>)}</ol><div className="operations-provenance">Forecast origin: {localTime(metadata.issue_time_utc)} UTC+5<br />Weather: {metadata.run_time_utc ? `ECMWF run ${metadata.run_time_utc}` : `retrieved ${metadata.retrieved_at_utc}`}<br />Source: {metadata.weather_source}<br />Model: {metadata.model_version}<br />Run: {metadata.run_id}{metadata.availability_rule && <><br />Availability: {metadata.availability_rule}</>}</div></section></div>
    </div>
    <p className="operations-limits">Power is normalized (0–100% of the supplied target), not MW or MWh. These signals describe model forecasts, not measured production or guaranteed grid conditions. {metadata.mode === 'historical' && 'February 2026 actual production is not provided, so realized forecast error cannot be shown.'}</p>
  </section>;
}
