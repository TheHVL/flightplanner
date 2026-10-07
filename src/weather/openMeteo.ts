export const PRESSURE_LEVELS_HPA = [1000, 925, 850, 700, 600, 500, 400, 300] as const;
export const FORECAST_BATCH_SIZE = 50;
type HourlyForecast = Record<string, Array<string | number | null>>;

export interface ForecastMetadata {
  fetchedAtUtc?: string;
  modelSelection?: 'best_match';
  modelName?: string | null;
  modelRunTimeUtc?: string | null;
}

export interface ForecastSeries extends ForecastMetadata {
  hourly: HourlyForecast;
}

export interface ForecastSample extends ForecastMetadata {
  windFromDeg: number;
  windSpeedKt: number;
  temperatureC: number;
  validTimeUtc: string;
  altitudeFt: number;
  altitudeClamped: boolean;
  sampledAltitudeFt?: number;
  source: string;
}

interface OpenMeteoResponse {
  hourly?: Record<string, Array<string | number | null>>;
}

interface VectorSample {
  sampledAltitudeM: number;
  uKt: number;
  vKt: number;
  temperatureC: number;
  altitudeClamped: boolean;
}

export async function fetchForecastSample(
  lat: number,
  lon: number,
  altitudeFt: number,
  when: Date,
): Promise<ForecastSample> {
  const [series] = await fetchForecastBatch([{ lat, lon }], when);
  return sampleForecastSeries(series, altitudeFt, when);
}

/** Fetch raw series once, then sample legs locally in wind-adjusted flight order. */
export async function fetchForecastBatch(
  locations: ReadonlyArray<{ lat: number; lon: number }>,
  departure: Date,
  signal?: AbortSignal,
): Promise<ForecastSeries[]> {
  const series: ForecastSeries[] = [];
  for (let offset = 0; offset < locations.length; offset += FORECAST_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = locations.slice(offset, offset + FORECAST_BATCH_SIZE);
    const timeout = AbortSignal.timeout(45_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(buildForecastUrl(batch, departure), { cache: 'no-store', signal: requestSignal });
    if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const results = Array.isArray(payload) ? payload : [payload];
    if (results.length !== batch.length) {
      throw new Error('Weather service returned an unexpected number of route locations. Fetch fresh winds again.');
    }
    const fetchedAtUtc = new Date().toISOString();
    for (const result of results) {
      const hourly = (result as OpenMeteoResponse | null)?.hourly;
      if (!hourly || !Array.isArray(hourly.time)) {
        throw new Error('Weather service returned no hourly forecast data.');
      }
      series.push({ hourly, fetchedAtUtc, modelSelection: 'best_match', modelName: null, modelRunTimeUtc: null });
    }
  }
  return series;
}

export function sampleForecastSeries(series: ForecastSeries, altitudeFt: number, when: Date): ForecastSample {
  const { hourly, ...metadata } = series;
  return { ...sampleHourlyForecast(hourly, altitudeFt, when), ...metadata };
}

export function sampleHourlyForecast(
  hourly: Record<string, Array<string | number | null>>,
  altitudeFt: number,
  when: Date,
): ForecastSample {
  const rawTimes = hourly.time;
  if (!rawTimes || rawTimes.length === 0) {
    throw new Error('Weather forecast contains no valid times.');
  }

  const timesMs = rawTimes.map((value) => {
    if (typeof value !== 'string') return Number.NaN;
    return Date.parse(value.endsWith('Z') ? value : `${value}Z`);
  });
  if (timesMs.some((value) => !Number.isFinite(value))) {
    throw new Error('Weather forecast contains an invalid timestamp.');
  }

  const targetMs = when.getTime();
  if (targetMs < timesMs[0] || targetMs > timesMs[timesMs.length - 1]) {
    throw new Error('Selected departure time is outside the available weather forecast period.');
  }

  const [lowerIndex, upperIndex, timeFraction] = timeBracket(timesMs, targetMs);
  const lower = verticalSample(hourly, lowerIndex, altitudeFt);
  const upper = verticalSample(hourly, upperIndex, altitudeFt);
  const uKt = lerp(lower.uKt, upper.uKt, timeFraction);
  const vKt = lerp(lower.vKt, upper.vKt, timeFraction);
  const windSpeedKt = Math.hypot(uKt, vKt);
  const windFromDeg = normalizeDegrees(toDegrees(Math.atan2(-uKt, -vKt)));

  return {
    windFromDeg,
    windSpeedKt,
    temperatureC: lerp(lower.temperatureC, upper.temperatureC, timeFraction),
    validTimeUtc: when.toISOString(),
    altitudeFt: Math.round(altitudeFt),
    altitudeClamped: lower.altitudeClamped || upper.altitudeClamped,
    sampledAltitudeFt: lerp(lower.sampledAltitudeM, upper.sampledAltitudeM, timeFraction) / 0.3048,
    source: 'Open-Meteo pressure-level forecast',
  };
}

function buildForecastUrl(locations: ReadonlyArray<{ lat: number; lon: number }>, when: Date): string {
  const variables = PRESSURE_LEVELS_HPA.flatMap((level) => [
    `temperature_${level}hPa`,
    `wind_speed_${level}hPa`,
    `wind_direction_${level}hPa`,
    `geopotential_height_${level}hPa`,
  ]);
  const startDate = utcDate(when);
  const nextDay = new Date(when.getTime() + 24 * 60 * 60 * 1000);
  const endDate = utcDate(nextDay);
  const params = new URLSearchParams({
    latitude: locations.map(({ lat }) => lat.toFixed(5)).join(','),
    longitude: locations.map(({ lon }) => lon.toFixed(5)).join(','),
    hourly: variables.join(','),
    wind_speed_unit: 'kn',
    timezone: 'GMT',
    cell_selection: 'nearest',
    models: 'best_match',
    start_date: startDate,
    end_date: endDate,
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function verticalSample(
  hourly: Record<string, Array<string | number | null>>,
  timeIndex: number,
  altitudeFt: number,
): VectorSample {
  const targetMeters = altitudeFt * 0.3048;
  const levels = PRESSURE_LEVELS_HPA.map((level) => {
    const altitudeM = numericValue(hourly[`geopotential_height_${level}hPa`], timeIndex);
    const temperatureC = numericValue(hourly[`temperature_${level}hPa`], timeIndex);
    const speedKt = numericValue(hourly[`wind_speed_${level}hPa`], timeIndex);
    const directionDeg = numericValue(hourly[`wind_direction_${level}hPa`], timeIndex);
    const vector = windVector(speedKt, directionDeg);
    return { altitudeM, temperatureC, ...vector };
  }).sort((a, b) => a.altitudeM - b.altitudeM);

  if (targetMeters < levels[0].altitudeM) {
    return { ...levels[0], sampledAltitudeM: levels[0].altitudeM, altitudeClamped: true };
  }
  const highest = levels[levels.length - 1];
  if (targetMeters > highest.altitudeM) {
    return { ...highest, sampledAltitudeM: highest.altitudeM, altitudeClamped: true };
  }

  for (let index = 0; index < levels.length - 1; index += 1) {
    const lower = levels[index];
    const upper = levels[index + 1];
    if (targetMeters < lower.altitudeM || targetMeters > upper.altitudeM) continue;
    const fraction = (targetMeters - lower.altitudeM) / (upper.altitudeM - lower.altitudeM);
    return {
      uKt: lerp(lower.uKt, upper.uKt, fraction),
      vKt: lerp(lower.vKt, upper.vKt, fraction),
      temperatureC: lerp(lower.temperatureC, upper.temperatureC, fraction),
      altitudeClamped: false,
      sampledAltitudeM: targetMeters,
    };
  }

  throw new Error('Could not interpolate weather at the planned altitude.');
}

function numericValue(values: Array<string | number | null> | undefined, index: number): number {
  const value = values?.[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Weather forecast is missing pressure-level data for this route leg.');
  }
  return value;
}

function windVector(speedKt: number, fromDeg: number): { uKt: number; vKt: number } {
  const radians = toRadians(fromDeg);
  return {
    uKt: -speedKt * Math.sin(radians),
    vKt: -speedKt * Math.cos(radians),
  };
}

function timeBracket(timesMs: number[], targetMs: number): [number, number, number] {
  for (let index = 0; index < timesMs.length - 1; index += 1) {
    const lower = timesMs[index];
    const upper = timesMs[index + 1];
    if (targetMs < lower || targetMs > upper) continue;
    return [index, index + 1, upper === lower ? 0 : (targetMs - lower) / (upper - lower)];
  }
  const last = timesMs.length - 1;
  return [last, last, 0];
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lerp(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
