import { hourLabel, summarize, type ForecastHour } from '../forecast/forecast';
import { Icon } from './Icon';

interface Props {
  hours: ForecastHour[]; hour: number; horizon: 24 | 48; playing: boolean;
  onHour: (hour: number) => void; onHorizon: (horizon: 24 | 48) => void; onPlay: () => void;
}
export function Timeline({ hours, hour, horizon, playing, onHour, onHorizon, onPlay }: Props) {
  const visible = hours.slice(0, horizon);
  return <section className="timeline" aria-label="Forecast timeline">
    <button className="play-button" onClick={onPlay} aria-label={playing ? 'Pause forecast playback' : 'Play forecast'}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
    <div className="selected-time"><strong>{hourLabel(hours[hour].at)}</strong><small>{hourLabel(hours[hour].at, true).split(' · ')[0]} · UTC+5</small></div>
    <div className="timeline-track">
      <div className="chart-bars" aria-hidden="true">{visible.map((item, i) => <div key={item.at} className={i === hour ? 'bar selected' : i < hour ? 'bar past' : 'bar'} style={{ height: `${5 + summarize(item).power / 21.6 * 17}px` }} />)}</div>
      <input id="forecast-hour" aria-label="Forecast hour" type="range" min={0} max={horizon - 1} value={hour} onChange={e => onHour(Number(e.target.value))} aria-valuetext={hourLabel(hours[hour].at, true)} />
      <div className="timeline-labels"><span>{hourLabel(visible[0].at)}</span><span>+{horizon}h</span></div>
    </div>
    <div className="horizon-toggle" aria-label="Forecast horizon">{([24, 48] as const).map(h => <button key={h} onClick={() => onHorizon(h)} aria-label={`${h} hours`} aria-pressed={horizon === h}>{h}h</button>)}</div>
  </section>;
}
