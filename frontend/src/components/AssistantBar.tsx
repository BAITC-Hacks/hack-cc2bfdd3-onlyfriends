import { useState, type FormEvent } from 'react';
import { answerQuestion, type ForecastHour } from '../forecast/forecast';
import { Icon } from './Icon';

export function AssistantBar({ hours }: { hours: ForecastHour[] }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  function ask(event: FormEvent) { event.preventDefault(); if (query.trim()) setAnswer(answerQuestion(query, hours)); }
  return <div className="assistant-wrap">
    {answer && <div className="assistant-answer" role="status"><Icon name="sparkles" /><div><span className="eyebrow">Forecast assistant · Demo</span><p>{answer}</p></div><button className="icon-button small" aria-label="Dismiss answer" onClick={() => setAnswer('')}><Icon name="close" size={16} /></button></div>}
    <form className="assistant-bar" onSubmit={ask}><span className="assistant-icon"><Icon name="sparkles" size={20} /></span><input aria-label="Ask the demo forecast assistant" placeholder="Ask your energy anything…" value={query} onChange={e => setQuery(e.target.value)} maxLength={300} /><span className="demo-label">AI demo</span><button type="submit" aria-label="Ask assistant" disabled={!query.trim()}><Icon name="arrow" size={19} /></button></form>
    <div className="suggestions"><span>Try asking</span>{['When is peak power?', 'Wind outlook'].map(q => <button key={q} onClick={() => { setQuery(q); setAnswer(answerQuestion(q, hours)); }}>{q}<Icon name="diagonal" size={12} /></button>)}</div>
  </div>;
}
