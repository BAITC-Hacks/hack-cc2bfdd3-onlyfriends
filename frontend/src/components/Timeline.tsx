import { hourLabel, summarize, type ForecastHour } from '../forecast/forecast';
import { Icon } from './Icon';

interface Props {
  hours: ForecastHour[]; hour: number; horizon: 24 | 48; playing: boolean;
  onHour: (hour: number) => void; onHorizon: (horizon: 24 | 48) => void; onPlay: () => void;
}
export function Timeline({ hours, hour, horizon, playing, onHour, onHorizon, onPlay }: Props) {
  const visible = hours.slice(0, horizon);
  return <section className="timeline" aria-label="Forecast timeline">
    <div className="timeline-top"><div className="timeline-title"><span className="eyebrow">Hourly forecast</span><span className="muted">Mean normalized power across two turbines</span></div><div className="horizon-toggle" aria-label="Forecast horizon">{([24, 48] as const).map(value => <button key={value} onClick={() => onHorizon(value)} aria-pressed={horizon === value}>{value} hours</button>)}</div></div>
    <div className="timeline-content"><button className="play-button" onClick={onPlay} aria-label={playing ? 'Pause forecast playback' : 'Play forecast'}><Icon name={playing ? 'pause' : 'play'} size={17} /></button><div className="timeline-track"><div className="chart-bars" aria-hidden="true">{visible.map((item, index) => <div key={item.at} className={index === hour ? 'bar selected' : index < hour ? 'bar past' : 'bar'} style={{ height: `${14 + summarize(item).power * 38}px` }} />)}</div><input aria-label="Forecast hour" type="range" min={0} max={horizon - 1} value={hour} onChange={event => onHour(Number(event.target.value))} aria-valuetext={hourLabel(hours[hour].at, true)} /><div className="timeline-labels"><span>{hourLabel(visible[0].at)}</span><span>{hourLabel(visible[Math.floor(horizon / 3)].at)}</span><span>{hourLabel(visible[Math.floor(horizon * 2 / 3)].at)}</span><span>{hourLabel(visible[horizon - 1].at)}</span></div></div><div className="selected-time"><span>Selected hour</span><strong>{hourLabel(hours[hour].at)}</strong><small>{hourLabel(hours[hour].at, true).split(' · ')[0]}</small></div></div>
  </section>;
}
