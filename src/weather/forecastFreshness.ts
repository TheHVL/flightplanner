import type { ForecastMetadata } from './openMeteo';

/** Review reminder chosen for this planner; not a model-age or validity limit. */
export const FORECAST_REVIEW_AGE_MS = 2 * 60 * 60 * 1000;

export function forecastFreshness(forecasts: readonly ForecastMetadata[], nowMs = Date.now()): { stale: boolean; message: string } {
  if (!forecasts.length) return { stale: false, message: '' };
  const fetchedTimes = forecasts.map(f => Date.parse(f.fetchedAtUtc ?? ''));
  const unknownAge = fetchedTimes.some(time => !Number.isFinite(time) || time > nowMs);
  const oldest = Math.min(...fetchedTimes);
  const ageMinutes = Math.floor((nowMs - oldest) / 60000);
  const stale = unknownAge || nowMs - oldest >= FORECAST_REVIEW_AGE_MS;
  const selection = forecasts.every(f => f.modelSelection === 'best_match')
    ? 'Open-Meteo Best Match (automatic model selection). Underlying model and model run time are not reported.'
    : 'Forecast model selection or model run time is unknown.';
  const age = unknownAge ? 'Retrieval age unknown.'
    : `Retrieved ${new Date(oldest).toISOString().slice(0, 16).replace('T', ' ')} UTC (${ageMinutes} min ago).`;
  const action = stale ? ' Refresh route forecast in Route weather before using these winds.' : '';
  return { stale, message: `${selection} ${age} Retrieval age is not model-run age.${action}` };
}
