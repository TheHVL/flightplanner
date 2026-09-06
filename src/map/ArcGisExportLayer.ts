import L, { type Coords, GridLayer } from 'leaflet';

export interface ArcGisExportLayerOptions extends L.GridLayerOptions {
  exportUrl: string;
  visibleLayerIds?: number[];
}

export class ArcGisExportLayer extends GridLayer {
  private readonly exportUrl: string;
  private readonly visibleLayerIds: number[];

  constructor(options: ArcGisExportLayerOptions) {
    super(options);
    this.exportUrl = options.exportUrl.replace(/\/$/, '');
    this.visibleLayerIds = options.visibleLayerIds ?? [];
  }

  createTile(coords: Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    tile.width = 256;
    tile.height = 256;

    const tileSize = this.getTileSize();
    const northwestPoint = coords.scaleBy(tileSize);
    const southeastPoint = northwestPoint.add(tileSize);
    const northwest = this._map.unproject(northwestPoint, coords.z);
    const southeast = this._map.unproject(southeastPoint, coords.z);
    const projectedNorthwest = L.CRS.EPSG3857.project(northwest);
    const projectedSoutheast = L.CRS.EPSG3857.project(southeast);

    const params = new URLSearchParams({
      bbox: `${projectedNorthwest.x},${projectedSoutheast.y},${projectedSoutheast.x},${projectedNorthwest.y}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${tileSize.x},${tileSize.y}`,
      format: 'png32',
      transparent: 'true',
      dpi: '96',
      f: 'image',
    });

    if (this.visibleLayerIds.length > 0) {
      params.set('layers', `show:${this.visibleLayerIds.join(',')}`);
    }

    tile.onload = () => done(undefined, tile);
    tile.onerror = () => done(new Error('Failed to load ArcGIS aeronautical chart tile.'), tile);
    tile.src = `${this.exportUrl}/export?${params.toString()}`;
    return tile;
  }
}
