import { Icon } from './Icon';

export interface DisplaySettings { weather: boolean; motion: boolean; suppliedModel: boolean }
export function Settings({ value, onChange, onClose }: { value: DisplaySettings; onChange: (value: DisplaySettings) => void; onClose: () => void }) {
  return <section className="settings-panel" aria-label="Display settings"><div className="panel-heading"><h2>Your little world</h2><button className="icon-button small" onClick={onClose} aria-label="Close settings"><Icon name="close" size={16} /></button></div>{([
    ['weather', 'Weather markers'], ['motion', 'Ambient motion'], ['suppliedModel', 'Use supplied GLB turbine'],
  ] as const).map(([key, label]) => <label className="setting-row" key={key}><span>{label}</span><input type="checkbox" checked={value[key]} onChange={e => onChange({ ...value, [key]: e.target.checked })} /></label>)}<p className="muted">The supplied model is a single static mesh. Switch it off for wind-driven blades.</p></section>;
}
