declare module 'magvar' {
  export function magvar(
    latitude: number,
    longitude: number,
    altitudeKm?: number,
    when?: number | Date,
  ): number;
}
