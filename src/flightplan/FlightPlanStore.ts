import type { Coordinate, RouteLeg, Waypoint } from '../types';
import { calculateRouteLegs } from '../navigation/geodesy';

type Listener = () => void;

export class FlightPlanStore {
  private waypoints: Waypoint[] = [];
  private listeners = new Set<Listener>();

  getWaypoints(): Waypoint[] {
    return this.waypoints.map((waypoint) => ({ ...waypoint }));
  }

  getLegs(): RouteLeg[] {
    return calculateRouteLegs(this.waypoints);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addWaypoint(coordinate: Coordinate, name?: string): Waypoint {
    const waypoint: Waypoint = {
      id: crypto.randomUUID(),
      name: name?.trim() || `WP${String(this.waypoints.length + 1).padStart(2, '0')}`,
      ...coordinate,
    };

    this.waypoints = [...this.waypoints, waypoint];
    this.emit();
    return { ...waypoint };
  }

  updateWaypoint(id: string, patch: Partial<Omit<Waypoint, 'id'>>): void {
    this.waypoints = this.waypoints.map((waypoint) =>
      waypoint.id === id ? { ...waypoint, ...patch } : waypoint,
    );
    this.emit();
  }

  removeWaypoint(id: string): void {
    this.waypoints = this.waypoints.filter((waypoint) => waypoint.id !== id);
    this.emit();
  }

  moveWaypoint(id: string, direction: -1 | 1): void {
    const index = this.waypoints.findIndex((waypoint) => waypoint.id === id);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= this.waypoints.length) {
      return;
    }

    const reordered = [...this.waypoints];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    this.waypoints = reordered;
    this.emit();
  }

  clear(): void {
    if (this.waypoints.length === 0) {
      return;
    }
    this.waypoints = [];
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
