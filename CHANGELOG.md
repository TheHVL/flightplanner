# Flightplanner change history

This file records significant Flightplanner updates, the formulas used, data assumptions, and important limitations. New updates are added at the top.

## Formula conventions

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

Displayed OFP values may be rounded for readability. Internal calculations keep unrounded values unless explicitly documented otherwise.

---

## PR #21, C182T maximum-glide visualization

### Added / changed

- Added a `C182T glide` map toggle.
- Added a shaded theoretical maximum-glide reach around the route.
- Source basis is the user-supplied Cessna Model 182T NAV III GFC 700 AFCS, Section 3, Figure 3-1 `MAXIMUM GLIDE`.
- The UI preserves the source conditions: propeller windmilling, flaps up, zero wind.
- Recorded the best-glide speeds printed in the figure:
  - 3100 lb: 76 KIAS
  - 2600 lb: 70 KIAS
  - 2100 lb: 58 KIAS
- The overlay uses the Phase 6 modeled altitude during climbs and descents rather than applying full PL before TOC or after TOD.
- The overlay is hidden when vertical profiles overlap because the altitude model is ambiguous.
- Figure 3-1 is not extrapolated above 14,000 ft.
- Added tests for the glide-line model, best-glide speeds, climb-altitude sampling, overlap handling, and chart-limit behavior.

### Glide model

The plotted Figure 3-1 line is approximately straight from 0 ft / 0 NM to 14,000 ft / 20 NM. Flightplanner represents that plotted line as:

```text
700 ft per NM = 14,000 ft / 20 NM

approximate maximum glide distance [NM]
= height above assumed landing surface [ft] / 700
```

Examples:

```text
2,800 ft -> 4.0 NM
4,500 ft -> 6.4 NM
7,000 ft -> 10.0 NM
14,000 ft -> 20.0 NM
```

During a modeled climb or descent, altitude is linearly interpolated along the vertical-profile distance:

```text
fraction = (route distance - vertical-segment start) / vertical-segment distance
modeled altitude = altitude_from + (altitude_to - altitude_from) × fraction
```

### Important limitations

- The overlay assumes zero wind because that is the condition stated by Figure 3-1.
- For the current over-water visual aid, the shoreline/landing surface is assumed to be at sea level.
- The shading does not account for terrain between the aircraft and a landing area.
- It does not determine whether land is suitable for landing.
- It is not a landing guarantee and does not automatically alter MSA.

---

## PR #20, visual 1 NM MSA corridor and manual MSA validation

### Added / changed

- Added an optional `MSA ±1 NM` map overlay.
- Corridor width is geographic rather than pixel-based, so it stays 1 NM either side of the route when zoom changes.
- Added 1 NM waypoint end caps.
- Added manual MSA entry for every OFP leg.
- OFP highlights MSA and PL if planned level is below entered MSA.
- Manual MSA participates in Ctrl+Z/Cmd+Z undo.
- Geometry-changing route edits clear affected manual MSA values so stale checks are not reused.
- Splitting a route leg does not copy the old MSA to the new legs; MSA must be rechecked.

### Rule used

```text
manual MSA = highest terrain or obstacle within 1 NM of route + 500 ft

if PL < entered MSA:
    show warning
```

The corridor uses spherical geographic offsets. Waypoint caps use:

```text
1 NM = 1852 m
```

The overlay is a chart-inspection tool, not an automatic terrain/obstacle database.

---

## PR #19, route-line waypoint insertion, undo history and MSA design

### Added / changed

- Route legs gained a wider invisible grab line.
- Dragging a route line previews a bend and inserts a waypoint at the release point.
- Inserted points are placed in route order instead of appended to the end.
- Existing PL on a split leg is copied to both new legs.
- Changed route geometry invalidates route weather.
- Added up to 50 planner-state undo snapshots.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS restore the previous planner state.
- Added the MSA implementation design document.

No operational MSA value was introduced in this update.

---

## PR #18, Phase 7 documentation and status cleanup

### Added / changed

- Updated the app header to Phase 7.
- Updated README and change-history documentation to explicitly include the AIP/circuit changes and AIP parser fix.
- Kept the project status and limitations aligned with what was actually deployed.

No aviation formulas changed.

---

## PR #17, Avinor AIP current-issue detection fix

### Fixed

- Updated the AIP updater to detect the current AIRAC date from Avinor's AIP history page rather than relying on an outdated strict href format.
- Pages builds construct the current English eAIP issue path from the detected AIRAC date.
- The deployment verified 53 AD 2 aerodromes for the AIP effective 2026-09-03; ENVR and ENBH were skipped because the requested pages returned HTTP 404.
- The committed fallback dataset remains available if a refresh fails.

No aviation formulas changed.

---

## PR #16, Phase 7 AIP aerodrome elevation and circuit planning

### Added / changed

- Added an Avinor AIP-derived aerodrome catalog and ICAO lookup for field elevation.
- Added build-time and scheduled AIP refresh.
- Added intermediate `Airport + circuits` mode.
- Added circuit count and minutes per circuit.
- Circuit time is added to accumulated OFP time.
- Fixed automatic waypoint renumbering so map and OFP names stay aligned after deletion/reordering.
- Fixed PL-change descent gating so TOD for a lower outbound PL cannot move before the waypoint where that lower PL starts.

### Formulas

```text
Circuit allowance [min]
= number of circuits × minutes per circuit

ACC time after leg n
= previous ACC time + waypoint activity time + leg time
```

For a lower outbound PL after waypoint `WPi`:

```text
Descent time [min] = Δh / ROD
Descent distance [NM] = descent GS × descent time / 60

Ideal TOD = next waypoint route distance - descent distance
Actual TOD = max(WPi route distance, Ideal TOD)
```

If the selected descent cannot fit before the next waypoint, the planner warns rather than moving TOD to the wrong side of the waypoint.

---

## PR #15, automatic multi-leg TOC/TOD and touch-and-go airports

### Added / changed

- Extended vertical profiling from only departure/arrival to altitude changes throughout the route.
- Higher outbound PL creates TOC after the waypoint.
- Lower outbound PL creates a descent on the outbound leg.
- Added intermediate waypoint modes: Auto from PL, Airport/T&G, Off.
- Airport/T&G descends to field elevation and climbs again after the airport.
- Added multiple TOC/TOD markers and profile-overlap detection.

### Formulas

```text
Time [min] = altitude change [ft] / vertical speed [ft/min]
Distance [NM] = groundspeed [kt] × time [min] / 60
```

Airport/T&G model:

```text
Inbound descent: inbound PL -> field elevation
Outbound climb: field elevation -> outbound PL
```

---

## PR #14, initial Phase 6 vertical profile

### Added

- Departure and destination elevations.
- User-selectable climb/descent rates.
- User-selectable climb/descent groundspeeds.
- Initial TOC and final TOD calculations.
- Great-circle placement of TOC/TOD markers.
- Overlap detection.

### Formulas

```text
Climb altitude gain = max(0, initial PL - departure elevation)
Descent altitude loss = max(0, final PL - destination elevation)

Climb time [min] = climb altitude gain / ROC
Descent time [min] = descent altitude loss / ROD

Climb distance [NM] = climb GS × climb time / 60
Descent distance [NM] = descent GS × descent time / 60

TOC distance from departure = climb distance
TOD distance from departure = route distance - descent distance
Level distance = max(0, TOD distance - TOC distance)
```

---

## PR #13, scrollable planning sidebar fix

### Fixed

- Prevented planning panels from shrinking vertically inside the fixed workspace.
- Made the left column independently scrollable on desktop.
- Added a visible thin scrollbar while preserving mobile behavior.

No aviation formulas changed.

---

## PR #12, OFP rounding and resizable map

### Added / changed

- Displayed OFP distance rounds to nearest 0.5 NM.
- Displayed WCA rounds to nearest whole degree.
- Added draggable desktop map/workspace height.
- Saved selected height in local storage.
- Added keyboard resize and double-click reset.

### Display formulas

```text
Displayed distance = round(exact distance × 2) / 2
Displayed WCA = round(exact WCA)
```

Exact values continue to feed calculations.

---

## PR #11, rounded headings and Phase 5 route-weather preview

### Added / changed

- TT, MT and MH display as normalized whole-degree headings.
- Added route weather preview with UTC departure time.
- Added pressure-level wind and temperature sampling.
- Added vertical interpolation using geopotential height.
- Added time interpolation between forecast steps.
- Added per-leg forecast winds to the OFP wind triangle.

### Weather interpolation

```text
lerp(a, b, t) = a + (b - a) × t
```

Wind is interpolated through vector components:

```text
u = -speed × sin(direction)
v = -speed × cos(direction)

speed = sqrt(u² + v²)
wind-from direction = atan2(-u, -v), normalized to 0..360°
```

Vertical interpolation fraction:

```text
t = (target altitude - lower geopotential height)
    / (upper geopotential height - lower geopotential height)
```

---

## PR #10, OFP layout and per-leg planned altitude

### Added / changed

- Reworked the OFP table to match the UiT layout more closely.
- Columns after WCA became accumulated distance/time.
- Individual leg GS, distance and time moved to Intermediate.
- Added editable PL for every leg.
- Clarified fuel columns: FF = GPH, INT = leg fuel, ACC = accumulated cruise fuel.
- Rounded magnetic variation to whole degrees for displayed/used MT and MH.

### Formulas

```text
Accumulated distance_n = sum of exact leg distances 1..n
Accumulated time_n = sum of exact leg times 1..n
Leg fuel [gal] = FF [gal/h] × leg time [h]
Accumulated fuel_n = sum of leg fuel 1..n
```

---

## PR #9, Phase 2 complete and C182T cruise-performance preview

### Added

- WMM2025 magnetic variation at each leg midpoint, with manual override.
- C182T cruise-performance panel.
- Initial POH cruise data for sea level and 2,000 ft, 2200-2400 RPM, ISA -20°C / ISA / ISA +20°C.
- Bounded interpolation with no extrapolation.
- POH KTAS feeds the wind triangle when enabled.
- POH GPH feeds cruise leg/accumulated fuel.
- Warning above 80% MCP.

### Formulas

```text
ISA temperature [°C]
= 15 - 2 × pressure altitude [thousand ft]

Temperature offset = OAT - ISA temperature
```

Linear interpolation within published bounds:

```text
fraction = (requested - lower) / (upper - lower)
interpolated value = lower + (upper - lower) × fraction
```

---

## PR #8, preserve map view while editing

### Fixed

- Removed automatic `fitBounds()` after route edits.
- Adding, dragging, renaming, deleting or reordering points preserves map pan/zoom.

No aviation formulas changed.

---

## PR #7, ICAO chart quality, caching and map sizing

### Added / changed

- Adaptive source raster size for the Avinor ICAO chart.
- Auto, Sharp and Fast detail modes.
- PNG24 export.
- `maxNativeZoom` protection.
- AIRAC-aware service-worker cache.
- Larger map and expanded-map mode.
- ResizeObserver integration.

### Raster sizing

```text
CSS resolution [m/px]
= 156543.03392804097 × cos(latitude) / 2^zoom

source match ratio = CSS resolution / 31.75 m/px
requested raster pixels = 256 CSS px × selected ratio
```

The result is capped by detail mode/device pixel ratio and rounded to a multiple of 8 pixels.

---

## PR #6, Phase 3 Norwegian map layers

### Added

- Kartverket topo WMTS.
- Avinor Norway Aeronautical Chart ICAO 1:500 000.
- OpenStreetMap fallback.
- Numbered waypoint markers with departure/en-route/destination roles.

No navigation formulas changed.

---

## PR #5, Phase 2 navigation and wind triangle

### Added

- Manual TAS.
- Manual true wind direction/speed.
- Manual magnetic variation.
- WCA, TH, MT, MH, GS and leg time.
- Wind/navigation tests.

### Formulas

```text
relative wind = wind-from direction - TT
crosswind = W × sin(relative wind)
WCA = asin(crosswind / TAS)
TH = TT + WCA

along-track wind = -W × cos(relative wind)
GS = TAS × cos(WCA) + along-track wind

MT = TT - VAR_E
MH = TH - VAR_E

leg time [h] = distance [NM] / GS [kt]
```

Headings are normalized into `0 <= heading < 360°`.

---

## PR #4, stacked C182T performance prototype

- Early exploration of a larger C182T POH dataset, pressure-altitude handling and interpolation architecture.
- Later mainline performance work superseded this prototype.

---

## PR #3, stacked map architecture prototype

- Early exploration of Kartverket plus configurable ICAO map-source architecture and licensing boundaries.
- Later mainline map work superseded/refined this prototype.

---

## PR #2, stacked navigation prototype

- Early exploration of manual wind, navigation, fuel accumulation and provider abstractions.
- Later mainline Phase 2 work superseded/refined this prototype.

---

## PR #1, Phase 1 foundation

### Added

- Vite + strict TypeScript foundation.
- Leaflet map.
- Click-to-add and drag-to-move waypoints.
- Reorder, remove and rename route points.
- Great-circle distance and initial true track.
- Basic OFP table.
- Unit tests and GitHub Actions CI.

### Great-circle distance

Using Earth radius `R = 3440.065 NM`:

```text
Δφ = φ2 - φ1
Δλ = λ2 - λ1

a = sin²(Δφ/2) + cos(φ1) × cos(φ2) × sin²(Δλ/2)
c = 2 × atan2(sqrt(a), sqrt(1-a))
D = R × c
```

### Initial true track

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
- Manual overrides should remain available where appropriate.
- External data failures should produce explicit warnings or safe fallbacks, not invented values.
- AIP, weather, MSA and glide integrations are planning aids and do not replace official flight-planning sources or pilot judgement.
- Every significant calculation change should add or update automated tests.
