# Flightplanner

Browser-based VFR planning for Norwegian flight training, primarily using the Cessna 182T.

- [Manual Planner](https://thehvl.github.io/flightplanner/)
- [Route Generator](https://thehvl.github.io/flightplanner/generator.html), a separate page for comparing draft routes

Development continuity: [Codex handoff, status and proposed roadmap](docs/CODEX_HANDOFF.md), with concise repository instructions in [AGENTS.md](AGENTS.md).

> Training and planning aid. Check the aircraft POH/AFM, current official AIP, NOTAM, weather briefing, mass and balance, operational procedures and applicable requirements. A modeled route or absence of warnings does not establish operational suitability. Each page requires acknowledgement before use.

## Manual planning workflow

The sidebar follows four steps. Saved plans and aircraft defaults sit below them. Drag the divider beside the sidebar to adjust its width; open menus and entered values are preserved when panels update.

1. **Build route:** add waypoints on the map or from the airport/reporting-point browser. Airports are ordered by ICAO and reporting points grouped by airport. Map clicks and marker drags can snap to published points without floating name labels. Drag a numbered waypoint handle with a mouse or touch to reorder it, or use its ↑ / ↓ buttons. Click a route line and choose **Add waypoint here** to insert between its endpoints, or **Prepare this leg** to edit it. Rename or delete waypoints, and use undo for recent changes.
2. **Prepare legs:** edit each leg's PL (new legs start at 2,500 ft), manual MSA, wind backup and OFP frequency. The OFP shows one selected channel; alternatives stay in the sidebar. Enter advances through leg fields and Shift+Enter goes backwards. Altitude arrows use 100 ft increments.
3. **Weather & fuel:** set the intended flight date/time in UTC, fetch fresh route winds, review performance assumptions and enter fuel onboard, reserve and contingency as needed.
4. **Review OFP:** inspect the navigation log, TOC/TOD and airport/pattern settings. **Optional terrain & airspace check** starts collapsed. Use **Check terrain for this leg** beside the PL/MSA fields when reviewing a particular leg, or choose **Whole route** inside the tool. Results show sampled terrain heights and modeled altitude margins without changing your MSA. Airspace checks and map findings are separate opt-in options; detailed notices stay collapsed until opened. Red indicates a conflict; amber indicates incomplete data or a review requirement.

Departure time, ETO, ATO and actual fuel remain in-flight entries rather than required planning inputs.

The working plan is autosaved locally. Named plans can be saved, loaded and exported/imported as JSON. Saved plans retain manual wind backups and planning inputs, but fetched forecasts are deliberately not restored: choose the new flight date and fetch again. Browser storage is local to the browser/device; exporting a plan provides a portable copy. Undo and Redo buttons cover recent planner actions, including route bends. Ctrl+Z/Cmd+Z and Ctrl+Shift+Z/Cmd+Shift+Z (or Ctrl+Y) work outside text fields; editing fields retain native text undo. Autosave status reports failures. Damaged working-route data are retained, offered for download and copied locally before any replacement; a failed recovery copy pauses autosave. Optional layout preferences fall back when storage is denied. Fuel edits remain available in memory and exports if their local save fails, with a visible reminder before closing.

### Map and navigation

- Kartverket Norgeskart and Avinor ICAO 1:500 000 layers.
- Great-circle distance and initial true track, wind triangle, WCA, headings, groundspeed, and WMM2025 magnetic variation with manual overrides.
- One draggable shaping bend per leg. It changes flown distance, time and fuel without adding an OFP fix; TT/MT/MH still use the direct waypoint-to-waypoint course. Add an actual waypoint when you want a separate navigation leg.
- Airport-to-airport route sectors use different line colors through their intermediate waypoints. The next color starts on departure from the next identified airport, including return visits. **Airport routes** on the manual map lists the sectors; red/amber overlays still identify review findings.
- The manual and generator maps draw densified great-circle sections matching route distance and terrain sampling. Terrain cross-sections follow the local path tangent; this does not change OFP tracks or headings.
- Optional ±1 NM MSA inspection corridor, including shaped legs. Lateral terrain offsets use WGS84 ellipsoidal distances with a 1 cm inset for API coordinate rounding. Terrain is point-sampled, so peaks between probes and obstacles remain outside the check. MSA is entered by the pilot; PL below entered MSA is highlighted.
- Optional C182T zero-wind glide and coarse coastline screening. The Figure 3-1 approximation is height above the assumed landing surface divided by 700, bounded at 14,000 ft. It assumes a sea-level shoreline and does not establish terrain clearance or a suitable landing site. The bundled Natural Earth 1:10m coastline can omit small islands and fine shoreline detail.

### Vertical profile and patterns

At an ordinary waypoint, an increase in outbound PL starts climbing after the waypoint; a decrease is reached before the waypoint. Transitions can span multiple legs. Airport/T&G behavior descends to field elevation and climbs again on departure. Unachievable or overlapping transitions produce diagnostics rather than an invented complete fuel result.

Patterns can only be assigned to identified airport waypoints. **Airport + pattern** adds a count and minutes per pattern. The OFP places a separate pattern row after arrival and before the solid airport separator. That row shows fuel flow, INT fuel, ACC fuel, intermediate time and total time; navigation/wind columns remain blank. Patterns are a time/fuel allowance, not a simulated rectangular flight path. The nominal pattern-height reference is 1000 ft AGL and does not override charted route ceilings.

## Aircraft and fuel assumptions

**Aircraft & defaults → Cruise power & aircraft defaults** contains an explicit **School C182T preset** button. The Route Generator has its own explicit preset option. Applying it changes the current planning assumptions; loading an existing plan preserves that plan's settings until the preset is applied.

| Item | School preset |
| --- | --- |
| Cruise | 2200 RPM / 20 inHg, using the POH cruise table |
| Climb | 90 KIAS, manual 500 ft/min; 2400 RPM / 23 inHg reference |
| Climb fuel flow | Must be entered; not yet confirmed |
| Descent | Cruise TAS, manual 700 ft/min, 10 US gal/h; approximately 18 inHg reference |
| Pattern | 12 US gal/h |
| Startup/taxi/takeoff | 2 US gal |
| Reserve | 12 US gal |
| Contingency | Enter per flight; no automatic policy |

The selected 500 ft/min climb is within the supplied 500–1000 ft/min range. Climb IAS is converted approximately to TAS using density at the mean phase altitude, treating IAS as EAS. This approximation omits instrument/compressibility corrections and is not a replacement for aircraft performance verification. The school 23 inHg climb is distinct from the POH full-throttle climb profiles.

### Published performance models

- **Cruise:** C182T NAV III GFC 700 AFCS Figure 5-9, sea level through 14,000 ft; published 2000–2400 RPM combinations; ISA −20°C through ISA +20°C. Interpolation is bounded by the available altitude/RPM/temperature/manifold-pressure tables. Unsupported settings produce an incomplete calculation; there is no extrapolation.
- **POH climb:** Figure 5-8 at 3100 lb, 2400 RPM, full throttle and the stated configuration. Normal 90 KIAS climb is published through 10,000 ft; maximum-rate climb through 14,000 ft. Time, fuel and zero-wind distance use differences in cumulative table values, increased by 10% per 10°C above ISA. Average climb TAS comes from table distance/time; active leg winds determine ground distance.
- **Manual climb/descent:** editable rates and speed modes. Descent and pattern fuel flows are planning inputs; manual climb requires its own fuel flow.

Leg PL is currently used as a **pressure-altitude proxy**, with the aircraft altitude setting as fallback. This remains an approximation; no QNH input is planned. Fetched leg temperature is used where available; manual OAT is the fallback. Unsupported performance settings or vertical conflicts withhold a complete result.

### Fuel accounting and rounding

Internal phase, trip and remaining-fuel calculations retain full precision:

```text
phase fuel = fuel flow × phase minutes / 60
POH climb fuel = corrected cumulative table difference
leg fuel = climb fuel + cruise fuel + descent fuel
enroute fuel = sum of leg fuel + pattern fuel
trip fuel = startup/taxi/takeoff + enroute fuel
trip + reserve + contingency = trip fuel + reserve + entered contingency
remaining fuel = onboard − startup/taxi/takeoff − exact accumulated consumption
```

Reserve and contingency are allowances outside modeled trip consumption. The original OFP template's 1.7 US gal ground allowance remains the generic editable default; the school preset applies 2 US gal.

**INT fuel rounds each row upward to whole US gallons. ACC fuel adds those displayed INT values**, including pattern rows, and excludes startup/taxi/takeoff. For two exact 1.5 US gal legs, INT shows 2 and 2, and ACC shows 2 then **4**. Exact consumption remains 3 US gal for trip and remaining-fuel calculations. If an earlier row's fuel is unknown, subsequent ACC fuel remains unknown.

Displayed planning times round upward to whole minutes. Leg distance rounds down when its fractional NM is below **0.3**, otherwise up. ACC distance and total add those displayed whole-NM legs, with no decimals: **5.7 → 6**, **7.2 → 7**, **ACC → 13 NM**. Exactly 0.3 rounds up; a leg shorter than 0.3 NM displays 0. Headings and WCA use whole degrees. Navigation, time, fuel and terrain calculations retain exact distances.

## Route weather

[Open-Meteo's Forecast API](https://open-meteo.com/en/docs) supplies pressure-level winds and temperature. No API key or paid backend is required for the current non-commercial setup.

A route fetch sends all leg midpoint coordinates in one request for up to 50 legs, with bounded batches for larger routes. Each request retrieves temperature, wind speed/direction and geopotential height at eight pressure levels (1000, 925, 850, 700, 600, 500, 400 and 300 hPa). The 32 variables support altitude interpolation; batching reduces HTTP calls rather than removing required atmospheric data. An explicit refresh bypasses browser caching.

Requested altitudes outside the available forecast levels use the nearest returned level, with a visible warning in Weather and above the OFP when those winds are active. The sampled altitude is retained alongside the requested altitude. Series are sampled locally in flight order, interpolating wind vectors in altitude and time. Earlier wind-adjusted leg durations affect subsequent estimated times. The forecast window covers the departure UTC date and following date; times outside returned coverage fail explicitly. This remains an estimate at each leg midpoint/PL, not a full four-dimensional weather integration.

Each fetched forecast records source, valid date/time, retrieval time and **Best Match** automatic model selection. The response does not report the selected underlying model name or model-run timestamp; these are stored as unknown. `generationtime_ms` is response-generation duration, not a model initialization timestamp. Retrieval age is therefore **not model-run age**.

The weather panel shows retrieval age and reminds the user to refresh after two hours, or when retrieval time is unknown. The reminder updates while the page remains open and after returning to the tab; active stale forecasts also produce a notice above the OFP. Two hours is an application review reminder, not a meteorological validity guarantee. Winds are not silently changed as they age.

With **Use per-leg route winds in calculations** enabled, priority is:

1. Fetched forecast for the leg.
2. Saved manual leg wind backup.
3. Global manual wind.

With the option disabled, global wind is used. Manual directions are FROM true north in knots. Changing flight time/PL invalidates relevant fetched forecasts; a changed route or request setting cannot apply an old pending response. A failed refresh clears forecasts and retains manual backups. Reusing a saved plan always requires fresh forecasts.

## Published aviation data

The deployed AIP snapshot comes from [Avinor's public eAIP](https://aim-prod.avinor.no/no/AIP/). It includes aerodromes, elevations, runways, frequencies, extractable chart reporting points, reviewed VFR point sequences and imported restriction volumes. Coverage and source provenance are displayed; extraction is not complete at every airport.

GitHub Pages checks **daily at 04:17 UTC**, on main deployments and by manual workflow dispatch. It resolves today's effective edition, verifies the import and preserves the last successful snapshot if a refresh fails. Edition/fetch failures and verification older than 48 hours produce warnings. Changed chart checksums withhold previously reviewed route definitions until reviewed again. Existing saved-plan coordinates are not silently moved by a publication update.

Per-leg ATS/Polaris suggestions use published coverage and modeled altitude when verified data supports a selection. Ambiguous or missing coverage is presented for review; the user chooses the OFP channel. This does not establish which service is operationally appropriate or available at the flight time.

AIP refreshes do not ingest NOTAM, restriction activation or AIP SUP. AIP publication and ICAO basemap editions are separate. See [AIP data lifecycle and coverage](docs/AIP_DATA.md).

## Separate Route Generator

Choose departure, destination, up to four ordered airport visits, patterns, lesson duration and preferred altitude. Airport selection currently covers mainland AIP aerodromes at or north of Trondheim, including ENVA. Preferred altitude starts at 2,500 ft. Terrain search normally fetches 100 m samples and retains the highest of four per 200 m search cell, with coarser resolution for larger itineraries. Every draft and its map preview show the resolution and warn that peaks may be higher. This is not a maximum of the native 1 m terrain model. It compares up to three drafts using reviewed terminal point sequences and a free Kartverket terrain graph between airports; there is no manually maintained airport-to-airport route table or AI service.

The search uses coarse route-window terrain rasters, conservative restrictions avoidance and subsequent sampled terrain/profile checks. Missing verified restriction coverage, terrain coverage or detected blocking conflicts prevent transfer. Charted MAX limits constrain terminal levels; raising cruise altitude cannot override them. Airport joins, full curved chart geometry, obstacles, NOTAM/activation, finer terrain peaks and operational route suitability remain incomplete. A usable route may exist outside the bounded search. Generator calculations use still air; fresh weather is fetched in Manual Planner after transfer.

Generation and preview keep manual planning separate. **Use this route in Manual Planner** requires acknowledgement that the draft is a starting point for chart review, not a cleared route, and explicitly transfers it, preserving recovery of the preceding working plan. It does not invent MSA, selected frequencies or forecast winds. See [automatic planner data and limitations](docs/AUTOMATIC_PLANNER_DATA.md) for search resolutions, coverage, source checks and remaining work.

## Development and deployment

Requirements: Node.js 22+, npm and, for AIP chart extraction, Poppler (`pdftotext`, provided by `poppler-utils` on Ubuntu).

```bash
npm ci
npm run dev
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vite builds both `index.html` and `generator.html`. GitHub Actions lints, unit-tests, builds and runs Chromium workflow and automated accessibility checks; the Pages workflow refreshes aviation data, tests, builds and deploys main. Failed upstream refreshes retain the verified snapshot with visible status rather than replacing it with partial data.

To refresh the committed data manually:

```bash
npm run aip:update
npm run aip:frequencies
npm test
npm run build
```

Production HTML includes a Content Security Policy limiting scripts, connections, images and workers to the application and its known data providers. Inline styles remain allowed for Leaflet; WebAssembly decoding and blob workers are allowed for terrain rasters. The GitHub Pages meta policy cannot enforce frame-ancestors, which requires response headers.

No private API keys or credentials belong in this repository.

| Directory | Responsibility |
| --- | --- |
| `src/flightplan/` | Planning state, undo, working draft, named plans and transfer |
| `src/components/` | Sidebar workflow, leg editing, review panels and OFP |
| `src/navigation/` | Geodesy, wind, magnetic variation, vertical profile, MSA/glide geometry |
| `src/performance/` and `src/fuel/` | Published performance, school preset and fuel accounting |
| `src/weather/` | Batched forecasts, interpolation and retrieval-age checks |
| `src/aip/` and `src/routing/` | Publication inputs, frequency/airspace/terrain checks and route search |
| `src/generator/` | Separate generator form, draft comparison and transfer |
| `src/map/` | Leaflet overlays and chart handling |
| `src/presentation/` | Display rounding and actionable notices |
| `scripts/` and `public/` | Importers, reviewed manifests and deployable source snapshots |
| `tests/` and `docs/` | Regression tests, assumptions, data coverage and design notes |

[CHANGELOG.md](CHANGELOG.md) records individual changes. [MSA implementation plan](docs/MSA_IMPLEMENTATION_PLAN.md) explains the remaining terrain/obstacle requirements for a complete automatic MSA.
