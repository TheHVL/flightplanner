import { describe, expect, it } from 'vitest';
import { PRESSURE_LEVELS_HPA, sampleHourlyForecast } from '../src/weather/openMeteo';

describe('route weather interpolation', () => {
  it('interpolates wind and temperature in time at the planned altitude', () => {
    const hourly: Record<string, Array<string | number | null>> = {
      time: ['2026-09-06T20:00', '2026-09-06T21:00'],
    };

    const heights = [100, 800, 1500, 3000, 4200, 5600, 7200, 9200];
    PRESSURE_LEVELS_HPA.forEach((level, index) => {
      hourly[`geopotential_height_${level}hPa`] = [heights[index], heights[index]];
      hourly[`temperature_${level}hPa`] = [5, 7];
      hourly[`wind_speed_${level}hPa`] = [20, 30];
      hourly[`wind_direction_${level}hPa`] = [270, 270];
    });

    const sample = sampleHourlyForecast(
      hourly,
      1500 / 0.3048,
      new Date('2026-09-06T20:30:00Z'),
    );

    expect(sample.windFromDeg).toBeCloseTo(270, 6);
    expect(sample.windSpeedKt).toBeCloseTo(25, 6);
    expect(sample.temperatureC).toBeCloseTo(6, 6);
    expect(sample.altitudeClamped).toBe(false);
  });

  it('interpolates wind direction through north using vector components', () => {
    const hourly: Record<string, Array<string | number | null>> = {
      time: ['2026-09-06T20:00', '2026-09-06T21:00'],
    };

    const heights = [100, 800, 1500, 3000, 4200, 5600, 7200, 9200];
    PRESSURE_LEVELS_HPA.forEach((level, index) => {
      hourly[`geopotential_height_${level}hPa`] = [heights[index], heights[index]];
      hourly[`temperature_${level}hPa`] = [0, 0];
      hourly[`wind_speed_${level}hPa`] = [20, 20];
      hourly[`wind_direction_${level}hPa`] = [350, 10];
    });

    const sample = sampleHourlyForecast(
      hourly,
      3000,
      new Date('2026-09-06T20:30:00Z'),
    );

    expect(sample.windFromDeg < 1 || sample.windFromDeg > 359).toBe(true);
    expect(sample.windSpeedKt).toBeGreaterThan(19);
  });
});
