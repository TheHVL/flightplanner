# Flightplanner change history

This file records significant Flightplanner updates, formulas, source assumptions and known limitations. New updates are added at the top.

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

## PR #23, phase-aware fuel planning

### Added / changed

- Added `src/fuel/fuelPlanning.ts` for route-level fuel calculations.
- Cruise performance is now calculated separately for each leg instead of using one global TAS/FF result for the whole OFP.
- When POH performance is enabled, each leg uses its PL as the Figure 5-9 pressure-altitude input. If PL is blank, the Phase 4 pressure-altitude field is used as a fallback.
- If route-weather data has been fetched for the leg, its OAT is used for Figure 5-9. Otherwise the Phase 4 OAT field is used.
- Cruise TAS and cruise FF therefore change with planned altitude and available temperature.
- The Phase 6 vertical profile is used to split each leg into climb, cruise and descent portions.
- OFP leg time now combines cruise time, modeled climb time, modeled descent time and configured circuit/pattern time.
- Added manual Climb FF, Descent FF and Circuit FF inputs. These stay manual because the supplied Figure 5-9 PDF contains cruise fuel flow only.
- Added Manual cruise FF for use when POH performance is disabled.
- Added an editable startup/taxi/takeoff fuel allowance. Default is 1.7 US gal because the supplied UiT OFP v4.2 states that Trip Fuel includes 1.7 US gal for startup, taxi and takeoff.
- Added optional Fuel onboard input.
- The OFP `FF` column shows cruise FF for the leg.
- The OFP `INT` column shows total phase-aware fuel for the leg when every required phase FF is known.
- The OFP `ACC` column shows accumulated enroute fuel, excluding the startup/taxi/takeoff allowance.
- The OFP `FUEL REMAINING EST` column is populated when Fuel onboard and all required fuel inputs are available.
- Circuit fuel is now included when Circuit FF is supplied.
- Fuel settings are persisted in browser local storage.
- Added automated tests for altitude-dependent cruise fuel, climb/descent fuel, circuit fuel, missing phase FF and route-weather temperature use.

### Fuel formulas

For each modeled phase:

```text
phase fuel [gal]
= FF [gal/h] x phase time [min] / 60
```

Leg fuel:

```text
leg fuel
= cruise fuel
+ climb fuel
+ descent fuel
+ circuit/activity fuel
```

Route fuel:

```text
enroute fuel = sum(leg fuel)

trip fuel
= startup/taxi/takeoff allowance
+ enroute fuel
```

Estimated remaining fuel after leg `n`:

```text
fuel remaining EST_n
= total fuel onboard
- startup/taxi/takeoff allowance
- accumulated enroute fuel_n
```

### Phase timing

Cruise time uses the wind-corrected cruise GS for the non-vertical portion of the leg:

```text
cruise time [min]
= cruise distance [NM] / cruise GS [kt] x 60
```

Climb and descent time remain based on the Phase 6 vertical-profile assumptions:

```text
climb time [min] = Δh / ROC
descent time [min] = Δh / ROD
```

The horizontal portions assigned to climb/descent use:

```text
climb distance [NM] = climb GS x climb time / 60
descent distance [NM] = descent GS x descent time / 60
```

### Source and limitation notes

- C182T Figure 5-9 supplies cruise %MCP, KTAS and GPH, not climb/descent/circuit GPH.
- Flightplanner therefore does not substitute cruise GPH for climb, descent or circuit operation.
- PL is currently used as a pressure-altitude proxy. A later QNH-based pressure-altitude conversion should refine this.
- Phase-aware fuel depends on the current Phase 6 vertical model. Overlapping or otherwise invalid vertical profiles require review.
- Fuel settings currently live in browser local storage and are not yet part of Ctrl+Z history or future flight-plan save/load.

---

## PR #22, complete C182T Figure 5-9 cruise-performance model

### Added / changed

- Completed Phase 4 from the supplied Cessna Model 182T NAV III GFC 700 AFCS Figure 5-9 `CRUISE PERFORMANCE`.
- Loaded sea level, 2,000, 4,000, 6,000, 8,000, 10,000, 12,000 and 14,000 ft tables.
- Loaded 2000-2400 RPM where published. The 14,000 ft table does not publish 2000 RPM, and the planner preserves that limitation.
- Loaded 527 published MP / %MCP / KTAS / GPH points across ISA -20°C, ISA and ISA +20°C.
- Expanded the Performance panel to the full source range.
- Added exact-source and interpolation tests across low, middle and high altitude.

### Figure 5-9 interpolation

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

- Added the `C182T glide` map overlay.
- Based on the supplied C182T Section 3 Figure 3-1 `MAXIMUM GLIDE`.
- Preserves source assumptions: propeller windmilling, flaps up, zero wind.
- Best-glide speeds recorded from the figure: 76 KIAS at 3100 lb, 70 KIAS at 2600 lb, 58 KIAS at 2100 lb.
- Uses the modeled Phase 6 altitude through climbs and descents.
- Does not extrapolate above 14,000 ft.

Approximation of the plotted line:

```text
700 ft per NM = 14,000 ft / 20 NM

glide distance [NM]
= height above assumed landing surface [ft] / 700
```

The overlay assumes a sea-level shoreline and does not model terrain, wind or landing suitability.

---

## PR #20, visual MSA corridor and manual MSA validation

- Added optional `MSA ±1 NM` map corridor.
- Added manual MSA per OFP leg.
- Highlights PL below entered MSA.
- Route-geometry changes clear affected manual MSA values.
- Manual MSA participates in Ctrl+Z/Cmd+Z undo.

Project rule supplied for the planner:

```text
MSA
= highest terrain or obstacle within 1 NM of route
+ 500 ft
```

Waypoint caps use:

```text
1 NM = 1852 m
```

---

## PR #19, drag-to-insert waypoint, undo and MSA design

- Dragging the route line inserts a waypoint between existing points.
- Existing PL on a split leg is copied to the two new legs.
- Added up to 50 planner-state undo snapshots.
- Ctrl+Z on Windows/Linux and Cmd+Z on macOS restore the previous planner state.
- Added the MSA implementation design document.

---

## PR #18, Phase 7 documentation and status cleanup

- Updated app header and documentation for Phase 7.
- Brought README and change history in line with deployed AIP/circuit features.

---

## PR #17, Avinor AIP current-issue detection fix

- Updated the AIP updater for Avinor's current AIRAC history-page format.
- Pages builds construct the active English eAIP issue path from the detected AIRAC date.
- The deployment parsed 53 AD 2 aerodromes for AIP effective 2026-09-03. ENVR and ENBH were skipped because their requested pages returned HTTP 404.

---

## PR #16, AIP aerodrome elevation and circuit planning

- Added Avinor AIP-derived field-elevation lookup by ICAO.
- Added build-time and scheduled AIP refresh.
- Added `Airport + circuits` intermediate waypoint mode.
- Added circuit count and minutes per circuit.
- Fixed automatic waypoint renumbering after route deletion/reordering.
- Fixed PL-change TOD gating so a lower outbound PL never starts descent before the waypoint where that lower PL begins.

Circuit time:

```text
circuit allowance [min]
= number of circuits x minutes per circuit
```

PL-change descent gating:

```text
descent time [min] = Δh / ROD
descent distance [NM] = descent GS x descent time / 60

ideal TOD = next waypoint route distance - descent distance
actual TOD = max(current waypoint route distance, ideal TOD)
```

---

## PR #15, automatic multi-leg TOC/TOD and touch-and-go airports

- Extended vertical profiling through all route altitude changes.
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
- Added initial TOC/TOD calculation and route placement.
- Added vertical-profile overlap detection.

```text
climb altitude gain = max(0, initial PL - departure elevation)
descent altitude loss = max(0, final PL - destination elevation)

climb time = climb altitude gain / ROC
descent time = descent altitude loss / ROD

climb distance = climb GS x climb time / 60
descent distance = descent GS x descent time / 60
```

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

Linear interpolation:

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

- Reworked the navigation log toward the supplied UiT OFP layout.
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
