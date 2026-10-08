/** Data (YYYY-MM-DD) em UTC. */
export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Primeiro dia (UTC, inclusivo) de uma janela de `days` dias terminando hoje. */
export function windowStart(days: number, now: Date = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return utcDateString(start);
}

/** Lista todas as datas (UTC) da janela, em ordem crescente. */
export function windowDays(days: number, now: Date = new Date()): string[] {
  const first = new Date(`${windowStart(days, now)}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(first);
    day.setUTCDate(first.getUTCDate() + index);
    return utcDateString(day);
  });
}
