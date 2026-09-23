import { describe, expect, it } from 'vitest';
import { parseMaintenanceRequest } from './request';

describe('maintenance request parser', () => {
  it('recognizes the demo request without treating other forecast questions as actions', () => {
    expect(parseMaintenanceRequest('Tomorrow I need to stop turbine 2 for four hours. Find the best window.'))
      .toEqual({ turbineId: '2', duration: 4, tomorrow: true });
    expect(parseMaintenanceRequest('Service turbine 1 for 6 hours')).toEqual({ turbineId: '1', duration: 6, tomorrow: false });
    expect(parseMaintenanceRequest('When is peak power?')).toBeNull();
  });

  it('rejects unsupported turbines and durations rather than silently guessing', () => {
    expect(parseMaintenanceRequest('Stop turbine 9 for four hours tomorrow')).toBeNull();
    expect(parseMaintenanceRequest('Stop turbine 2 for ninety hours tomorrow')).toBeNull();
  });
});
