export interface Coordinate {
  lat: number;
  lon: number;
}

export interface Waypoint extends Coordinate {
  id: string;
  name: string;
  altitudeFt?: number;
}

export interface RouteLeg {
  index: number;
  from: Waypoint;
  to: Waypoint;
  distanceNm: number;
  trueTrackDeg: number;
}
