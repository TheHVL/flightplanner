import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchForecastBatch, FORECAST_BATCH_SIZE, PRESSURE_LEVELS_HPA, sampleForecastSeries } from '../src/weather/openMeteo';
import { forecastFreshness, FORECAST_REVIEW_AGE_MS } from '../src/weather/forecastFreshness';

const departure = new Date('2026-10-06T23:30:00Z');
const locations = Array.from({ length: 10 }, (_, index) => ({ lat: 69 + index / 100, lon: 19 + index / 100 }));
function response(speed = 20) {
  const hourly: Record<string, (string | number | null)[]> = { time: ['2026-10-06T23:00', '2026-10-07T00:00'] };
  const heights = [100, 800, 1500, 3000, 4200, 5600, 7200, 9200];
  PRESSURE_LEVELS_HPA.forEach((level, index) => {
    hourly[`geopotential_height_${level}hPa`] = [heights[index], heights[index]];
    hourly[`temperature_${level}hPa`] = [5, 7];
    hourly[`wind_speed_${level}hPa`] = [speed, speed];
    hourly[`wind_direction_${level}hPa`] = [270, 270];
  });
  return { hourly, generationtime_ms: 1.2 };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('batched route forecasts', () => {
  it('fetches ten coordinates in one call and preserves their order and honest provenance', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T20:00:00Z'));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(locations.map((_, i) => response(20 + i)))));
    vi.stubGlobal('fetch', fetch);
    const series = await fetchForecastBatch(locations, departure);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(10);
    expect(url.searchParams.get('longitude')!.split(',')).toHaveLength(10);
    expect(url.searchParams.get('models')).toBe('best_match');
    expect(url.searchParams.get('hourly')!.split(',')).toHaveLength(32);
    expect(url.searchParams.get('start_date')).toBe('2026-10-06');
    expect(url.searchParams.get('end_date')).toBe('2026-10-07');
    series.forEach((data, i) => {
      const sample = sampleForecastSeries(data, 3000, departure);
      expect(sample.windSpeedKt).toBeCloseTo(20 + i);
      expect(sample).toMatchObject({ fetchedAtUtc: '2026-10-06T20:00:00.000Z', modelSelection: 'best_match', modelName: null, modelRunTimeUtc: null });
    });
  });
  it('accepts the single-location object response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response()))));
    expect(await fetchForecastBatch(locations.slice(0, 1), departure)).toHaveLength(1);
  });
  it('bounds batches for large routes', async () => {
    const points = Array.from({ length: FORECAST_BATCH_SIZE + 1 }, () => locations[0]);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(points.slice(0, FORECAST_BATCH_SIZE).map(() => response()))))
      .mockResolvedValueOnce(new Response(JSON.stringify(response())));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchForecastBatch(points, departure)).toHaveLength(points.length);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects mismatched or incomplete responses instead of mixing legs', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(response())))
      .mockResolvedValueOnce(new Response(JSON.stringify([response(), {}])));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchForecastBatch(locations.slice(0, 2), departure)).rejects.toThrow('number of route locations');
    await expect(fetchForecastBatch(locations.slice(0, 2), departure)).rejects.toThrow('no hourly forecast');
  });
  it('rejects HTTP errors and expired time coverage, and honors cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', {status:429})); vi.stubGlobal('fetch', fetch);
    await expect(fetchForecastBatch(locations, departure)).rejects.toThrow('HTTP 429');
    const controller = new AbortController(); controller.abort();
    await expect(fetchForecastBatch(locations, departure, controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => sampleForecastSeries(response(), 3000, new Date('2026-10-08T00:00:00Z'))).toThrow('outside');
  });
});

it('warns at two hours or unknown retrieval age without treating fetch time as model age', () => {
  const now = Date.parse('2026-10-06T20:00:00Z');
  const metadata = { modelSelection: 'best_match' as const, fetchedAtUtc: new Date(now - FORECAST_REVIEW_AGE_MS + 1).toISOString() };
  expect(forecastFreshness([metadata], now).stale).toBe(false);
  expect(forecastFreshness([metadata], now + 1)).toMatchObject({stale:true});
  expect(forecastFreshness([{}], now).message).toContain('Retrieval age unknown');
  expect(forecastFreshness([{fetchedAtUtc:new Date(now+1).toISOString()}], now).stale).toBe(true);
  expect(forecastFreshness([metadata], now).message).toContain('Underlying model and model run time are not reported');
  expect(forecastFreshness([], now).message).toBe('');
});
