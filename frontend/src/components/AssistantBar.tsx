import { useState, type FormEvent } from 'react';
import { answerQuestion, type ForecastHour } from '../forecast/forecast';
import { parseMaintenanceRequest, type MaintenanceRequest } from '../operator/request';
import { Icon } from './Icon';

export function AssistantBar({ hours, onMaintenanceRequest }: { hours: ForecastHour[]; onMaintenanceRequest?: (request: MaintenanceRequest) => void }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const answer = submitted ? answerQuestion(submitted, hours) : '';
  function ask(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    const maintenance = parseMaintenanceRequest(query);
    if (maintenance && onMaintenanceRequest) { setSubmitted(''); onMaintenanceRequest(maintenance); }
    else setSubmitted(query);
  }
  return <div className="assistant-wrap">
    {answer && <div className="assistant-answer" role="status"><div><span className="eyebrow">Forecast assistant · Demo</span><p>{answer}</p></div><button className="icon-button small" aria-label="Dismiss answer" onClick={() => setSubmitted('')}><Icon name="close" size={14} /></button></div>}
    <form className="assistant-bar" onSubmit={ask}><Icon name="sparkles" size={15} /><input aria-label="Ask the demo forecast assistant" placeholder="Ask your energy…" value={query} onChange={e => setQuery(e.target.value)} maxLength={300} /><button className="quick-question" type="button" aria-label="When is peak power?" title="When is peak power?" onClick={() => { setQuery('When is peak power?'); setSubmitted('When is peak power?'); }}><Icon name="power" size={13} /></button><span className="demo-label">Demo</span><button type="submit" aria-label="Ask assistant" disabled={!query.trim()}><Icon name="arrow" size={15} /></button></form>
  </div>;
}
