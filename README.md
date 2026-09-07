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
- Wind triangle with WCA, heading and groundspeed.
- Kartverket Norgeskart and Avinor Norway Aeronautical Chart ICAO 1:500 000 map layers.
- Optional visual MSA corridor extending 1 NM either side of the complete route, including waypoint end caps.
- Manual MSA entry for every OFP leg, with a warning when PL is below the entered MSA.
- Optional C182T zero-wind maximum-glide visualization based on POH Figure 3-1 and the Phase 6 modeled route altitude.
- UiT-style operational flight-plan navigation log with accumulated distance/time and editable planned level (PL) per leg.
- Complete C182T POH Figure 5-9 cruise-performance model from sea level through 14,000 ft, 2000-2400 RPM where published, ISA -20°C to ISA +20°C, with bounded interpolation and no extrapolation.
- Phase-aware fuel planning that separates cruise, climb, descent, circuit/pattern, and startup/taxi/takeoff fuel.
- Optional fuel-onboard entry and estimated fuel remaining in the OFP.
- Route weather preview using Open-Meteo pressure-level winds and temperature, interpolated by geopotential height and forecast time.
- Automatic TOC/TOD across route altitude changes, including intermediate airport / touch-and-go handling.
- Phase 7 AIP preview: aerodrome elevation lookup by ICAO code from an Avinor AIP-derived dataset.
- Circuit/pattern planning at intermediate airports, with configurable circuit count and minutes per circuit added to route time and, when Circuit FF is supplied, fuel.
- Resizable map workspace, scrollable planning sidebar and full-screen map mode.

When a route line with an existing PL is split by inserting a new waypoint, the old PL is carried onto both new legs so an editing operation does not silently discard the planned altitude. Weather forecasts for changed route geometry are invalidated and can then be refreshed.

Manual MSA values are deliberately treated more conservatively. If a route leg is changed by dragging a waypoint or by inserting/reordering/removing points, affected manual MSA values are cleared so an MSA checked for the old corridor is not silently reused for new geometry.

## C182T cruise performance

Phase 4 uses Cessna Model 182T NAV III GFC 700 AFCS Figure 5-9 `CRUISE PERFORMANCE`, supplied for this project. All 11 sheets have been transcribed and verified visually.

Published pressure-altitude tables loaded by the planner:

```text
Sea level
2,000 ft
4,000 ft
6,000 ft
8,000 ft
10,000 ft
12,000 ft
14,000 ft
```

The source conditions are:

```text
3100 lb
Recommended lean mixture
Cowl flaps CLOSED
```

The source note states that maximum cruise power is 80% MCP and settings above 80% MCP are listed only to aid interpolation. Flightplanner preserves those values for interpolation and displays a warning when the selected result is above 80% MCP.

The model interpolates only between published bracketing values for pressure altitude, RPM, temperature offset from ISA and manifold pressure. No extrapolation is allowed. Because the source tables become progressively smaller with altitude, not every RPM/MP combination exists at every altitude. For example, Figure 5-9 does not publish 2000 RPM at 14,000 ft. Unsupported combinations are rejected rather than invented.

For route fuel/navigation calculations, each leg now uses its PL as the Figure 5-9 pressure-altitude input, with the Phase 4 pressure-altitude field as a fallback when PL is blank. If route-weather temperature has been fetched for the leg, that OAT is used; otherwise the Phase 4 OAT field is used as the fallback.

**Current limitation:** PL is an altitude, not automatically pressure altitude. Until a QNH-based conversion is added, Flightplanner treats PL as a pressure-altitude proxy and labels that assumption in the fuel-planning UI.

## Phase-aware fuel planning

The fuel model combines the completed cruise model with the Phase 6 vertical profile.

For each route leg, the horizontal distance is split into modeled climb, cruise and descent portions. Circuit/pattern time at the leg's FROM waypoint is also included where configured.

Cruise fuel flow comes from Figure 5-9 when POH performance is enabled. If POH performance is disabled, a manual cruise fuel-flow field is available.

The supplied Figure 5-9 PDF does **not** provide climb, descent or circuit fuel-flow data. Flightplanner therefore does not invent those values. Climb FF, Descent FF and Circuit FF are manual inputs until a verified C182T source or UTSA planning standard is provided.

Fuel formulas:

```text
Phase fuel [gal] = fuel flow [gal/h] x phase time [min] / 60

Leg fuel = cruise fuel + climb fuel + descent fuel + circuit/activity fuel

Enroute fuel = sum of leg fuel

Trip fuel = startup/taxi/takeoff allowance + enroute fuel
```

The UiT OFP v4.2 supplied for this project states that Trip Fuel includes `1.7` US gal for startup, taxi and takeoff. Flightplanner therefore uses 1.7 gal as the editable default startup/taxi/takeoff allowance.

When Fuel onboard is entered, the OFP EST fuel-remaining column uses:

```text
Estimated remaining after leg n
= fuel onboard
- startup/taxi/takeoff allowance
- accumulated enroute fuel through leg n
```

If a required phase fuel flow is missing, INT/ACC fuel remains incomplete rather than substituting cruise fuel flow. Phase-aware OFP leg time still separates cruise from the existing Phase 6 climb/descent timing model.

Fuel-planning settings are currently stored in browser local storage. They are not yet part of the planner Ctrl+Z history or future save/load flight-plan format.

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

Climb/descent timing still uses the user-selected Phase 6 vertical rates and groundspeeds. A future improvement can replace those assumptions with verified C182T climb/descent performance data.

## MSA workflow

The current MSA implementation is intentionally pilot-driven rather than automatic.

The daytime-VFR rule supplied for this project is:

```text
MSA = highest terrain or obstacle within 1 NM of the route + 500 ft
```

When above water there is an additional project requirement to remain within gliding distance of land.

Use the `MSA ±1 NM` control above the map to display the inspection corridor. The overlay extends 1 NM to either side of every route leg and includes 1 NM end caps around the waypoints. Inspect the applicable chart/data inside that corridor, determine the MSA yourself, and enter it in the OFP MSA field for that leg.

If both MSA and PL are entered and `PL < MSA`, the MSA and PL cells are highlighted as a warning.

The website does **not** currently calculate a complete MSA from terrain and obstacle data. The detailed future implementation is documented in [docs/MSA_IMPLEMENTATION_PLAN.md](docs/MSA_IMPLEMENTATION_PLAN.md).

## C182T glide-to-land visualization

Use the `C182T glide` map control to display an approximate zero-wind maximum-glide reach around the route.

Source basis: Cessna Model 182T NAV III GFC 700 AFCS, Section 3, Figure 3-1 `MAXIMUM GLIDE`, supplied for this project. The figure states propeller windmilling, flaps up and zero wind, with best-glide speeds 76 KIAS at 3100 lb, 70 KIAS at 2600 lb and 58 KIAS at 2100 lb.

The plotted maximum-glide line is approximately linear from 0 ft / 0 NM to 14,000 ft / 20 NM. Flightplanner represents it as:

```text
approximate glide distance [NM]
= height above assumed landing surface [ft] / 700
```

The overlay uses the modeled Phase 6 route altitude. It assumes a sea-level shoreline, does not account for terrain or landing suitability, is not wind-aware, and is not extrapolated above 14,000 ft.

## Architecture

The project keeps route state, navigation mathematics, aircraft performance, fuel, weather, AIP data, map rendering and flight-plan presentation in separate modules.

```text
src/navigation/    Great-circle, wind, magnetic, MSA-corridor, glide-envelope and vertical-profile math
src/performance/   C182T cruise data, interpolation and maximum-glide source model
src/fuel/          Phase-aware route fuel planning and persisted fuel inputs
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
| 4 | Complete | Full C182T Figure 5-9 cruise database and bounded interpolation |
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
