import { describe, expect, it } from 'vitest';
import archived from '../data/february2026.json';
import shap from '../data/february2026-shap.json';

describe('exported February SHAP values', () => {
  it('covers every issue and reconciles each contribution sum with the saved forecast', () => {
    expect(shap.issues).toHaveLength(archived.issues.length);
    for (const issue of shap.issues) {
      const source = archived.issues.find(candidate => candidate.date === issue.date);
      expect(source).toBeDefined();
      expect(issue.hours).toHaveLength(48);
      for (let hour = 0; hour < issue.hours.length; hour++) {
        expect(issue.hours[hour].at).toBe(source!.hours[hour].at);
        for (let turbine = 0; turbine < 2; turbine++) {
          const reading = issue.hours[hour].readings[turbine];
          expect(reading.turbineId).toBe(source!.hours[hour].readings[turbine].turbineId);
          expect(reading.contributions).toHaveLength(shap.featureNames.length);
          expect(reading.baseValue + reading.contributions.reduce((sum, value) => sum + value, 0)).toBeCloseTo(reading.rawPrediction, 6);
          expect(Math.min(1, Math.max(0, reading.rawPrediction))).toBeCloseTo(source!.hours[hour].readings[turbine].power, 6);
        }
      }
    }
  });
});
