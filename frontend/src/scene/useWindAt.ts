import { useEffect, useRef, useState } from 'react';
import { turbines } from '../forecast/forecast';
import { fetchWindRun, type WindSample } from '../forecast/windApi';

type WindState = { key: string; samples?: WindSample[]; error?: string };
export type WindAt = { source: 'api' | 'loading' | 'archive'; speed: number; direction: number; error?: string };

/** Load one archived model run, then switch hours locally without repeated requests. */
export function useWindAt(runTime: string, at: string, archived: { speed: number; direction: number }, latitude = turbines[0].lat, longitude = turbines[0].lon, enabled = true): WindAt {
  const cache = useRef(new Map<string, WindSample[]>());
  const [state, setState] = useState<WindState | null>(null);
  const key = `${runTime}:${latitude}:${longitude}`;
  useEffect(() => {
    if (!enabled) return;
    const cached = cache.current.get(key);
    if (cached) { setState({ key, samples: cached }); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let active = true;
    fetchWindRun(runTime, latitude, longitude, controller.signal)
      .then(samples => { if (active) { cache.current.set(key, samples); setState({ key, samples }); } })
      .catch(error => { if (active) setState({ key, error: controller.signal.aborted ? 'Wind API timed out.' : error instanceof Error ? error.message : 'Wind API failed.' }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [key, runTime, latitude, longitude, enabled]);
  if (state?.key === key) {
    const sample = state.samples?.find(item => item.at === at);
    if (sample) return { source: 'api', speed: sample.speed, direction: sample.direction };
    if (state.error) return { source: 'archive', speed: archived.speed, direction: archived.direction, error: state.error };
    if (state.samples) return { source: 'archive', speed: archived.speed, direction: archived.direction, error: 'Hour missing from wind API run.' };
  }
  return { source: 'loading', speed: archived.speed, direction: archived.direction };
}
