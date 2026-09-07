# Flightplanner

Browser-based VFR flight planning for Norwegian flight training, with the Cessna 182T as the primary aircraft use case.

**Live planner:** https://thehvl.github.io/flightplanner/

> Training and planning aid only. It is not certified flight-planning software and does not replace the aircraft POH/AFM, NOTAM, official AIP, approved weather briefing, mass-and-balance checks, operational procedures, or pilot judgement.

## Current capabilities

- Click the map to append a waypoint, drag route lines to insert waypoints between existing points, and drag markers to move them.
- Reorder, rename and delete route waypoints.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS undo the latest planner-state action, with up to 50 stored undo steps.
- Great-circle leg distance and initial true track.
- Automatic WMM2025 magnetic variation per leg, with manual override.
- Wind triangle with WCA, heading, groundspeed and leg time.
- Kartverket Norgeskart and Avinor Norway Aeronautical Chart ICAO 1:500 000 map layers.
- Optional visual MSA corridor extending 1 NM either side of the complete route, including waypoint end caps.
- Manual MSA entry for every OFP leg, with a warning when PL is below the entered MSA.
- UiT-style operational flight-plan navigation log with accumulated distance/time and editable planned level (PL) per leg.
- C182T POH cruise-performance preview with bounded interpolation and no extrapolation. Current mainline data coverage is sea level through 2,000 ft, 2200-2400 RPM, ISA -20°C to ISA +20°C.
- Route weather preview using Open-Meteo pressure-level winds and temperature, interpolated by geopotential height and forecast time.
- Automatic TOC/TOD across route altitude changes, including intermediate airport / touch-and-go handling.
- Phase 7 AIP preview: aerodrome elevation lookup by ICAO code from an Avinor AIP-derived dataset.
- Circuit/pattern planning at intermediate airports, with configurable circuit count and minutes per circuit added to OFP accumulated time.
- Resizable map workspace, scrollable planning sidebar and full-screen map mode.

When a route line with an existing PL is split by inserting a new waypoint, the old PL is carried onto both new legs so an editing operation does not silently discard the planned altitude. Weather forecasts for changed route geometry are invalidated and can then be refreshed.

Manual MSA values are deliberately treated more conservatively. If a route leg is changed by dragging a waypoint or by inserting/reordering/removing points, affected manual MSA values are cleared so an MSA checked for the old corridor is not silently reused for new geometry.

## AIP aerodrome data

The planner does not require a private AIP API key. `public/aip-aerodromes.json` is a static dataset derived from Avinor's public AIP Norway AD 2 pages. The GitHub Pages build attempts to refresh it from the current Avinor eAIP before deployment and a scheduled Pages build runs weekly. If Avinor cannot be reached or the parser cannot verify enough aerodromes, the committed fallback dataset is retained.

Manual refresh:

```bash
npm run aip:update
```

The elevation shown in the planner always remains editable. AIP-derived values are a convenience for planning and should be checked against the current published AIP for operational use.

## Vertical-profile rules

Each leg has a planned level in the OFP. At an ordinary waypoint:

- If outbound PL is higher than inbound PL, climb begins after that waypoint and TOC is calculated on the outbound leg.
- If outbound PL is lower than inbound PL, TOD is placed on the outbound leg and is **never allowed before the waypoint where the lower PL begins**.
- If the required climb/descent cannot fit before the next waypoint, the planner warns rather than silently moving the transition to the wrong side of the waypoint.
- Airport/T&G mode descends to field elevation before the airport and climbs again after it.
- Airport + circuits uses the same vertical logic and adds a user-selected time allowance for pattern work.

Circuit time currently affects **accumulated OFP time only**. Circuit fuel is deliberately not estimated yet because applying cruise fuel flow to circuit operations would be misleading.

## MSA workflow

The current MSA implementation is intentionally pilot-driven rather than automatic.

The daytime-VFR rule supplied for this project is:

```text
MSA = highest terrain or obstacle within 1 NM of the route + 500 ft
```

When above water there is an additional project requirement to remain within gliding distance of land.

Use the `MSA ±1 NM` control above the map to display the inspection corridor. The overlay extends 1 NM to either side of every route leg and includes 1 NM end caps around the waypoints. Inspect the applicable chart/data inside that corridor, determine the MSA yourself, and enter it in the OFP MSA field for that leg.

If both MSA and PL are entered and:

```text
PL < MSA
```

the MSA and PL cells are highlighted as a warning.

The website does **not** currently calculate a complete MSA from terrain and obstacle data. This avoids presenting a terrain-only calculation as complete while unrestricted automatic NRL obstacle data is unavailable. The detailed future implementation is documented in [docs/MSA_IMPLEMENTATION_PLAN.md](docs/MSA_IMPLEMENTATION_PLAN.md).

The next planned MSA extension is a C182T still-air glide-to-land visualization based on verified POH maximum-glide data, followed later by optional terrain assistance if the data path can be implemented without implying complete obstacle coverage.

## Architecture

The project keeps route state, navigation mathematics, aircraft performance, weather, AIP data, map rendering and flight-plan presentation in separate modules. UI code should not own aviation calculations.

Key areas:

```text
src/navigation/    Great-circle, wind, magnetic, MSA-corridor and vertical-profile math
src/performance/   C182T cruise data and interpolation
src/weather/       Route forecast sampling/interpolation
src/aip/           AIP aerodrome catalog lookup
src/map/           Leaflet map and ICAO chart quality logic
src/flightplan/    Route and planning state, including undo history and manual MSA
src/components/    UI panels and OFP presentation
docs/              Design/implementation proposals such as automatic MSA
scripts/           Build-time AIP data refresh
public/            Static deploy assets and fallback AIP dataset
```

## Delivery status

| Phase | Status | Scope |
| --- | --- | --- |
| 1 | Complete | Foundation, route editing, great-circle navigation, basic OFP |
| 2 | Complete | Wind triangle, headings, WMM2025 magnetic variation |
| 3 | Complete | Kartverket and Avinor ICAO map layers, quality/caching improvements |
| 4 | In progress | C182T POH cruise database and interpolation |
| 5 | Preview | Route weather and per-leg forecast wind integration |
| 6 | Advanced preview | Automatic multi-leg TOC/TOD, airports and touch-and-goes |
| 7 | In progress | Norwegian AIP aerodrome elevation, circuit planning, route editing, manual MSA workflow and MSA corridor |
| 8 | Planned | OFP polish, save/load/export/print and broader validation |

## Development

Requirements: Node.js 22 or compatible current Node release.

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run build
```

Refresh the AIP aerodrome dataset:

```bash
npm run aip:update
```

## Change history and formulas

See [CHANGELOG.md](CHANGELOG.md) for the update-by-update history, formulas, data assumptions, limitations and important implementation notes.

No private API keys belong in this repository.
