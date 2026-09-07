# Flightplanner change history

This file records the significant changes made to Flightplanner, why they were made, the formulas used, and important limitations. New updates should be added at the top.

## Conventions used in formulas

- `D` = distance in NM
- `TAS` = true airspeed in kt
- `GS` = groundspeed in kt
- `W` = wind speed in kt
- `TT` = true track
- `TH` = true heading
- `MT` = magnetic track
- `MH` = magnetic heading
- `VAR_E` = magnetic variation, east positive
- `WCA` = wind correction angle
- `FF` = fuel flow in US gal/h
- `Δh` = altitude change in ft
- `ROC` = rate of climb in ft/min
- `ROD` = rate of descent in ft/min

Displayed OFP values may be rounded for readability. Internal calculations keep the unrounded values unless explicitly documented otherwise.

---

## PR #19, route-line waypoint insertion, undo history and MSA design

### Added / changed

- Route legs now have a wide invisible interaction line. Dragging a route leg bends the route as a preview and inserts a new waypoint at the release position.
- The inserted waypoint is placed in route order between the two waypoints that formed the dragged leg rather than appended to the end.
- If the original leg had a planned level, that PL is copied to both new split legs so inserting a point does not silently lose the altitude plan.
- Route weather data is invalidated after insertion because the route geometry changed.
- Added planner-state undo history with up to 50 snapshots.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS restore the previous planner state. If a form control is focused, it is blurred first so the edit is committed before the planner undo is applied.
- Undo restores route waypoints, automatic/manual waypoint-name status, navigation settings, performance settings, weather settings, vertical-profile settings, planned altitudes, weather forecast state and intermediate airport/circuit constraints.
- Added `docs/MSA_IMPLEMENTATION_PLAN.md` describing the proposed daytime-VFR MSA architecture for this project.

### MSA proposal documented, not yet calculated in the application

The project rule supplied for the planned MSA feature is:

```text
Obstacle/terrain MSA = highest controlling elevation within 1 NM of route + 500 ft
```

When above water, the proposal adds a separate glide-to-land requirement. For a simple constant still-air glide-ratio model, if later supported by verified aircraft data:

```text
required height above landing point [ft]
  = distance to land [NM] × 6076.12 / glide ratio

required glide altitude MSL
  = landing-point elevation MSL + required height above landing point

leg MSA = max(obstacle/terrain MSA, glide-to-land requirement)
```

No glide ratio has been invented or taken from the cruise tables. The C182T glide model must be based on separately verified POH glide data before this calculation is implemented.

### Data-access note

- Kartverket terrain/elevation data is available through national elevation-model services and is the proposed source for terrain corridor analysis.
- Nasjonalt register over luftfartshindre (NRL) is the appropriate source family for man-made obstacles, but Kartverket requires approved access from 1 July 2026.
- The public repository must not contain restricted NRL data or credentials.
- A first MSA implementation should therefore be terrain-only with a clear incomplete-data warning plus manual obstacle override, unless an approved obstacle-data integration is established.

No new operational MSA value is exposed by this PR. The implementation plan deliberately separates the design from an unverified obstacle/glide calculation.

---

## PR #17, fix Avinor AIP current-issue detection

### Fixed

- The first Phase 7 deployment revealed that Avinor's current AIP history-page link format did not match the original strict URL parser.
- Replaced the strict href assumption with current AIRAC date detection from Avinor's AIP history page.
- The Pages build now constructs the current English eAIP issue path from the detected AIRAC date.
- Verified in GitHub Pages deployment that the updater parsed 53 AD 2 aerodromes from the AIP effective 2026-09-03. ENVR and ENBH were skipped because their requested AD 2 pages returned HTTP 404.
- The committed fallback catalog is still retained if a future AIP refresh fails.

No aviation formulas changed in this update.

---

## PR #16, Phase 7 AIP and circuit planning

### Added

- Added an Avinor AIP-derived aerodrome catalog and ICAO lookup for airport elevation.
- Added a build-time AIP updater in `scripts/update-aip-aerodromes.mjs`.
- GitHub Pages now attempts to refresh AIP aerodrome data before deployment and runs a scheduled weekly refresh.
- Added committed fallback AIP data so the planner remains usable if Avinor is temporarily unavailable or the current eAIP cannot be parsed safely.
- Added ICAO lookup controls for departure, destination and intermediate airport waypoints.
- Added `Airport + circuits` as an intermediate waypoint mode.
- Circuit planning supports circuit count and minutes per circuit.
- Circuit/pattern time is added to OFP accumulated time after the airport and before the next outbound leg.
- Circuit fuel is intentionally not calculated yet.
- Fixed automatic waypoint renumbering so deleting or moving an automatically named waypoint keeps map labels and OFP names aligned.
- Fixed PL descent gating. If WP03 is planned at one altitude and the outbound WP03 to WP04 leg is planned lower, TOD can no longer be placed before WP03.

### Formulas and rules

Circuit time:

```text
Circuit allowance [min] = number of circuits × minutes per circuit
```

OFP accumulated time:

```text
ACC time after leg n = previous ACC time
                     + activity/circuit time at leg start waypoint
                     + leg time
```

Vertical transition time:

```text
Climb time [min]   = Δh / ROC
Descent time [min] = Δh / ROD
```

Vertical transition distance:

```text
Climb distance [NM]   = climb GS × climb time / 60
Descent distance [NM] = descent GS × descent time / 60
```

For a lower outbound PL after waypoint `WPi`, the ideal TOD is calculated backwards from the next waypoint, but the transition is gated by `WPi`:

```text
Ideal TOD route distance = next waypoint route distance - descent distance
Actual TOD route distance = max(WPi route distance, Ideal TOD route distance)
```

This guarantees that a descent belonging to the outbound leg never begins before the waypoint where that lower planned level starts. If the required descent distance is longer than the outbound leg, the planner holds TOD at the waypoint and issues a warning that the requested target altitude cannot be achieved by the next waypoint using the selected descent assumptions.

### AIP data notes

- Source: Avinor AIP Norway, AD 2 aerodrome pages.
- The browser uses a static JSON snapshot rather than requesting Avinor eAIP pages directly, avoiding browser CORS dependence and avoiding private API credentials.
- The deployed snapshot is refreshed at build time when possible.
- Manual field elevation remains available and should be used if an airport is absent from the snapshot or current AIP data needs correction.
- The AIP lookup is a convenience for training planning, not an operational database guarantee.

---

## PR #15, automatic Phase 6 across PL changes and touch-and-go airports

### Added

- Automatic vertical transitions across the whole route rather than only departure and destination.
- A higher outbound PL creates a TOC after the intermediate waypoint.
- A lower outbound PL originally created a TOD associated with the intermediate waypoint. This behavior was subsequently refined in PR #16 so TOD cannot move to the wrong side of the waypoint.
- Intermediate waypoint modes: Auto from PL, Airport/T&G, Off.
- Airport/T&G accepts field elevation, creates TOD before the airport and TOC after it.
- Multiple TOC/TOD map markers.
- Vertical-profile overlap detection.
- Zero-altitude-change events are suppressed so a pointless marker is not placed directly on a waypoint.

### Formulas

Same vertical formulas as above:

```text
Time [min] = altitude change [ft] / vertical speed [ft/min]
Distance [NM] = groundspeed [kt] × time [min] / 60
```

For an airport/T&G:

```text
Inbound descent: inbound PL -> field elevation
Outbound climb:   field elevation -> outbound PL
```

---

## PR #14, initial Phase 6 TOC/TOD vertical profile

### Added

- Departure and destination elevation assumptions.
- User-selectable climb and descent rates in ft/min.
- User-selectable climb and descent groundspeeds.
- Initial TOC and final TOD calculation.
- Great-circle placement of TOC/TOD points on the route.
- Detection of overlapping climb and descent profiles.

### Formulas

```text
Climb altitude gain = max(0, planned altitude - departure elevation)
Descent altitude loss = max(0, final planned altitude - destination elevation)

Climb time [min] = climb altitude gain / climb rate
Descent time [min] = descent altitude loss / descent rate

Climb distance [NM] = climb GS × climb time / 60
Descent distance [NM] = descent GS × descent time / 60

TOC distance from departure = climb distance
TOD distance from departure = route distance - descent distance
Level distance = max(0, TOD distance - TOC distance)
```

---

## PR #13, scrollable planning sidebar fix

### Fixed

- Prevented Route, Phase 2, Phase 4, Phase 5 and later panels from vertically shrinking inside the fixed workspace.
- Made the left planning column independently scrollable on desktop.
- Added a visible thin scrollbar while preserving mobile behavior.

No aviation formulas changed.

---

## PR #12, OFP rounding and resizable map

### Added / changed

- OFP displayed distances round to nearest 0.5 NM.
- WCA displays to the nearest whole degree.
- Draggable map/workspace height on desktop.
- Map height is stored in browser local storage.
- Keyboard resizing and double-click reset.

### Display formulas

```text
Displayed distance = round(exact distance × 2) / 2
Displayed WCA = round(exact WCA)
```

Exact values continue to feed time, navigation and fuel calculations.

---

## PR #11, rounded headings and Phase 5 route weather preview

### Added / changed

- TT, MT and MH display as normalized whole-degree headings `000°` to `359°`.
- Map fills the selected workspace height.
- Route weather panel with UTC departure time.
- Open-Meteo pressure-level wind and temperature sampling per leg.
- Forecast is sampled near the geographic leg midpoint and planned altitude.
- Pressure-level data is interpolated using geopotential height.
- Forecast time is interpolated between hourly steps.
- Wind direction is interpolated through vector components rather than directly averaging degrees, avoiding errors around 359°/001°.
- Fetched per-leg winds can feed the OFP wind triangle; manual winds remain a fallback.

### Weather interpolation formulas

Linear interpolation:

```text
lerp(a, b, t) = a + (b - a) × t
```

Wind from direction is converted to vector components before interpolation:

```text
u = -speed × sin(direction)
v = -speed × cos(direction)

speed = sqrt(u² + v²)
wind-from direction = atan2(-u, -v), normalized to 0..360°
```

Vertical interpolation fraction uses geopotential height:

```text
t = (target altitude - lower geopotential height)
    / (upper geopotential height - lower geopotential height)
```

---

## PR #10, OFP layout and per-leg altitude

### Added / changed

- Reworked the navigation log to match the uploaded UiT operational flight plan layout more closely.
- Columns immediately after WCA are accumulated distance and accumulated time.
- Individual leg GS, distance and time are in the Intermediate group.
- Added editable PL for every route leg.
- Fuel columns clarified as:
  - `FF`: fuel flow, GPH
  - `INT`: fuel used on the current leg, gal
  - `ACC`: accumulated cruise fuel used, gal
- Magnetic variation rounded to whole degrees and the rounded value is used for MT/MH.

### Formulas

```text
Accumulated distance_n = sum of exact leg distances 1..n
Accumulated time_n = sum of exact leg times 1..n
Leg fuel [gal] = FF [gal/h] × leg time [h]
Accumulated fuel_n = sum of leg fuel 1..n
```

---

## PR #9, Phase 2 complete and Phase 4 C182T performance preview

### Added

- WMM2025 automatic magnetic variation at each leg midpoint.
- Manual magnetic variation override retained.
- C182T cruise-performance panel.
- Mainline POH preview data for sea level and 2,000 ft pressure altitude, 2200-2400 RPM, ISA -20°C / ISA / ISA +20°C.
- Bounded interpolation across manifold pressure, temperature offset, RPM and pressure altitude.
- No extrapolation outside the loaded POH table.
- POH-derived KTAS can feed the wind triangle.
- POH-derived fuel flow can feed leg and accumulated cruise fuel.
- Warning for settings above 80% MCP because the POH table states those values are for interpolation rather than normal maximum cruise use.

### Formulas

Approximate ISA temperature used by the current performance preview:

```text
ISA temperature [°C] = 15 - 2 × pressure altitude [thousand ft]
Temperature offset = OAT - ISA temperature
```

All POH interpolation is linear within bracketing published points:

```text
fraction = (requested - lower) / (upper - lower)
interpolated value = lower + (upper - lower) × fraction
```

This is applied dimension by dimension only inside the loaded table bounds.

---

## PR #8, preserve map view while editing

### Fixed

- Removed automatic `fitBounds()` after every route edit.
- Adding, dragging, renaming, deleting or reordering waypoints now preserves the user's current map center and zoom.

No aviation formulas changed.

---

## PR #7, ICAO chart quality, caching and map sizing

### Added / changed

- Adaptive source raster size for the Avinor ICAO chart.
- Auto, Sharp and Fast chart detail modes.
- PNG24 chart export.
- `maxNativeZoom` protection against requesting invented source detail.
- Wider tile keep buffer and idle-oriented loading.
- AIRAC-aware service-worker cache for Avinor chart export tiles.
- Larger map and expanded-map mode.
- ResizeObserver integration.

### Raster sizing formulas

Web Mercator approximate ground resolution at tile center latitude:

```text
CSS resolution [m/px]
= 156543.03392804097 × cos(latitude) / 2^zoom
```

The chart source-match ratio is compared with the measured source chart resolution used by the planner:

```text
source match ratio = CSS resolution / 31.75 m/px
requested raster pixels = 256 CSS px × selected ratio
```

The result is capped by detail mode and device pixel ratio, never above 4x, then rounded up to a multiple of 8 pixels.

---

## PR #6, Phase 3 Norwegian map layers

### Added

- Kartverket `topo` WMTS as the primary Norgeskart base layer.
- Avinor Norway Aeronautical Chart ICAO 1:500 000 as a switchable map layer.
- OpenStreetMap fallback.
- Numbered waypoint markers with departure/en-route/destination roles.

No navigation formulas changed.

---

## PR #5, Phase 2 navigation and wind calculations

### Added

- Manual TAS.
- Manual true wind-from direction and speed.
- Manual magnetic variation.
- Wind triangle.
- WCA, TH, MT, MH, GS and leg time.
- Wind/navigation unit tests.

### Wind triangle formulas

Relative wind angle:

```text
relative wind = wind-from direction - TT
```

Crosswind component and WCA:

```text
crosswind = W × sin(relative wind)
WCA = asin(crosswind / TAS)
TH = TT + WCA
```

Along-track wind and groundspeed:

```text
along-track wind = -W × cos(relative wind)
GS = TAS × cos(WCA) + along-track wind
```

True to magnetic conversion with east-positive variation:

```text
MT = TT - VAR_E
MH = TH - VAR_E
```

All headings are normalized into `0 <= heading < 360°`.

Leg time:

```text
leg time [h] = distance [NM] / GS [kt]
```

---

## PR #4, stacked Phase 4 POH prototype

This was an early stacked feature branch built on the pre-mainline Phase 3 branch. It explored a larger C182T POH dataset, pressure-altitude handling and interpolation architecture. The later mainline implementation evolved through PR #9 and subsequent changes. Treat the current `src/performance/` code and current tests as authoritative for what is actually deployed.

---

## PR #3, stacked Phase 3 map architecture prototype

This was an early stacked branch exploring Kartverket plus configurable ICAO map-source architecture and licensing boundaries. The deployed map implementation was later replaced/refined by PR #6 and PR #7.

---

## PR #2, stacked Phase 2 navigation prototype

This was an early stacked branch exploring manual wind, navigation, fuel accumulation and provider abstractions. The deployed Phase 2 implementation was later developed through PR #5, PR #9 and PR #10.

---

## PR #1, Phase 1 foundation

### Added

- Vite and strict TypeScript project foundation.
- Leaflet map.
- Click-to-add and drag-to-move waypoints.
- Reorder, remove and rename route points.
- Great-circle distance.
- Initial true track.
- Basic operational flight-plan table.
- Unit tests and GitHub Actions CI.

### Great-circle distance formula

The route uses the haversine great-circle formula with Earth radius `R = 3440.065 NM`:

```text
Δφ = φ2 - φ1
Δλ = λ2 - λ1

a = sin²(Δφ/2) + cos(φ1) × cos(φ2) × sin²(Δλ/2)
c = 2 × atan2(sqrt(a), sqrt(1-a))
D = R × c
```

### Initial true track formula

```text
y = sin(Δλ) × cos(φ2)
x = cos(φ1) × sin(φ2)
    - sin(φ1) × cos(φ2) × cos(Δλ)

TT = atan2(y, x), normalized to 0..360°
```

---

## Important design principles

- Aviation calculations belong in navigation/performance/weather modules, not UI code.
- Display rounding should not reduce calculation precision.
- Do not extrapolate POH data beyond published/loaded bounds.
- Manual overrides should remain available for weather, magnetic variation and field elevation.
- External data failures should produce an explicit warning or safe fallback, not invented values.
- AIP and weather integrations are planning conveniences and do not replace official pre-flight briefing sources.
- Every significant calculation change should add or update automated tests.
