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
- Optional C182T zero-wind maximum-glide visualization based on POH Figure 3-1 and the Phase 6 modeled route altitude.
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

## C182T glide-to-land visualization

Use the `C182T glide` map control to display an approximate zero-wind maximum-glide reach around the route.

Source basis: Cessna Model 182T NAV III GFC 700 AFCS, Section 3, Figure 3-1 `MAXIMUM GLIDE`, supplied for this project. The figure states:

- propeller windmilling;
- flaps up;
- zero wind;
- best-glide speed 76 KIAS at 3100 lb;
- best-glide speed 70 KIAS at 2600 lb;
- best-glide speed 58 KIAS at 2100 lb.

The plotted maximum-glide line is approximately linear from 0 ft / 0 NM to 14,000 ft / 20 NM. Flightplanner therefore represents the line as:

```text
approximate glide distance [NM]
= height above assumed landing surface [ft] / 700
```

Examples:

```text
2,800 ft -> 4.0 NM
4,500 ft -> 6.4 NM
7,000 ft -> 10.0 NM
14,000 ft -> 20.0 NM
```

The map overlay is designed specifically as a visual aid for the over-water part of the UTSA project rule. It uses the modeled Phase 6 route altitude, including climb and descent where a valid vertical profile exists, rather than blindly applying the full PL before TOC or after TOD.

Important limitations:

- the POH figure assumes zero wind;
- the displayed reach assumes the shoreline/landing surface is at sea level;
- the overlay does not account for terrain height between the aircraft and a possible landing area;
- it does not determine whether land is suitable for landing;
- it is not a wind-aware glide footprint;
- Figure 3-1 is not extrapolated above 14,000 ft;
- if Phase 6 climb/descent profiles overlap, the glide overlay is hidden rather than presenting an ambiguous result.

The shaded area should therefore be read as **theoretical maximum reach to a sea-level shoreline under the stated POH conditions**, not as a guaranteed safe landing area.

## Architecture

The project keeps route state, navigation mathematics, aircraft performance, weather, AIP data, map rendering and flight-plan presentation in separate modules. UI code should not own aviation calculations.

Key areas:

```text
src/navigation/    Great-circle, wind, magnetic, MSA-corridor, glide-envelope and vertical-profile math
src/performance/   C182T cruise data, interpolation and maximum-glide source model
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
| 7 | In progress | Norwegian AIP aerodrome elevation, circuit planning, route editing, manual MSA workflow, MSA corridor and C182T glide visualization |
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
