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
  /** Flown/plotted distance, including an optional route-shaping bend. */
  distanceNm: number;
  /** Direct waypoint-to-waypoint distance, independent of route shaping. */
  directDistanceNm: number;
  /** Direct waypoint-to-waypoint true track used by the OFP/navigation calculations. */
  trueTrackDeg: number;
  /** Plotted/flown path. The first/last points are always from/to. */
  path: Coordinate[];
}
