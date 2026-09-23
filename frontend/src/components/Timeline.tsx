import { forecast, hourLabel, summarize } from '../forecast/forecast';
import { Icon } from './Icon';

interface Props {
  hour: number; horizon: 24 | 48; playing: boolean;
  onHour: (hour: number) => void; onHorizon: (horizon: 24 | 48) => void; onPlay: () => void;
}
export function Timeline({ hour, horizon, playing, onHour, onHorizon, onPlay }: Props) {
  const visible = forecast.slice(0, horizon);
  return <section className="timeline" aria-label="Forecast timeline">
    <div className="timeline-top"><div className="timeline-title"><span className="eyebrow">Energy ahead</span><span className="muted">A little foresight. A lot of possibility.</span></div><div className="horizon-toggle" aria-label="Forecast horizon">{([24, 48] as const).map(h => <button key={h} onClick={() => onHorizon(h)} aria-pressed={horizon === h}>{h} hours</button>)}</div></div>
    <div className="timeline-content"><button className="play-button" onClick={onPlay} aria-label={playing ? 'Pause forecast playback' : 'Play forecast'}><Icon name={playing ? 'pause' : 'play'} size={17} /></button><div className="timeline-track"><div className="chart-bars" aria-hidden="true">{visible.map((item, i) => <div key={item.at} className={i === hour ? 'bar selected' : i < hour ? 'bar past' : 'bar'} style={{ height: `${14 + summarize(item).power / 21.6 * 38}px` }} />)}</div><input aria-label="Forecast hour" type="range" min={0} max={horizon - 1} value={hour} onChange={e => onHour(Number(e.target.value))} aria-valuetext={hourLabel(forecast[hour].at, true)} /><div className="timeline-labels"><span>{hourLabel(visible[0].at)}</span><span>{hourLabel(visible[Math.floor(horizon / 3)].at)}</span><span>{hourLabel(visible[Math.floor(horizon * 2 / 3)].at)}</span><span>{hourLabel(visible[horizon - 1].at)}</span></div></div><div className="selected-time"><span>Selected forecast</span><strong>{hourLabel(forecast[hour].at)}</strong><small>{hourLabel(forecast[hour].at, true).split(' · ')[0]}</small></div></div>
  </section>;
}
