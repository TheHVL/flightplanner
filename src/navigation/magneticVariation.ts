import { magvar } from 'magvar';
import type { RouteLeg } from '../types';

export interface MagneticVariationResult {
  variationDegEast: number;
  latitude: number;
  longitude: number;
}

export function routeLegMidpoint(leg: RouteLeg): { lat: number; lon: number } {
  const lat1 = toRad(leg.from.lat);
  const lon1 = toRad(leg.from.lon);
  const lat2 = toRad(leg.to.lat);
  const lon2 = toRad(leg.to.lon);
  const deltaLon = lon2 - lon1;

  const bx = Math.cos(lat2) * Math.cos(deltaLon);
  const by = Math.cos(lat2) * Math.sin(deltaLon);
  const lat3 = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2),
  );
  const lon3 = lon1 + Math.atan2(by, Math.cos(lat1) + bx);

  return {
    lat: toDeg(lat3),
    lon: normalizeLongitude(toDeg(lon3)),
  };
}

export function automaticVariationForLeg(
  leg: RouteLeg,
  when: Date | number = new Date(),
): MagneticVariationResult {
  const midpoint = routeLegMidpoint(leg);
  return {
    variationDegEast: magvar(midpoint.lat, midpoint.lon, 0, when),
    latitude: midpoint.lat,
    longitude: midpoint.lon,
  };
}

export function roundVariationDeg(value: number): number {
  return value < 0 ? -Math.round(Math.abs(value)) : Math.round(value);
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function toDeg(value: number): number {
  return (value * 180) / Math.PI;
}
