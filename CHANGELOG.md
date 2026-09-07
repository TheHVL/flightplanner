# Flightplanner change history

This file records significant Flightplanner updates, formulas, source assumptions, limitations and implementation decisions. New updates are added at the top.

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

## 2026-09-07, route shaping and planning UX

### Added / changed

- Replaced route-line drag waypoint insertion with a non-waypoint route-shaping bend.
- A shaped route leg uses the longer plotted/flown distance for accumulated distance, phase placement, time and fuel, while TT/MT/MH remain based on the direct original waypoint-to-waypoint leg as requested.
- One visual shaping bend is supported per leg. It does not create a named waypoint or another OFP row.
- The visual MSA corridor and C182T glide sampling follow the shaped path.
- Changing a leg shape clears that leg's manual MSA and invalidates route-weather samples because the checked/sampled geometry changed.
- An immediately preceding line-shape drag can be undone with Ctrl+Z/Cmd+Z before normal planner undo is used.
- Changed TOC/TOD map symbols from large oval badges to short lines perpendicular to the local plotted route.
- Strengthened the blue C182T glide shading for readability.
- Added a mandatory acknowledgement dialog on each site load stating that Flightplanner is experimental, unapproved and not a sole flight-planning source.
- Wrapped the sidebar phases in user-selectable collapsible sections and persist each open/closed state locally.
- Clarified `Airport / T&G` versus `Airport + circuits` in the vertical panel and display the standard circuit altitude as 1000 ft AGL, or field elevation + 1000 ft when elevation is known.
- Circuits remain a time/fuel activity allowance and are not yet a fully drawn/simulated circuit geometry.
- Corrected the OFP body-column alignment so estimated fuel remaining sits under `FUEL REMAINING -> EST`, with `TIME -> DIFF` retained as its own pending cell.
- Changed the Phase 4 default cruise setting to 2200 RPM and 20 inHg manifold pressure.
- Added route-shaping geometry tests and retained all existing phase/navigation/performance tests.

### Route-shaping calculation

For a direct leg from waypoint A to waypoint B with one optional route-shaping bend S:

```text
flown distance
= distance(A,S) + distance(S,B)
```

The navigation course intentionally remains direct:

```text
TT = initial true track(A,B)
```

Thus the shape is a distance/time/fuel planning aid and not another navigation fix.

### Important limitations

- Only one shaping bend per waypoint-to-waypoint leg is currently stored.
- Route-weather wind/temperature still belongs to the original waypoint leg rather than a separate forecast sample for each side of the bend.
- The shape is not a certified obstacle-avoidance or routing solution.
- Circuit altitude is now shown as 1000 ft AGL, but the circuit itself remains a configured time/fuel allowance rather than a modeled rectangular flight path.
- A `Vertical profiles overlap` fuel warning means climb/descent intervals overlap in route distance. Complete climb/descent/trip fuel is withheld until the vertical profile is resolved.

---

## PR #24, phase-specific TAS and wind-aware TOC/TOD

### Added / changed

- Reworked vertical geometry so climb, cruise and descent can use different TAS values instead of treating one groundspeed as representative of every phase.
- Figure 5-8 POH climb time and fuel remain source-derived and are not changed by wind.
- The Figure 5-8 zero-wind climb distance is now used to derive the average TAS represented by the POH table.
- Active wind is then applied to that climb TAS on each route leg to determine the actual ground distance covered before TOC.
- Manual climb mode now interprets the existing stored `climbGroundSpeedKt` value as manual climb TAS. The legacy field name is kept for stored-setting compatibility.
- Descent now interprets the existing stored `descentGroundSpeedKt` value as descent TAS, then applies active per-leg wind when locating TOD. Descent rate and descent FF remain manual.
- A climb/descent that crosses multiple legs walks the route in order and solves the wind triangle separately for each leg's true track and active wind.
- Enabled route-weather wind is used when available. Otherwise the manual navigation wind is used.
- Route-weather OAT is used for the outbound POH climb temperature correction when available, with Phase 4 OAT as fallback.
- OFP TAS now shows cruise TAS when a meaningful cruise portion exists. An essentially all-climb leg shows climb TAS, and an essentially all-descent leg shows descent TAS.
- OFP WCA/MH are based on the TAS displayed in that row.
- OFP GS now shows effective whole-leg flying groundspeed rather than cruise GS when a leg contains several phases.
- Circuit/activity minutes remain part of OFP elapsed time, but are excluded from effective GS because they add time without route distance.
- Added automated tests for headwind/tailwind TOC movement, wind-aware TOD, forecast-wind selection, phase-TAS display and effective GS.
- Updated the README and vertical-profile UI wording to make TAS, wind, source assumptions and limitations explicit.

### POH climb TAS

Figure 5-8 states that its climb distance is based on zero wind. Flightplanner derives the average climb TAS represented by that table:

```text
average climb TAS [kt]
= corrected Figure 5-8 zero-wind distance [NM]
/ (corrected Figure 5-8 climb time [min] / 60)
```

Because Figure 5-8 applies the same above-ISA correction factor to time and distance, the TAS ratio remains consistent after the correction.

### Phase wind triangle

For each climb, cruise or descent section on a route leg, the existing wind-triangle solution is applied with that phase's TAS:

```text
relative wind = wind-from direction - TT
crosswind = W x sin(relative wind)
WCA = asin(crosswind / TAS)
TH = TT + WCA

along-track wind = -W x cos(relative wind)
GS = TAS x cos(WCA) + along-track wind
```

For a phase that remains on one straight leg:

```text
phase ground distance [NM]
= phase GS [kt] x phase time [min] / 60
```

For a phase crossing multiple legs, the planner consumes the available phase time leg by leg using each leg's own track and active wind.

### Effective OFP groundspeed

```text
effective leg GS [kt]
= leg distance [NM]
/ ((climb time + cruise time + descent time) / 60)
```

Circuit/pattern activity time is deliberately excluded from this GS calculation.

### Source and limitation notes

- Figure 5-8 climb time/fuel remain POH-derived. Wind changes ground position, not POH climb time or fuel.
- No POH extrapolation was added. Normal Climb still stops at 10,000 ft and Maximum Rate at 14,000 ft.
- Figure 5-9 cruise interpolation remains bounded to published data.
- Descent TAS, ROD and FF remain manual until a verified descent-performance source is supplied.
- PL and aerodrome elevation are still pressure-altitude proxies until QNH conversion is implemented.

---

## 2026-09-07, C182T Figure 5-8 climb performance

### Added / changed

- Added both supplied C182T Figure 5-8 `TIME, FUEL AND DISTANCE TO CLIMB AT 3100 POUNDS` sheets.
- Added selectable `POH normal climb - 90 KIAS`, `POH maximum rate of climb`, and manual climb modes.
- Normal climb is loaded from sea level through 10,000 ft pressure altitude.
- Maximum-rate climb is loaded from sea level through 14,000 ft pressure altitude.
- POH modes drive climb time, climb fuel and TOC geometry.
- Climbs starting above sea level subtract cumulative Figure 5-8 values at the starting altitude from those at the target altitude.
- Linear interpolation is allowed only between published altitude rows. No extrapolation is allowed.
- Applied the Figure 5-8 instruction to increase time, fuel and distance by 10% for each 10°C above standard temperature.
- Values are not reduced below standard because the source note only specifies an increase above standard.
- Added tests for exact values, interpolation, climbs beginning above sea level, temperature correction and source limits.

### Figure 5-8 source conditions

```text
3100 lb
Flaps UP
2400 RPM
Full throttle
Mixture set to Maximum Power Fuel Flow placard
Cowl flaps OPEN
Standard temperature
```

### Cumulative climb calculation

```text
climb time
= cumulative time(PA_target) - cumulative time(PA_start)

climb fuel
= cumulative fuel(PA_target) - cumulative fuel(PA_start)

zero-wind climb distance
= cumulative distance(PA_target) - cumulative distance(PA_start)
```

Between published altitude rows:

```text
fraction = (requested PA - lower PA) / (upper PA - lower PA)
interpolated value = lower value + (upper value - lower value) x fraction
```

### Temperature correction

```text
ISA temperature [°C]
= 15 - 2 x pressure altitude [thousand ft]

temperature above ISA
= max(0, OAT - ISA temperature)

correction factor
= 1 + temperature above ISA / 100

corrected time/fuel/distance
= standard-table result x correction factor
```

PR #24 supersedes the original zero-wind ground-distance treatment by deriving climb TAS from Figure 5-8 and applying route wind to TOC ground position.

---

## PR #23, phase-aware fuel planning

- Added `src/fuel/fuelPlanning.ts` for route-level fuel calculations.
- Cruise performance is calculated per leg using PL and route-weather OAT where available.
- Split leg time/fuel into climb, cruise, descent and circuit/activity phases.
- Added manual descent FF and circuit FF, plus manual climb FF for manual-climb mode.
- Added Manual cruise FF when POH cruise performance is disabled.
- Added editable startup/taxi/takeoff allowance, default `1.7` US gal from supplied UiT OFP v4.2.
- Added optional Fuel onboard and estimated fuel remaining.
- OFP `FF` shows cruise FF, `INT` shows complete leg fuel, `ACC` shows accumulated enroute fuel.
- Added tests for altitude-dependent cruise fuel, climb/descent fuel, circuit fuel, missing inputs and weather-temperature use.

Fuel formulas:

```text
phase fuel [gal] = FF [gal/h] x phase time [min] / 60

leg fuel
= cruise fuel + climb fuel + descent fuel + circuit/activity fuel

enroute fuel = sum(leg fuel)
trip fuel = startup/taxi/takeoff allowance + enroute fuel

fuel remaining EST_n
= total fuel onboard
- startup/taxi/takeoff allowance
- accumulated enroute fuel_n
```

PR #24 refines the phase ground-distance and displayed TAS/GS model while retaining these fuel-accounting rules.

---

## PR #22, complete C182T Figure 5-9 cruise-performance model

- Completed all supplied Figure 5-9 `CRUISE PERFORMANCE` sheets.
- Loaded sea level, 2,000, 4,000, 6,000, 8,000, 10,000, 12,000 and 14,000 ft tables.
- Loaded 2000-2400 RPM where published, including the fact that 2000 RPM is not published at 14,000 ft.
- Loaded 527 published MP / %MCP / KTAS / GPH points across ISA -20°C, ISA and ISA +20°C.
- Added exact-source and interpolation tests across low, middle and high altitude.

Figure 5-9 interpolation:

```text
fraction = (requested - lower) / (upper - lower)
interpolated value = lower + (upper - lower) x fraction
```

Interpolation order:

```text
1. manifold pressure
2. temperature offset
3. RPM
4. pressure altitude
```

ISA approximation used to match Figure 5-9 labels:

```text
ISA temperature [°C]
= 15 - 2 x pressure altitude [thousand ft]

Temperature offset = OAT - ISA temperature
```

No extrapolation is allowed. Missing high-altitude table cells are not invented.

---

## PR #21, C182T maximum-glide visualization

- Added the `C182T glide` map overlay based on supplied C182T Figure 3-1 `MAXIMUM GLIDE`.
- Preserved source assumptions: propeller windmilling, flaps up, zero wind.
- Recorded best-glide speeds: 76 KIAS at 3100 lb, 70 KIAS at 2600 lb, 58 KIAS at 2100 lb.
- Uses modeled route altitude through climb and descent.
- Does not extrapolate above 14,000 ft.

Approximation:

```text
700 ft per NM = 14,000 ft / 20 NM

glide distance [NM]
= height above assumed landing surface [ft] / 700
```

The overlay assumes a sea-level shoreline and does not model terrain, wind or landing suitability.

---

## PR #20, visual MSA corridor and manual MSA validation

- Added optional `MSA ±1 NM` route corridor.
- Added manual MSA per OFP leg and PL-below-MSA highlighting.
- Route-geometry changes clear affected manual MSA values.
- Manual MSA participates in Ctrl+Z/Cmd+Z undo.

Project rule supplied for the planner:

```text
MSA
= highest terrain or obstacle within 1 NM of route
+ 500 ft
```

```text
1 NM = 1852 m
```

---

## PR #19, drag-to-insert waypoint, undo and MSA design

- Dragging a route line inserts a waypoint between existing points.
- Existing PL on a split leg is copied to both new legs.
- Added up to 50 planner-state undo snapshots.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS restore the previous planner state.
- Added the staged MSA implementation design document.

---

## PR #18, Phase 7 documentation and status cleanup

- Updated app header and documentation for Phase 7.
- Brought README and change history in line with deployed AIP/circuit features.

---

## PR #17, Avinor AIP current-issue detection fix

- Updated the AIP updater for Avinor's current AIRAC history-page format.
- Pages builds construct the active English eAIP issue path from the detected AIRAC date.
- Deployment parsed 53 AD 2 aerodromes for AIP effective 2026-09-03. ENVR and ENBH were skipped because requested pages returned HTTP 404.

---

## PR #16, AIP aerodrome elevation and circuit planning

- Added Avinor AIP-derived field-elevation lookup by ICAO.
- Added build-time and scheduled AIP refresh.
- Added `Airport + circuits` mode with circuit count and minutes per circuit.
- Fixed automatic waypoint renumbering after deletion/reordering.
- Fixed PL-change TOD gating so a lower outbound PL never starts before the waypoint where that lower PL begins.

```text
circuit allowance [min]
= number of circuits x minutes per circuit
```

PL-change descent gating at this stage:

```text
descent time [min] = Δh / ROD
descent distance [NM] = descent GS x descent time / 60
ideal TOD = next waypoint route distance - descent distance
actual TOD = max(current waypoint route distance, ideal TOD)
```

PR #24 later replaces the fixed descent-GS assumption with descent TAS plus wind.

---

## PR #15, automatic multi-leg TOC/TOD and touch-and-go airports

- Extended vertical profiling through route altitude changes.
- Higher outbound PL creates TOC after the waypoint.
- Lower outbound PL creates descent on the outbound leg.
- Added Auto from PL, Airport/T&G and Off waypoint modes.
- Airport/T&G descends to field elevation and climbs again after the airport.
- Added multiple TOC/TOD map markers and overlap detection.

```text
time [min] = altitude change [ft] / vertical speed [ft/min]
distance [NM] = groundspeed [kt] x time [min] / 60
```

---

## PR #14, initial Phase 6 vertical profile

- Added departure/destination elevation.
- Added configurable climb/descent rates and groundspeeds.
- Added initial TOC/TOD calculation and overlap detection.

```text
climb altitude gain = max(0, initial PL - departure elevation)
descent altitude loss = max(0, final PL - destination elevation)

climb time = climb altitude gain / ROC
descent time = descent altitude loss / ROD

climb distance = climb GS x climb time / 60
descent distance = descent GS x descent time / 60
```

PR #24 later replaces the fixed-GS vertical geometry with phase TAS plus active wind when route wind data is available.

---

## PR #13, scrollable planning sidebar fix

- Prevented planning panels from shrinking vertically.
- Made the desktop planning sidebar independently scrollable.
- Added a visible thin scrollbar.

---

## PR #12, OFP rounding and resizable map

- OFP distance displayed to nearest 0.5 NM.
- WCA displayed to nearest whole degree.
- Added draggable desktop workspace height, keyboard resizing and double-click reset.

```text
displayed distance = round(exact distance x 2) / 2
displayed WCA = round(exact WCA)
```

---

## PR #11, rounded headings and Phase 5 route-weather preview

- TT, MT and MH display as normalized whole-degree headings.
- Added Open-Meteo pressure-level wind and temperature sampling.
- Added vertical interpolation by geopotential height and time interpolation between forecast steps.
- Forecast winds can feed the OFP wind triangle.

```text
lerp(a, b, t) = a + (b - a) x t
```

Wind interpolation uses vector components:

```text
u = -speed x sin(direction)
v = -speed x cos(direction)

speed = sqrt(u^2 + v^2)
wind-from direction = atan2(-u, -v)
```

---

## PR #10, OFP layout and per-leg planned altitude

- Reworked navigation log toward supplied UiT OFP layout.
- Added editable PL per leg.
- Clarified FF, INT and ACC fuel columns.
- Rounded magnetic variation to whole degrees for OFP MT/MH.

Original cruise-only fuel formula at this stage:

```text
leg fuel [gal] = FF [gal/h] x leg time [h]
accumulated fuel = sum(leg fuel)
```

PR #23 supersedes this with phase-aware fuel accounting.

---

## PR #9, WMM2025 and initial C182T cruise preview

- Added automatic WMM2025 magnetic variation at each leg midpoint.
- Added initial C182T sea-level and 2,000 ft cruise tables.
- Added bounded POH interpolation and POH-derived KTAS/GPH.
- Added above-80% MCP warning.

---

## PR #8, preserve map view while editing

- Removed automatic fit-to-route after route edits.
- Adding, dragging, renaming, deleting and reordering points preserves map center/zoom.

---

## PR #7, ICAO chart quality, caching and map sizing

- Added adaptive Avinor ICAO source raster size.
- Added Auto, Sharp and Fast chart-detail modes.
- Added AIRAC-aware service-worker cache.
- Added expanded-map mode and resize observer.

Approximate Web Mercator resolution:

```text
CSS resolution [m/px]
= 156543.03392804097 x cos(latitude) / 2^zoom
```

---

## PR #6, Norwegian map layers

- Added Kartverket topo WMTS.
- Added Avinor Norway Aeronautical Chart ICAO 1:500 000.
- Added OpenStreetMap fallback and numbered route markers.

---

## PR #5, Phase 2 wind triangle

- Added manual TAS, wind and variation inputs.
- Added WCA, TH, MT, MH, GS and leg time.

```text
relative wind = wind-from direction - TT
crosswind = W x sin(relative wind)
WCA = asin(crosswind / TAS)
TH = TT + WCA

along-track wind = -W x cos(relative wind)
GS = TAS x cos(WCA) + along-track wind

MT = TT - VAR_E
MH = TH - VAR_E

leg time [h] = D / GS
```

---

## PR #4, stacked C182T performance prototype

- Early larger-table performance prototype.
- Superseded by PR #9 and completed by PR #22.

---

## PR #3, stacked map architecture prototype

- Early configurable Norwegian map-source architecture prototype.
- Superseded/refined by PR #6 and PR #7.

---

## PR #2, stacked navigation prototype

- Early navigation/fuel/provider prototype.
- Superseded/refined by later mainline phases.

---

## PR #1, Phase 1 foundation

- Added Vite + strict TypeScript foundation.
- Added Leaflet map and editable route.
- Added great-circle distance and initial true track.
- Added basic OFP and unit tests.

Great-circle distance with Earth radius `R = 3440.065 NM`:

```text
Δφ = φ2 - φ1
Δλ = λ2 - λ1

a = sin^2(Δφ/2) + cos(φ1) x cos(φ2) x sin^2(Δλ/2)
c = 2 x atan2(sqrt(a), sqrt(1-a))
D = R x c
```

Initial true track:

```text
y = sin(Δλ) x cos(φ2)
x = cos(φ1) x sin(φ2)
    - sin(φ1) x cos(φ2) x cos(Δλ)

TT = atan2(y, x), normalized to 0..360°
```

---

## Important design principles

- Aviation calculations belong in navigation/performance/fuel/weather modules, not UI code.
- Display rounding should not reduce calculation precision.
- Do not extrapolate POH data beyond published/loaded bounds.
- Do not silently substitute cruise performance for unsupported flight phases.
- Manual overrides should remain available where appropriate.
- External data failures should produce explicit warnings or safe fallbacks, not invented values.
- AIP, weather, MSA, glide and fuel integrations are planning aids and do not replace official flight-planning sources or pilot judgement.
- Every significant calculation change should add or update automated tests.
