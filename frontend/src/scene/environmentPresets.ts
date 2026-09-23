import type { Season, TimeOfDay } from '../forecast/environment';

export const seasonPalette: Record<Season, { terrain: string; foliage: string[]; sky: string; sun: string; snow: number }> = {
  winter: { terrain: '#9baea7', foliage: ['#aabbb5', '#d4dedb', '#7f928d'], sky: '#dce6ed', sun: '#e4eeff', snow: 0.9 },
  spring: { terrain: '#9ac780', foliage: ['#68a757', '#8bbf65', '#4e9251'], sky: '#edf2eb', sun: '#fff1d9', snow: 0 },
  summer: { terrain: '#69a453', foliage: ['#367d43', '#4b914b', '#27663a'], sky: '#f1f2e9', sun: '#fff0cb', snow: 0 },
  autumn: { terrain: '#919c6c', foliage: ['#bd773c', '#d2a64d', '#92603f'], sky: '#eeeae3', sun: '#ffe1bd', snow: 0 },
};
export const timePalette: Record<TimeOfDay, { sky: string; sun: string; fill: string; ambient: number; key: number }> = {
  night: { sky: '#111c2d', sun: '#a4c3ee', fill: '#7494ca', ambient: 0.65, key: 1.15 },
  sunrise: { sky: '#d8d7df', sun: '#ffd0a1', fill: '#b4c5e5', ambient: 1.0, key: 2.0 },
  day: { sky: '#f2f4ef', sun: '#fff7e7', fill: '#edf4ff', ambient: 1.45, key: 2.8 },
  sunset: { sky: '#514c64', sun: '#ffb499', fill: '#a0accd', ambient: 0.85, key: 2.15 },
};
