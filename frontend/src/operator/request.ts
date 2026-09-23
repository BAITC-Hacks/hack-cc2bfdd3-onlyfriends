export interface MaintenanceRequest { turbineId: string; duration: number; tomorrow: boolean }

const durationWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  один: 1, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8 };

/** Parse the supported maintenance command shape; return null for unrelated questions. */
export function parseMaintenanceRequest(text: string): MaintenanceRequest | null {
  const query = text.toLowerCase();
  if (!/(?:\bstop\b|\bservice\b|\bmaintenance\b|останов|обслуж|ремонт)/.test(query)) return null;
  const turbine = query.match(/(?:turbine|турбин[а-я]*)\s*([0-9]+)\b/);
  const duration = query.match(/\b([0-9]+|one|two|three|four|five|six|seven|eight|один|два|три|четыре|пять|шесть|семь|восемь)\s*(?:hours?|hrs?|час(?:а|ов)?|ч\b)/);
  if (!turbine || !duration || !['1', '2'].includes(turbine[1])) return null;
  const count = Number(duration[1]) || durationWords[duration[1]];
  if (!Number.isInteger(count) || count < 1 || count > 8) return null;
  return { turbineId: turbine[1], duration: count, tomorrow: /\btomorrow\b|завтра/.test(query) };
}
