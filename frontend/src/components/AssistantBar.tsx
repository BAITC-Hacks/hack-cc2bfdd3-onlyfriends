import { useState, type FormEvent } from 'react';
import { askForecast } from '../forecast/forecast';
import { Icon } from './Icon';

interface AssistantBarProps {
  runId: string;
  selectedLeadHour: number;
  selectedTurbineId: string | null;
  horizon: 24 | 48;
  selectedAt: string;
}

export function AssistantBar({ runId, selectedLeadHour, selectedTurbineId, horizon, selectedAt }: AssistantBarProps) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer('');
    try {
      setAnswer(await askForecast({ run_id: runId, question: question.trim(), selected_lead_hour: selectedLeadHour,
        selected_turbine_id: selectedTurbineId, horizon }));
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'Не удалось получить ответ.');
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(query); }
  const localDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long' }).format(new Date(selectedAt));
  return <div className="assistant-wrap">
    {(answer || loading) && <div className="assistant-answer" role="status"><Icon name="sparkles" /><div><span className="eyebrow">Прогноз · {localDate}</span><p>{loading ? 'Анализирую прогноз…' : answer}</p></div><button className="icon-button small" aria-label="Dismiss answer" onClick={() => setAnswer('')}><Icon name="close" size={16} /></button></div>}
    <form className="assistant-bar" onSubmit={submit}><span className="assistant-icon"><Icon name="sparkles" size={20} /></span><input aria-label="Ask forecast assistant" placeholder={`Спросите о прогнозе на ${localDate}…`} value={query} onChange={event => setQuery(event.target.value)} maxLength={500} /><span className="demo-label">AI · {localDate}</span><button type="submit" aria-label="Ask assistant" disabled={!query.trim() || loading}><Icon name="arrow" size={19} /></button></form>
    <div className="suggestions"><span>Например</span>{['Почему сегодня сильный ветер?', 'Когда пик мощности?', 'Что изменилось в прогнозе?'].map(question => <button key={question} disabled={loading} onClick={() => { setQuery(question); void ask(question); }}>{question}<Icon name="diagonal" size={12} /></button>)}</div>
  </div>;
}
