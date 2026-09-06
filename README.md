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

The project keeps navigation mathematics, route state, map rendering, aircraft performance, weather, AIP data, magnetic variation, and flight-plan presentation in separate modules. UI code must not own aviation calculations.

## Delivery phases

1. Foundation, map, route editing, great-circle distance/track, basic OFP table
2. Magnetic variation, wind triangle, manual wind, TAS/GS/WCA/headings
3. Kartverket and Norway ICAO 1:500 000 map layers
4. C182T POH cruise database and interpolation
5. Weather API and iterative time/wind solution
6. TOC/TOD and vertical profile
7. Norwegian AIP integration
8. OFP polish, save/load/export/print and validation

No private API keys belong in this repository.
