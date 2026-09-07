# Flightplanner

Browser-based VFR flight planning for Norwegian flight training, with the Cessna 182T as the primary aircraft use case.

**Live planner:** https://thehvl.github.io/flightplanner/

> Training and planning aid only. It is not certified or approved flight-planning software and does not replace the aircraft POH/AFM, NOTAM, official AIP, approved weather briefing, mass-and-balance checks, operational procedures, applicable regulations, or pilot judgement. The application requires an acknowledgement of this warning on every page load.

## Current capabilities

- Click the map to append a waypoint and drag markers to move them.
- Drag a route line between existing waypoints to shape the flown path without creating another OFP waypoint. The shaped path changes flown distance, time and fuel, while TT/MT/MH remain based on the direct waypoint-to-waypoint course.
- Reorder, rename and delete route waypoints.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS undo the latest planner-state action. An immediately preceding line-shape drag can also be undone.
- Great-circle direct leg distance and initial true track.
- Automatic WMM2025 magnetic variation per leg, with manual override.
- Wind triangle with WCA, heading and groundspeed.
- Kartverket Norgeskart and Avinor Norway Aeronautical Chart ICAO 1:500 000 map layers.
- Optional visual MSA corridor extending 1 NM either side of the plotted route, including shaped route sections.
- Manual MSA entry for every OFP leg, with a warning when PL is below the entered MSA.
- Optional C182T zero-wind maximum-glide visualization based on POH Figure 3-1 and the modeled route altitude. The overlay follows the plotted route path.
- UiT-style operational flight-plan navigation log with accumulated distance/time and editable planned level (PL) per leg.
- Complete C182T POH Figure 5-9 cruise-performance model from sea level through 14,000 ft, 2000-2400 RPM where published, ISA -20°C to ISA +20°C, with bounded interpolation and no extrapolation.
- C182T POH Figure 5-8 climb-performance model with selectable Normal Climb 90 KIAS and Maximum Rate of Climb profiles.
- Phase-aware fuel planning that separates cruise, climb, descent, circuit/pattern, and startup/taxi/takeoff fuel.
- Optional fuel-onboard entry and estimated fuel remaining in the OFP.
- Route weather preview using Open-Meteo pressure-level winds and temperature, interpolated by geopotential height and forecast time.
- Automatic TOC/TOD across route altitude changes, including intermediate airport / touch-and-go handling. TOC/TOD are displayed on the map as short lines perpendicular to the plotted route.
- Phase 7 AIP preview: aerodrome elevation lookup by ICAO code from an Avinor AIP-derived dataset.
- Circuit/pattern planning at intermediate airports, with configurable circuit count and minutes per circuit. The planner labels the standard circuit altitude as 1000 ft AGL.
- Collapsible planning sections in the sidebar, with each section remembering whether it was open or closed.
- Resizable map workspace, scrollable planning sidebar and full-screen map mode.

## Route shaping between waypoints

Dragging the blue route line is a route-shaping operation, not a waypoint-creation operation.

For a shaped leg A to B through a visual bend S:

```text
flown distance = distance(A,S) + distance(S,B)
```

The OFP navigation direction remains based on the direct A-to-B leg:

```text
TT = initial true track(A,B)
MT/MH = derived from the direct A-to-B track/heading model
```

The longer shaped distance is used for route distance, phase placement, time and fuel. The visual MSA corridor and glide overlay follow the shaped route. A shape point has no waypoint name and does not create another OFP row.

Changing the flown geometry invalidates route-weather samples and clears a manual MSA for the affected leg because those values were checked against the previous geometry.

Current limitation: a route leg supports one shaping bend at a time. The bend is a planning aid rather than a new navigation fix.

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

The default cruise controls are now **2200 RPM and 20 inHg manifold pressure**. They remain fully editable.

For route fuel/navigation calculations, each leg uses its PL as the Figure 5-9 pressure-altitude input, with the Phase 4 pressure-altitude field as a fallback when PL is blank. If route-weather temperature has been fetched for the leg, that OAT is used; otherwise the Phase 4 OAT field is used as the fallback.

**Current limitation:** PL is an altitude, not automatically pressure altitude. Until a QNH-based conversion is added, Flightplanner treats PL as a pressure-altitude proxy and labels that assumption in the fuel-planning UI.

## C182T climb performance

Climb planning uses Cessna Model 182T NAV III GFC 700 AFCS Figure 5-8 `TIME, FUEL AND DISTANCE TO CLIMB AT 3100 POUNDS`, supplied for this project.

Two published profiles are available in the Vertical Profile panel:

```text
Normal Climb - 90 KIAS
Published from sea level through 10,000 ft pressure altitude

Maximum Rate of Climb
Published from sea level through 14,000 ft pressure altitude
```

Source conditions for both sheets are:

```text
3100 lb
Flaps UP
2400 RPM
Full throttle
Mixture set to Maximum Power Fuel Flow placard
Cowl flaps OPEN
Standard temperature
```

The planner linearly interpolates the cumulative Figure 5-8 values between published pressure-altitude rows. For a climb that starts above sea level, climb time, fuel and zero-wind distance are calculated by subtracting the cumulative value at the starting altitude from the cumulative value at the target altitude.

```text
climb time = cumulative time(target PA) - cumulative time(start PA)
climb fuel = cumulative fuel(target PA) - cumulative fuel(start PA)
zero-wind climb distance = cumulative distance(target PA) - cumulative distance(start PA)
```

The Figure 5-8 note states:

```text
Increase time, fuel and distance by 10% for each 10°C above standard temperature.
Distances shown are based on zero wind.
```

Flightplanner therefore uses:

```text
ISA temperature [°C] = 15 - 2 x pressure altitude [thousand ft]
Temperature above ISA = max(0, OAT - ISA temperature)
Correction factor = 1 + Temperature above ISA / 100
Corrected time/fuel/distance = standard-table value x correction factor
```

For POH climb modes, average climb TAS is derived from the corrected Figure 5-8 zero-wind distance and time:

```text
average climb TAS = corrected zero-wind climb distance / climb time
```

Active wind is then applied to the climb TAS to determine actual TOC ground position. If a climb crosses several route legs, each leg's active wind and direct leg track are used for the time spent on that leg. Figure 5-8 climb time and fuel remain POH-derived.

No extrapolation is permitted. Selecting Normal Climb for a requested climb above 10,000 ft, or Maximum Rate above 14,000 ft, makes the affected climb/fuel calculation incomplete instead of inventing data.

## Phase-aware fuel planning

The fuel model combines Figure 5-9 cruise performance, Figure 5-8 climb performance, and the vertical profile.

For each route leg, the horizontal distance is split into modeled climb, cruise and descent portions. Circuit/pattern time at the leg's FROM waypoint is also included where configured.

Cruise fuel flow comes from Figure 5-9 when POH performance is enabled. If POH performance is disabled, a manual cruise fuel-flow field is available.

When either POH climb profile is selected, climb time and climb fuel come from Figure 5-8. The POH zero-wind distance is used to derive climb TAS, then active wind determines the ground distance occupied by the climb. Manual climb rate/TAS and climb FF remain available through Manual climb mode.

The supplied climb and cruise sources do **not** provide descent or circuit fuel-flow data. Flightplanner therefore does not invent those values. Descent FF and Circuit FF remain manual inputs until a verified C182T source or UTSA planning standard is provided.

Fuel formulas:

```text
POH climb fuel = corrected Figure 5-8 cumulative-fuel difference
Other phase fuel [gal] = fuel flow [gal/h] x phase time [min] / 60
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

If the vertical profile overlaps, or a required phase input is missing, complete trip fuel is withheld instead of presenting a misleading total. In particular, the warning `Vertical profiles overlap` means the selected climb/descent geometry occupies the same route section and must be resolved before complete climb/descent/trip fuel is shown.

## Airport / T&G and circuits

At an intermediate airport:

- `Airport / T&G` models descent to field elevation and the subsequent climb to outbound PL. It does not add a circuit-time allowance.
- `Airport + circuits` uses the same airport descent/climb logic and also adds the configured number of circuits and minutes per circuit. Circuit fuel is added only when Circuit FF is entered.
- The standard circuit altitude displayed by the planner is **1000 ft AGL**, or field elevation + 1000 ft when an aerodrome elevation is known.

Current limitation: circuits are still represented as an activity-time/fuel allowance at the aerodrome. The application does not yet draw or simulate a complete rectangular circuit at 1000 ft AGL.

## AIP aerodrome data

The planner does not require a private AIP API key. `public/aip-aerodromes.json` is a static dataset derived from Avinor's public AIP Norway AD 2 pages. The GitHub Pages build attempts to refresh it from the current Avinor eAIP before deployment and a scheduled Pages build runs weekly. If Avinor cannot be reached or the parser cannot verify enough aerodromes, the committed fallback dataset is retained.

Manual refresh:

```bash
npm run aip:update
```

The elevation shown in the planner always remains editable. AIP-derived values are a convenience for planning and should be checked against the current published AIP for operational use.

## Vertical-profile rules

Each leg has a planned level in the OFP. At an ordinary waypoint:

- If outbound PL is higher than inbound PL, climb begins after that waypoint and TOC is calculated on the outbound route.
- If outbound PL is lower than inbound PL, TOD is placed on the outbound leg and is never allowed before the waypoint where the lower outbound PL begins.
- If the required climb/descent cannot fit before the next waypoint, the planner warns rather than silently moving the transition to the wrong side of the waypoint.
- Airport/T&G mode descends to field elevation before the airport and climbs again after it.
- Airport + circuits uses the same vertical logic and adds a user-selected time allowance for pattern work.

TOC and TOD are drawn as short map lines perpendicular to the local plotted route rather than large circular markers.

## MSA workflow

The current MSA implementation is intentionally pilot-driven rather than automatic.

The daytime-VFR rule supplied for this project is:

```text
MSA = highest terrain or obstacle within 1 NM of the route + 500 ft
```

When above water there is an additional project requirement to remain within gliding distance of land.

Use the `MSA ±1 NM` control above the map to display the inspection corridor. The overlay follows the plotted route, including a shaped route bend, and extends 1 NM either side. Inspect the applicable chart/data inside that corridor, determine the MSA yourself, and enter it in the OFP MSA field for that leg.

If both MSA and PL are entered and `PL < MSA`, the MSA and PL cells are highlighted as a warning.

The website does **not** currently calculate a complete MSA from terrain and obstacle data. The detailed future implementation is documented in [docs/MSA_IMPLEMENTATION_PLAN.md](docs/MSA_IMPLEMENTATION_PLAN.md).

## C182T glide-to-land visualization

Use the `C182T glide` map control to display an approximate zero-wind maximum-glide reach around the route. The overlay has deliberately stronger blue shading than the initial implementation for map readability.

Source basis: Cessna Model 182T NAV III GFC 700 AFCS, Section 3, Figure 3-1 `MAXIMUM GLIDE`, supplied for this project. The figure states propeller windmilling, flaps up and zero wind, with best-glide speeds 76 KIAS at 3100 lb, 70 KIAS at 2600 lb and 58 KIAS at 2100 lb.

The plotted maximum-glide line is approximately linear from 0 ft / 0 NM to 14,000 ft / 20 NM. Flightplanner represents it as:

```text
approximate glide distance [NM]
= height above assumed landing surface [ft] / 700
```

The overlay uses the modeled route altitude, follows the plotted route path, assumes a sea-level shoreline, does not account for terrain or landing suitability, is not wind-aware, and is not extrapolated above 14,000 ft.

## Architecture

```text
src/navigation/    Great-circle, wind, magnetic, MSA-corridor, glide-envelope and vertical-profile math
src/performance/   C182T cruise, climb and maximum-glide source models and interpolation
src/fuel/          Phase-aware route fuel planning and persisted fuel inputs
src/weather/       Route forecast sampling/interpolation
src/aip/           AIP aerodrome catalog lookup
src/map/           Leaflet map and ICAO chart quality logic
src/flightplan/    Route/planning state, manual MSA, undo and non-waypoint route shaping
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
| 4 | Complete | Full C182T Figure 5-9 cruise model plus Figure 5-8 climb model |
| 5 | Preview | Route weather and per-leg forecast wind integration |
| 6 | Advanced preview | Automatic multi-leg TOC/TOD, airports and touch-and-goes, phase TAS and wind-aware vertical geometry |
| 7 | In progress | Norwegian AIP aerodrome elevation, circuit planning, route shaping, manual MSA workflow and C182T glide visualization |
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
