# Flightplanner — Codex project handoff

Updated: **2026-10-08**. This is a repository handoff, not an instruction to implement every proposed item. Read the root [AGENTS.md](../AGENTS.md), then inspect current code, git status and newer commits before starting work. Later explicit user instructions take precedence over this historical checkpoint.

## 1. Project and checkpoint

| Item | Detail |
| --- | --- |
| Repository | [TheHVL/flightplanner](https://github.com/TheHVL/flightplanner) |
| Manual Planner | https://thehvl.github.io/flightplanner/ |
| Separate Route Generator | https://thehvl.github.io/flightplanner/generator.html |
| Purpose | Intuitive Norwegian VFR student planning, primarily C182T; OFP and draft-route comparison |
| Stack | TypeScript, Vite, Leaflet, WMM2025 magnetic variation, proj4, GeoTIFF; static GitHub Pages |
| Storage | Browser-local working route/settings and named plans, JSON export/import; no server-side plan account |
| Latest feature checkpoint | PR [#59](https://github.com/TheHVL/flightplanner/pull/59), merge `1c6d16c5e527b561992dbcd891d4a87e22000f4c` |
| Snapshot base for this document | `f4307bd` on `main`; two subsequent automated AIP snapshot refreshes, no additional feature implementation |

Codex can work on this existing repository and existing Pages hosting. No repository ownership migration or AI feature in the planner is necessary. Root `AGENTS.md` is the concise entry point; this file holds detailed context so permanent instructions stay manageable. The user requested this handoff to carry progress, plans and preferences into future development sessions.

The generator is a **draft comparison tool**, not a complete operational route solver. `readyForAutomaticRouting` remains false. Its current checks can correctly withhold all drafts; neither test success nor a generated line establishes a usable flight route.

## 2. Settled user decisions

### Workflow and presentation

- Keep manual and automatic planning on separate pages. Do not add automatic CTR VFR procedure routing to the manual planner; individual AIP points and chart links remain useful there.
- Keep the interface intuitive for someone who has never seen it. Sidebar sequence: Build route → Prepare legs → Weather & fuel → Review OFP. Use collapsed advanced sections rather than displaying every dense panel at once.
- Airports are sorted by ICAO; reporting points are grouped by airport. Sidebar width is draggable. Dropdown text must fit and labels should be plain language, without development-stage terms such as “Phase 4”.
- Map-click/marker-drag snapping to airports and reporting points is supported. Do not restore floating snap-point name tags; the user finds them cluttered and reads names on the ICAO map.
- OFP has one selected frequency for each leg. Suggested services and channel choices belong in the sidebar. Make uncertain/overlapping coverage explicit and leave selection to the pilot.
- Departure time, ETO, ATO and actual fuel are filled in flight. Do not make them required OFP planning inputs. Intended departure **UTC date/time for weather retrieval** is a separate necessary input.
- Use “pattern”, not “circuits”, in the UI. Patterns are airport-only. Render a separate OFP row after arrival and before the next sector's thick divider. Count × minutes sets intermediate time; include fuel flow, INT fuel, ACC fuel and accumulated time, without wind/distance/TT/VAR/MT/MH/GS fields. Keep the internal `circuits` representation compatible with existing saved plans.

### Navigation, altitude and fuel

- **Direct named-waypoint course controls TT and MT, and the wind triangle controls the corresponding heading.** A hidden shaping bend changes flown distance, duration and fuel, and the drawn/sampled route, but does not create a separate OFP navigation leg. Never change TT/MT/MH to track the bend. A pilot wanting another navigation leg adds an actual waypoint.
- New manual legs and generator preferred PL default to **2,500 ft**; altitude arrows change by **100 ft**. Explicit saved values and intentional blanks must survive loading.
- Adjacent leg levels may differ for climb/descent. Investigate physically modeled profile conflicts rather than requiring all levels to match. Published MAX limits cannot be bypassed by raising cruise altitude.
- PL/elevation are pressure-altitude proxies. The user explicitly does **not** want QNH input now or later. Keep the approximation clear without promising future QNH conversion.
- Individual and total OFP distance round upward to whole NM; accumulated distance rounds to the nearest 0.5 NM. Time rounds upward to whole minutes; angles to whole degrees. Internal values retain precision.
- INT fuel rounds **each row upward** to whole US gallons. ACC adds those displayed INT values, including pattern rows and excluding startup/taxi/takeoff. Example: two exact 1.5 US gal legs display INT 2 + 2 and final ACC **4**. Exact trip/remaining-fuel consumption remains **3**. Earlier discussion was ambiguous; current implemented rule and README settle this distinction. Unknown earlier fuel makes subsequent ACC unknown.
- Reserve and contingency are separate allowances, not extra modeled consumption. Contingency remains a pilot entry per flight.

### Terrain, coverage and cost

- Manual terrain assistance is **optional**, initially collapsed, usable for one uncertain leg or an explicitly chosen whole route. Do not make it dominate manual planning or overwrite manual MSA.
- The supplied daytime school rule is at least **500 ft above the highest obstacle within 1 NM of the route**, with gliding distance to land over water. Current surface probes exclude obstacles and do not find every terrain peak. Do not call the sampled maximum a complete MSA.
- Use dataset-driven geographic routing rather than programming every northern airport pair. Keep app services cost-free for now; paid services and runtime AI planning are on hold.
- Generator selection covers mainland current-AIP airports at or north of Trondheim, including ENVA. This matches the school's southern boundary. Coverage is not all Norway; Svalbard and unsupported runway cases are excluded by current filters. At the last live check there were 29 choices; derive the list from current AIP rather than hard-coding that count.
- No unchecked straight-line fallback, unknown-height-as-zero, invented chart bends or invented restriction activation. Draft acknowledgement is required at transfer but cannot bypass blocking checks.

## 3. Aircraft preset: supplied facts versus assumptions

The school preset is explicitly applied. Loading an existing plan retains its settings until the pilot chooses to apply the preset. Do not invent the missing climb fuel flow.

| Parameter | Current setting / origin |
| --- | --- |
| Normal cruise RPM | **2200**, supplied by user |
| Cruise manifold pressure | **20 inHg**, current implementation assumption; user did not explicitly confirm this |
| Normal climb | **90 KIAS, 2400 RPM, 23 inHg**, supplied by user |
| Climb rate | User reported **500–1000 ft/min**; app uses **500 ft/min** as a planning choice within that range |
| School climb fuel flow | **Unconfirmed**; remains blank, so manual school climb cannot produce a complete trip-fuel result |
| Descent | Cruise TAS, about **18 inHg**, **10 US gal/h**, supplied by user |
| Descent rate | **700 ft/min**, implementation assumption; not explicitly supplied by user |
| Pattern fuel flow | **12 US gal/h**, supplied by user |
| Startup/taxi/takeoff | **2 US gal**, supplied school setting; generic original OFP default remains 1.7 US gal |
| Reserve | **12 US gal**, user described as standard one-hour reserve |
| Contingency | Pilot decides per flight; no automatic policy requested |

Performance sources already modeled:

- C182T NAV III GFC 700 AFCS **Figure 5-9** cruise, sea level–14,000 ft, 2000–2400 RPM, ISA −20°C to +20°C, bounded available MP combinations. No extrapolation beyond supported tables.
- **Figure 5-8** climb at 3100 lb, 2400 RPM/full throttle and stated configuration: normal 90 KIAS through 10,000 ft; maximum-rate through 14,000 ft. Use differences of cumulative time/fuel/distance, with the published 10% increase per 10°C above ISA.
- The school's **23 inHg manual climb is distinct from full-throttle POH climb**. Do not silently use one as validation of the other.
- Manual IAS-to-TAS uses approximate EAS/density at phase mean altitude, bounded −2000 to 20,000 ft after PR #59. Instrument/position/compressibility corrections are outside this approximation.

The user supplied `01-Cruise-performance.pdf` and `02-OFP-v4.2.pdf` during earlier work. They are not versioned source PDFs in the repository; a new session may need them from the user before independently reviewing table transcription or template changes. Source attribution and implemented tables are in the code. Do not make transient workspace paths a dependency or publish supplied PDFs without authorization.

Information to obtain when refining the preset: normal-climb fuel flow at the stated 90 KIAS/2400 RPM/23 inHg, confirmation of cruise MP, and whether 700 ft/min is the intended descent planning rate. Implement other independent tasks without blocking on these optional refinements.

## 4. What is implemented

### Manual planner and persistence

Grouped/ICAO-sorted AIP menus, snapping without floating names, resizable sidebar, sequential leg editing, explicit school preset, vertical modeling, patterns, single selected OFP frequencies, save/load/export/import and recoverable generator transfer exist.

Undo/Redo buttons and plan shortcuts exist. Ctrl/Cmd+Z outside editable fields undoes a plan action; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Editable controls keep native text undo and focus. History includes route bends and the relevant MSA/forecast state; a new action clears redo.

Autosave status exposes failures. Corrupt working-route data are retained for download and backed up before replacement; failed backup pauses autosave. Optional preferences tolerate unavailable storage. Fuel edits stay available in memory and exports on storage failure. Named-plan loading requires its persistence step to succeed before replacing the active route. Preserve recovery and existing saved-plan formats.

### Weather

Open-Meteo route forecasts batch up to 50 leg midpoint coordinates per request, using eight pressure levels and 32 hourly variables. Larger routes use bounded batches. Explicit fetch bypasses caching; each batch has a 45-second timeout. Wind vectors interpolate locally in altitude/time and flight order; earlier wind-adjusted durations affect subsequent times.

Source, valid time, retrieval time and **Best Match** selection are stored. Actual underlying model name/run timestamp are **unknown**, not fabricated. Retrieval age is not model-run age; `generationtime_ms` is response-generation duration. A two-hour review reminder appears while open/after returning to the tab; it is an app reminder, not a validity guarantee. Age never silently changes winds.

Outside available forecast altitude coverage, the nearest level is used with `altitudeClamped`/sampled altitude and visible Weather/OFP notices when active. With per-leg route winds enabled, priority is forecast → manual leg backup → global manual wind. Saved forecasts are deliberately not restored on reuse; fetch for the new date/time. Route/profile/date/time changes cancel stale async results.

### AIP and frequencies

Deployment/daily refresh resolves the effective Avinor AIP edition, validates sources and keeps the previous verified snapshot if refresh fails. Data/status JSON are committed by the workflow. UI checks expose refresh failures or verification older than 48 hours. Saved waypoint coordinates are not silently relocated when AIP changes.

Reviewed VFR definitions in `scripts/aip/verified-vfr-routes.json` require matching chart checksums and resolvable points. Changed charts withhold old structured edges pending review. ENDU/ENTC have partial reviewed sequences; ENSR directions/altitudes remain unresolved. These are not full chart tracks or verified airport joins. ICAO map publication is a separate source.

Frequency suggestions use verified terminal/ATS coverage and modeled altitude. Polaris ATS sectors are distinct from controlled-airspace restrictions. The pilot selects the OFP channel; no claim is made that ambiguous suggestions are assigned/cleared frequencies. NOTAM, AIP SUP and live restriction activation are not imported.

### Terrain, generator and airspace

Manual/independent point checks use Kartverket heights on the plotted route, including bends, at ≤0.5 NM station spacing with five lateral probes across ±1 NM. WGS84 lateral offsets and a 1 cm API-rounding inset keep probes within the modeled strip. The complete rounded corridor is visible, but point probes are **not** its continuous maximum. Missing data stay unknown; water depth is replaced by sea surface. Result fetch time is not terrain survey age.

Generator WCS raster search normally downloads **100 m source samples**, max-pooling four returned heights into **200 m search cells**. Larger windows report coarser resolution to bound memory. This is still nearest-neighbour sampled output, **not the maximum of native 1 m DTM**. Missing subpixels leave cells unknown; unexpected projection/format/geometry fails. Draft cards and map previews show resolution and “peaks may be higher”. Three concurrent requests and 45-second timeouts limit downloads.

The terrain router searches a 1 km geographic graph with neighbouring-cell terrain maxima, a 500 ft review margin and altitude/profile constraints. It considers terminal combinations, then independent point-height review of a bounded shortlist. Airport-adjacent samples are distinguished for departure/arrival review but do not establish approach safety. Source gaps, terrain/profile conflicts and incomplete restriction coverage block transfer.

Restriction search conservatively avoids imported ENR 5.1 footprints **at all altitudes and activation states**, with 250 m search allowance. All activations remain unknown. This may exclude usable inactive/overflyable areas; failure messages say so. Modeled terminal-volume intersections split geometry and AMSL boundaries; FL/AGL and unknown limits require review. Controlled-airspace encounters are clearance/review notices, not automatically prohibited. No robust complete 3D/activation engine is claimed.

The generator has ordered visits (up to four), touch-and-go/pattern choices, lesson duration and up to three ranked drafts. It estimates using still air/ISA and preferred level; it does not invent extra holding, patterns or ground time to fill a lesson. Explicit transfer stages a session token, preserves previous manual work through recovery, and leaves named saved plans unchanged. Transferred routes have no invented MSA, frequency or weather.

The optional C182T zero-wind glide overlay approximates height/700 to 14,000 ft above assumed landing surface. Coarse Natural Earth 1:10m coastline omits small-island/detail geometry. It does not identify suitable landing sites or establish clearance.

### Maintenance improvements in PR #59

User-facing phase labels and future-QNH promises were removed; CSS renamed to performance/verticalProfile/weather. Negative pressure altitude is supported within the documented approximation bounds. `main.ts` was reduced to about 512 lines through workspace/history/status/preferences extraction. Direct DOM/string-template architecture **still exists**; no reactive framework rewrite has been completed.

CI now includes source lint, unit tests, TypeScript/build, Chromium smoke tests and axe checks. Production builds inject a CSP meta tag with explicit current provider allowances, Leaflet inline styles and GeoTIFF worker/WASM allowances. A meta CSP cannot enforce `frame-ancestors`; static hosting remains relevant when changing security policy.

## 5. Verification and open findings

The following are **historical results for the feature checkpoint**, not fresh tests performed by writing this handoff:

- PR #59: **266 unit tests across 53 files**, source lint and TypeScript/Vite build passed.
- GitHub CI: manual default/undo/redo/autosave browser smoke check plus manual-page and generator-page axe checks passed. This is bounded Chromium coverage, not a comprehensive accessibility or operational audit.
- Live manual check: ENDU→ENTC new leg 2500 ft; ArrowUp 2600; Undo 2500; Redo 2600; native field undo did not trigger plan undo; 2600 survived reload.
- PR #58 geodesy regression: 1255 probes on ENDU→ENTC, ENTC→ENSR and a bent ENDU→ENTC route remained within 1852 m of the modeled route. This verified probe placement, not missing peaks/obstacles.
- Live generator ENDU→ENTC, preferred 2500 ft, 45-minute lesson, no visits: real WCS loaded at 100 m source/200 m search spacing; independent review returned 1653 probes. **All drafts remained blocked** by terrain/published-MAX conflicts and one missing height. A reported controlling sample was about 2911 ft; an ANSNES→RYA MAX-2500 segment also conflicted with its modeled level. Transfer and acknowledgement stayed disabled as intended.

**Routing quality is the principal unresolved practical issue.** Do not describe the last live run as a successful usable itinerary. Determine which failures reflect genuine terrain/ceiling conflicts, incomplete terminal geometry, conservative search constraints or missing-source responses. Re-run against the current AIP; old results are not a timeless fixture.

Other remaining limitations: partial terminal chart/airport/runway geometry; coarse terrain with omitted peaks; no obstacle maxima; no live activation/NOTAM; still-air generator estimates; bounded search/shortlist may miss suitable routes; preset assumptions need confirmation; DOM coupling remains. Passing all current tests does not remove these limitations.

## 6. Proposed roadmap — not yet authorized implementation

| Priority | Proposed work | Completion evidence |
| --- | --- | --- |
| 1 | Diagnose the blocked ENDU–ENTC example, missing-height responses and terminal/profile conflicts | Reproducible current-source diagnostic; controlling leg/sample/limits clearly identified; focused regressions; live comparison with explanation of any remaining blocks |
| 2 | Expand source-reviewed terminal geometry and northern coverage, starting ENDU/ENTC then unresolved ENSR | Chart-backed directional geometry/joins/limits with checksum provenance; no invented transitions; changed publication withholds old geometry |
| 3 | Improve dataset-driven route choice and terrain evidence | Benchmark several northern itineraries; assess valleys/coast/landmark costs and better sampling/maxima policy; visible source/resolution/unknown coverage; no reduced review threshold to force acceptance |
| 4 | Refine the school aircraft preset | Confirm climb FF, cruise MP and descent rate; preserve explicit application, saved inputs and distinction between school/POH climb |
| 5 | Test first-time-user workflow and polish targeted menus/warnings | Observe a short planning task; fix concrete discoverability/overflow/keyboard issues without adding dense panels |
| 6 | Incrementally decouple state, effects and DOM rendering | Small modules and behavioral regressions; evaluate a lightweight reactive approach only where it fixes demonstrated desynchronization; avoid a wholesale rewrite |
| Later | More precise complex airspace, authoritative activation/obstacles/NOTAM and generator winds | Verified source availability/permissions, explicit unknowns and bounded behavior; keep cost constraints and no-QNH decision |
| On hold | Runtime AI route planning, paid services and full operational automatic MSA | Revisit only if user changes scope; current drafts remain review aids |

These priorities consolidate the discussion; they are not the missing numbered proposals from earlier chats. Do not assume old “point 1/2/3” messages define new work without their actual proposal.

**Suggested first Codex task:** investigate the known generator example without changing behavior first. Record selected terminal chains, profile levels, raster/point-source coordinates, missing-response cause and blocking notices. Separate data/geometry gaps from real constraints. Propose the smallest source-backed fix, then implement within the user's chosen scope. Never bypass MAX limits, turn missing data into zero, remove the 500 ft reference or let acknowledgement override transfer blocks merely to obtain a green draft.

## 7. Code map and source documents

| Area | Starting files |
| --- | --- |
| Entrypoints/build | `index.html`, `src/main.ts`, `generator.html`, `src/generator.ts`, `vite.config.ts` |
| Plan/history/shape | `src/flightplan/FlightPlanStore.ts`, `RouteShapeController.ts`, `workingRoutePersistence.ts`, `savedPlans.ts`; `src/components/PlanningHistory.ts` |
| Sidebar/OFP/persistence UX | `src/components/PlanningWorkflow.ts`, `SequentialLegPanel.ts`, `OFPTable.ts`, `RouteReviewPanel.ts`, `WorkingRouteStatus.ts`, `WorkspaceLayout.ts`, `legEditorEvents.ts`; `src/utils/panelMarkup.ts` |
| Performance/fuel/rounding | `src/performance/schoolPreset.ts`, `cruisePerformance.ts`, `climbPerformance.ts`, `airspeed.ts`; `src/fuel/fuelPlanning.ts`; `src/presentation/planningRounding.ts` |
| Navigation/profile/MSA | `src/navigation/geodesy.ts`, `verticalProfile.ts`, `verticalConflicts.ts`, `msaCorridor.ts`, `wind.ts`, `magneticVariation.ts` |
| Weather | `src/weather/openMeteo.ts`, `forecastFreshness.ts`; `src/components/WeatherPanel.ts` |
| AIP/frequencies | `src/aip/aerodromes.ts`, `mapPoints.ts`; `src/frequencies/catalog.ts`, `routeFrequencies.ts`, `FrequencyPlanner.ts` |
| Routing/terrain/airspace | `src/routing/terrain.ts`, `terrainRaster.ts`, `terrainRouter.ts`, `airspace.ts`, `restrictions.ts`, `vfrInputs.ts`, `northernAirports.ts`, `issues.ts` |
| Generator | `src/generator/candidates.ts`, `model.ts`, `review.ts`, `transfer.ts`, `GeneratorPage.ts`, `GeneratorMap.ts`, `terrainSummary.ts` |
| Data refresh | `scripts/update-aip-aerodromes.mjs`, `scripts/update-aip-frequencies.mjs`, `scripts/aip/verified-vfr-routes.json`; four `public/aip-*.json` snapshots/status files |
| Verification/deployment | `package.json`, `tests/`, `e2e/`, `playwright.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml` |

More detailed repository references: [README](../README.md), [automatic planner data](AUTOMATIC_PLANNER_DATA.md), [AIP data](AIP_DATA.md), [MSA implementation plan](MSA_IMPLEMENTATION_PLAN.md). Older proposals in those files are not proof of implemented capability; verify current code and source access before relying on them.

## 8. Setup, tests and release workflow

Use **Node 22**, npm and the committed lockfile:

```sh
npm ci
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run dev
```

Dev manual page: `http://localhost:5173/flightplanner/`; generator: `http://localhost:5173/flightplanner/generator.html`. Browser tests use Vite preview on 4173 and the same `/flightplanner/` base. Keep the base and two HTML build entrypoints. The production CSP is injected on build, so inspect preview/production as well as the dev server after provider changes.

Poppler (`pdftotext`) is needed by AIP publication extraction. Explicit refresh commands are `npm run aip:update` and `npm run aip:frequencies`; they use external sources and can modify checked-in snapshots. Use reviewed current publication checksums, not speculative edits to imported points or limits.

CI runs on pushes/PRs: lint, unit tests and build, plus a separate Chromium/axe job with browser dependencies installed and failure artifacts retained. If a local environment cannot download Chromium, say so and inspect the actual CI browser result; do not disable checks or report a local pass.

Pages workflow runs on `main`, manual dispatch and daily **04:17 UTC** schedule. It refreshes both AIP datasets, reports failures, retains verified snapshots on failure, tests/builds and deploys `dist`. The bot may add snapshot commits while a feature is in review. Recheck base/head before merging and preserve those commits. The workflow uses a shared Pages concurrency group, so a newer run may cancel an older one.

For code changes, run appropriate checks and inspect representative UI flows. For routing/performance/persistence changes, add focused meaningful regressions. For docs-only changes, validate file references and `git diff --check`; do not pretend behavioral tests were rerun. Distinguish local work, open PR, merge, CI result, Pages deployment and live verification in reports. A passed PR check alone does not prove the live site uses that commit.

## 9. Keeping the handoff useful

After meaningful development, update the date, feature/data checkpoint, completed items, remaining issues and verification evidence here. Record changed behavior and source limitations, not every tool invocation. Move proposed work to completed only after implementation/verification, and distinguish confirmed aircraft values from assumptions. Keep root `AGENTS.md` concise and avoid duplicating this entire document there.

Suggested opening prompt in a new Codex session:

> Read AGENTS.md and docs/CODEX_HANDOFF.md. Inspect current main and report what has changed since the checkpoint. Start by investigating the blocked ENDU–ENTC generator example and propose the smallest source-backed improvement. Preserve all settled navigation, terrain, UI and saved-plan requirements.
