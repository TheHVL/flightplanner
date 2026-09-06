# Flightplanner

Browser-based VFR flight planning for Norwegian flight training, with Cessna 182T planning as the primary aircraft use case.

## Stack

- Vite
- TypeScript with strict checking
- Leaflet
- Vitest

## Development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run build
```

## Architecture

The project keeps navigation mathematics, route state, map rendering, aircraft performance, weather, AIP data, magnetic variation, and flight-plan presentation in separate modules. UI code does not own aviation calculations.

## Map sources

Kartverket/Norgeskart is configured from Kartverket's official public WMTS cache service. The Avinor ICAO 1:500 000 integration is architecturally supported but disabled by default until appropriate chart reuse rights are confirmed. See `docs/map-sources.md` and `.env.example`.

## Delivery phases

1. Foundation, map, route editing, great-circle distance/track, basic OFP table
2. Magnetic variation, wind triangle, manual wind, TAS/GS/WCA/headings
3. Kartverket and Norway ICAO 1:500 000 map layer architecture
4. C182T POH cruise database and interpolation
5. Weather API and iterative time/wind solution
6. TOC/TOD and vertical profile
7. Norwegian AIP integration
8. OFP polish, save/load/export/print and validation

No private API keys belong in this repository.
