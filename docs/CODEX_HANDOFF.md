# Flightplanner — Codex project handoff

Updated: **2026-10-10**. This is a repository handoff, not an instruction to implement every proposed item. Read the root [AGENTS.md](../AGENTS.md), then inspect current code, git status and newer commits before starting work. Later explicit user instructions take precedence over this historical checkpoint.

## 1. Project and checkpoint

| Item | Detail |
| --- | --- |
| Repository | [TheHVL/flightplanner](https://github.com/TheHVL/flightplanner) |
| Manual Planner | https://thehvl.github.io/flightplanner/ |
| Shelved Route Generator | Former `generator.html` URL redirects to manual planning; [backup/restoration guide](../archive/route-generator/README.md) |
| Purpose | Intuitive Norwegian VFR student planning, primarily C182T; manual route preparation and OFP |
| Stack | TypeScript, Vite, Leaflet, WMM2025 magnetic variation, proj4, GeoTIFF; static GitHub Pages |
| Storage | Browser-local working route/settings and named plans, JSON export/import; no server-side plan account |
| Feature checkpoints | PR [#59](https://github.com/TheHVL/flightplanner/pull/59), merge `1c6d16c5e527b561992dbcd891d4a87e22000f4c`; waypoint editing/readability `77f41e0`; sidebar/map-click fixes `a396403`; sidebar-to-page scrolling follow-up described below |
| Original handoff snapshot | `f4307bd` on `main`, after two automated AIP refreshes following PR #59; subsequent docs/data commits do not change application behavior |
| User-requested releases | Distance/editing/readability `77f41e0`, sidebar/map-click fixes `a396403`, scrolling `43b398e` and generator diagnosis/sea correction `ae4a057`: CI and Pages succeeded. Latest starting data checkpoint `bf365e3`. Subsequent user decision shelves the generator; see verification below and inspect Git/Actions for current publication status |
| Generator backup | Annotated tag `backup/route-generator-2026-10-10` preserves full pre-shelving project at `bf365e3b5ee87e7fb852d7ac57c7a2b2b7469c57`; original entrypoint in `archive/route-generator/`, implementation/tests retained |

Codex can work on this existing repository and existing Pages hosting. No repository ownership migration or AI feature in the planner is necessary. Root `AGENTS.md` is the concise entry point; this file holds detailed context so permanent instructions stay manageable. The user requested this handoff to carry progress, plans and preferences into future development sessions.

**Current product decision, 2026-10-10:** the user shelved automatic planning because the tested ENDU–ENTC suggestions were not useful. Remove it from the normal interface and preserve a restorable code backup. Focus development on manual planning. Do not reactivate generator UI or pursue its routing roadmap without a new user request. The retained generator was a draft comparison tool; `readyForAutomaticRouting` remains false and no useful/operational automatic routing is claimed.

## 2. Settled user decisions

### Workflow and presentation

- Manual planning is the released interface. The generator is shelved with a code backup; its old URL redirects to manual planning. This supersedes the earlier two-active-page requirement. Do not add automatic CTR VFR procedure routing to the manual planner; individual AIP points and chart links remain useful there.
- Keep the interface intuitive for someone who has never seen it. Sidebar sequence: Build route → Prepare legs → Weather & fuel → Review OFP. Use collapsed advanced sections rather than displaying every dense panel at once.
- Airports are sorted by ICAO; reporting points are grouped by airport. Sidebar width is draggable. Dropdown text must fit and labels should be plain language, without development-stage terms such as “Phase 4”.
- Keep waypoint-list/sidebar scroll position during editing, including deletion. The list's bottom resize handle supports mouse/touch and keyboard height adjustment, with double-click reset. Remember the height as an optional UI preference, separate from plan data and history.
- With the pointer over the sidebar, vertical scrolling should continue to the page/OFP once the nested list and sidebar reach their edge. Keep native scrolling while either still has room to scroll.
- Map-click/marker-drag snapping to airports and reporting points is supported. Do not restore floating snap-point name tags; the user finds them cluttered and reads names on the ICAO map.
- OFP has one selected frequency for each leg. Suggested services and channel choices belong in the sidebar. Make uncertain/overlapping coverage explicit and leave selection to the pilot.
- Departure time, ETO, ATO and actual fuel are filled in flight. Do not make them required OFP planning inputs. Intended departure **UTC date/time for weather retrieval** is a separate necessary input.
- Use “pattern”, not “circuits”, in the UI. Patterns are airport-only. Render a separate OFP row after arrival and before the next sector's thick divider. Count × minutes sets intermediate time; include fuel flow, INT fuel, ACC fuel and accumulated time, without wind/distance/TT/VAR/MT/MH/GS fields. Keep the internal `circuits` representation compatible with existing saved plans.

### Navigation, altitude and fuel

- **Direct named-waypoint course controls TT and MT, and the wind triangle controls the corresponding heading.** A hidden shaping bend changes flown distance, duration and fuel, and the drawn/sampled route, but does not create a separate OFP navigation leg. Never change TT/MT/MH to track the bend. A pilot wanting another navigation leg adds an actual waypoint.
- New manual legs default to **2,500 ft**; altitude arrows change by **100 ft**. Explicit saved values and intentional blanks must survive loading. The retained generator source keeps its existing default.
- Adjacent leg levels may differ for climb/descent. Investigate physically modeled profile conflicts rather than requiring all levels to match. Published MAX limits cannot be bypassed by raising cruise altitude.
- PL/elevation are pressure-altitude proxies. The user explicitly does **not** want QNH input now or later. Keep the approximation clear without promising future QNH conversion.
- **Confirmed 2026-10-09:** leg distance rounds down when its fractional NM is below 0.3, otherwise up. ACC distance and route total add those displayed whole-NM legs, with no decimals: 5.7 → 6, 7.2 → 7, ACC → 13 NM. Exactly 0.3 rounds up. This supersedes the earlier upward-only leg and nearest-0.5-NM ACC convention. Time rounds upward to whole minutes; angles to whole degrees. Internal values retain precision.
- Numbered waypoint handles support mouse/touch drag reordering with edge scrolling; arrow buttons remain available. Clicking a plotted leg offers insertion between its endpoints and leg preparation. Dragging the line still shapes it. Airport-to-airport sectors change map color at each identified airport visit, preserving that color through intermediate points. Sidebar controls/help should remain readable and wrap on narrow screens.
- INT fuel rounds **each row upward** to whole US gallons. ACC adds those displayed INT values, including pattern rows and excluding startup/taxi/takeoff. Example: two exact 1.5 US gal legs display INT 2 + 2 and final ACC **4**. Exact trip/remaining-fuel consumption remains **3**. Earlier discussion was ambiguous; current implemented rule and README settle this distinction. Unknown earlier fuel makes subsequent ACC unknown.
- Reserve and contingency are separate allowances, not extra modeled consumption. Contingency remains a pilot entry per flight.

### Terrain, coverage and cost

- Manual terrain assistance is **optional**, initially collapsed, usable for one uncertain leg or an explicitly chosen whole route. Do not make it dominate manual planning or overwrite manual MSA.
- The supplied daytime school rule is at least **500 ft above the highest obstacle within 1 NM of the route**, with gliding distance to land over water. Current surface probes exclude obstacles and do not find every terrain peak. Do not call the sampled maximum a complete MSA.
- Automatic routing development is now on hold. If explicitly revisited, preserve dataset-driven geographic routing rather than programming every northern airport pair. Keep app services cost-free; paid services and runtime AI planning remain on hold.
- Retained generator selection covers mainland current-AIP airports at or north of Trondheim, including ENVA, matching the school's southern boundary. This historical coverage does not make the shelved generator a released feature.
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

Grouped/ICAO-sorted AIP menus, snapping without floating names, resizable sidebar, sequential leg editing, explicit school preset, vertical modeling, patterns, single selected OFP frequencies and save/load/export/import exist. Legacy generated-transfer import remains compatible, including recovery of the preceding manual plan, but the generator UI no longer stages new transfers.

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

The generator UI/routing entrypoint is excluded from production. Its source/tests/diagnostic script remain in the repository, and the complete pre-shelving snapshot is tagged. Generator paragraphs below describe retained implementation, not active functionality. Shared manual checks and reporting-point tools remain available.

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

### Shelve the generator with a restorable backup, 2026-10-10

- Removed the planner-page navigation from the manual header. `generator.html` is a script-free redirect to the manual planner, with a fallback link. The original entrypoint is in `archive/route-generator/generator.html`; the production build does not include the archived page or generator UI/routing entrypoint.
- Annotated tag `backup/route-generator-2026-10-10` preserves the complete pre-shelving project at `bf365e3b5ee87e7fb852d7ac57c7a2b2b7469c57`. Source, tests, reviewed routing manifests, diagnostic evidence and dependencies remain recoverable. See [restoration instructions](../archive/route-generator/README.md). Retained code is still type-checked/linted/unit-tested.
- Kept manual plan storage/recovery, old generated-transfer compatibility, shared terrain checks, AIP reporting-point/chart tools and all settled calculation/editing rules. Expired/missing generated transfers now direct users to manual planning rather than the shelved page.
- Browser coverage replaces the active generator accessibility check with an old-bookmark regression: manual app loads, no generator link/entrypoint or WCS search is requested, and the existing working route/bends are preserved. Manual accessibility and existing editing/scroll/OFP checks remain required.
- Fresh Node **22.23.3** verification: **276 unit tests / 54 files**, lint and TypeScript/Vite build passed; **13/13 pinned-Chromium browser checks**, no skips/retries, including old-bookmark working-route preservation and manual accessibility. Production inspection confirms a script-free redirect, no generator assets and no published archive. The backup ZIP passed CRC validation and important source files matched the tagged snapshot byte-for-byte. These results were recorded before publication; inspect Git/Actions for release status. Generator routing/geometry improvements are on hold, not claimed complete.

### Generator diagnosis and sea-surface correction, 2026-10-10

- Completed the user-selected ENDU–ENTC diagnosis against current sources. [Full evidence and reproduction command](GENERATOR_ENDU_ENTC_DIAGNOSTIC.md) retain terminal sequences, modeled levels, controlling point coordinates/raster sections, published ceilings, source checksums and remaining limitations. `scripts/diagnose-generator.mjs` runs the actual pipeline for an arbitrary airport pair, captures provider responses and explicitly labels replay; no airport-pair route is hardcoded.
- Current AIP edition 2026-09-03 and ENDU/ENTC VAC hashes were independently verified. Baseline and subsequent fresh runs each fetched four WCS tiles and 34 point-height batches, all HTTP 200, with no raster gaps or failed batches. All four drafts still fail terrain margins on the represented terminal geometry. The best-ranked ANSNES–RYA leg includes returned terrain about 2911 ft against MAX 2500. Profile calculations succeeded; missing/unknown modeled altitude and restrictions did not cause these particular blocks.
- The single missing point at 69.61477714 N, 18.82201554 E was explicitly classified `Havflate`, with no seabed height/dataset. Official Kartverket documentation distinguishes N50 surface classification from height/depth coverage. The parser now retains a 0 m sea-surface reference with explicit classification-only provenance. Missing land/lake heights, unclassified depths and malformed/unmatched/duplicate responses remain unknown.
- Identical-response replay removes one missing-height notice from each of the two affected drafts, preserving all terrain/MAX conflicts and transfer blocks. A fresh provider run reproduced that result. The local production-preview browser, using fresh WCS/height requests through curl for the cloud proxy, displayed three blocked drafts and disabled acknowledgement/transfer. Direct proxy Chromium access was rejected; map tiles had local certificate failures. This is application/data integration evidence, not live Pages/native-browser connectivity proof.
- Fresh Node **22.23.3** checks: **276 unit tests / 54 files**, lint, TypeScript/Vite build and **13/13 pinned-Chromium regressions**, no skips/retries. Focused tests cover the actual missing-seabed response and unchanged unknown/malformed terrain handling.
- **Historical routing usability remained unresolved.** Point-to-point terminal chords and generic airport joins did not establish the curved published procedures. Subsequent user testing judged the suggestions impractical and the user shelved the generator. Source-reviewed tracks/joins and routing-quality work are retained proposals on hold. Do not raise MAX limits or reduce the 1 NM / 500 ft reference if explicitly revisited.

### Sidebar-to-page scrolling, 2026-10-09

- Removed vertical overscroll containment from the desktop sidebar so scrolling continues naturally to the document/OFP at its edge. Horizontal containment stays in place; no JavaScript wheel interception or changes to list sizing, editing or planning calculations.
- A real-wheel browser regression reproduced the trapped scroll before the fix. It now verifies that the waypoint list scrolls first, then the sidebar, then the document moves toward the OFP with the pointer still over the list.
- Fresh local checks under Node **22.23.3**: **274 unit tests across 54 files**, lint and TypeScript/Vite build passed; **13/13 pinned-Chromium browser checks passed**, no skips or retries. These results were recorded before publication; inspect Git/Actions for current release status.
- The preceding `a396403` release passed [CI](https://github.com/TheHVL/flightplanner/actions/runs/37986762632) and [Pages deployment](https://github.com/TheHVL/flightplanner/actions/runs/37986762636). Direct live-site requests remain blocked by this environment's network policy. Generator routing and terrain findings below remain unresolved.

### Sidebar and route-click follow-up, 2026-10-09

- Waypoint rendering retains the list container and resize handle, restores list/sidebar scroll offsets, and focuses the next (or previous final) remove button without scrolling after deletion. A shortened list clamps naturally to its remaining bottom.
- **Resize waypoint list** adjusts its height from 180–1000 px (default 360), by pointer drag or keyboard; double-click resets it. The preference survives editing/reload and tolerates unavailable browser storage without affecting route data or Undo/Redo.
- Route options open on click after Leaflet's popup-closing preclick, and the route hit line disables mouse-event bubbling. Clicking a leg no longer also appends a waypoint through the map background handler; ordinary map placement, shaping and published-point selection remain available.
- Fresh local checks under Node **22.23.3**: **274 unit tests across 54 files**, lint and TypeScript/Vite build passed. **12/12 pinned-Chromium browser checks passed**, no skips/retries: previous checks plus repeated deletion/keyboard focus/bottom clamping, pointer/keyboard/touch resizing with persistence and 390 px layout, and mouse/touch route-menu insertion with no extra appended point.
- These follow-up results were recorded locally before publication. For the preceding `77f41e0` release, [CI](https://github.com/TheHVL/flightplanner/actions/runs/37985054952) and [Pages](https://github.com/TheHVL/flightplanner/actions/runs/37985054948) succeeded; direct live-site requests were blocked by the environment network policy. No new live terrain or generator-route suitability is established.

### Local user-requested fixes, 2026-10-09

- Changed distance presentation, waypoint drag/insertion, airport-sector coloring and sidebar readability; see the Unreleased changelog. The evidence below was recorded locally before publication; it does not establish deployment status. Existing navigation headings, fuel rules, manual MSA ownership, generator transfer blocks and storage formats are preserved.
- Fresh local verification under Node **22.23.3**: **274 unit tests across 54 files**, source lint and TypeScript/Vite build passed. Tests include the 6 + 7 = 13 NM example and a case where adding displayed legs differs from rounding the exact total, exact calculation inputs, atomic reorder/undo, preserved blanks and wind on insertion, airport provenance/endpoints, bend preservation and sector boundaries.
- **9/9 Chromium browser checks passed**, with no skips or retries, against the local production preview: the original default/undo/autosave smoke check, both axe checks, mouse reorder/undo/reload, route-line insertion, sector colors/narrow-screen readability, whole-NM OFP accounting, actual touch dragging, and line shaping followed by insertion/bend preservation/undo.
- Playwright's pinned Chromium **145.0.7632.6** is now downloadable in this environment. The earlier onboarding system-Chromium run found contrast/link failures; fixes cover sidebar annotations, empty OFP text and Leaflet attribution links. These local results do not claim a new GitHub CI run or Pages deployment.
- These UI changes did not establish live terrain coverage or a usable itinerary. The subsequent ENDU–ENTC diagnosis above fixes its false sea gap; terminal terrain conflicts remain unresolved.

The following are **historical results for the feature checkpoint**, not fresh tests performed by writing this handoff:

- PR #59: **266 unit tests across 53 files**, source lint and TypeScript/Vite build passed.
- GitHub CI: manual default/undo/redo/autosave browser smoke check plus manual-page and generator-page axe checks passed. This is bounded Chromium coverage, not a comprehensive accessibility or operational audit.
- Live manual check: ENDU→ENTC new leg 2500 ft; ArrowUp 2600; Undo 2500; Redo 2600; native field undo did not trigger plan undo; 2600 survived reload.
- PR #58 geodesy regression: 1255 probes on ENDU→ENTC, ENTC→ENSR and a bent ENDU→ENTC route remained within 1852 m of the modeled route. This verified probe placement, not missing peaks/obstacles.
- Live generator ENDU→ENTC, preferred 2500 ft, 45-minute lesson, no visits: real WCS loaded at 100 m source/200 m search spacing; independent review returned 1653 probes. **All drafts remained blocked** by terrain/published-MAX conflicts and one missing height. A reported controlling sample was about 2911 ft; an ANSNES→RYA MAX-2500 segment also conflicted with its modeled level. Transfer and acknowledgement stayed disabled as intended.

**The generator is shelved because of poor practical route quality.** The historical diagnosis isolates the false sea gap and controlling terminal terrain/ceiling conflicts; full source-reviewed tracks/joins remain missing. Do not describe any of those runs as a usable itinerary. If the user explicitly reopens automatic planning, benchmark sensible pilot-reviewed itineraries and re-run current AIP/terrain checks; old results are not a timeless fixture.

Other remaining limitations: partial terminal chart/airport/runway geometry; coarse terrain with omitted peaks; no obstacle maxima; no live activation/NOTAM; still-air generator estimates; bounded search/shortlist may miss suitable routes; preset assumptions need confirmation; DOM coupling remains. Passing all current tests does not remove these limitations.

## 6. Roadmap status and proposed next work

| Status / priority | Work | Completion evidence |
| --- | --- | --- |
| 1 — completed 2026-10-10 | Diagnose the blocked ENDU–ENTC example and fix the source-supported missing-height error | Current-source diagnostic, verified chart hashes, controlling coordinates/limits, identical-response comparison, fresh provider rerun and focused regressions; all terrain/MAX blocks preserved. See [diagnosis](GENERATOR_ENDU_ENTC_DIAGNOSTIC.md) |
| Completed 2026-10-10 | Shelve the generator and preserve its code backup | Manual-only navigation, old-URL redirect, excluded generator entrypoint, annotated source snapshot and documented restoration |
| On hold | Expand source-reviewed generator terminal geometry and northern coverage | Requires a new user decision; chart-backed directional geometry/joins/limits with checksum provenance |
| On hold | Improve dataset-driven automatic route choice | Requires a new user decision and meaningful pilot-reviewed route-quality benchmarks; no reduced terrain reference to force acceptance |
| Proposed 1 | Refine the manual school aircraft preset | Confirm climb FF, cruise MP and descent rate; preserve explicit application, saved inputs and distinction between school/POH climb |
| Proposed 2 | Test first-time-user manual workflow and polish targeted menus/warnings | Observe a short planning task; fix concrete discoverability/overflow/keyboard issues without adding dense panels |
| Proposed 3 | Incrementally decouple state, effects and DOM rendering | Small modules and behavioral regressions; evaluate a lightweight reactive approach only where it fixes demonstrated desynchronization; avoid a wholesale rewrite |
| Later | More precise manual airspace/terrain assistance, authoritative activation/obstacles/NOTAM | Verified source availability/permissions, explicit unknowns and bounded behavior; keep cost constraints and no-QNH decision |
| On hold | Runtime AI route planning, paid services and full operational automatic MSA | Revisit only if user changes scope; current drafts remain review aids |

These priorities consolidate the discussion; they are not the missing numbered proposals from earlier chats. Do not assume old “point 1/2/3” messages define new work without their actual proposal.

**Suggested next Codex task, when chosen by the user:** observe a representative manual planning task and propose a concrete usability improvement, or refine independently confirmed school preset values. Keep the generator shelved and preserve its backup. These proposals do not authorize new implementation by themselves.

## 7. Code map and source documents

| Area | Starting files |
| --- | --- |
| Entrypoints/build | `index.html`, `src/main.ts`, `vite.config.ts`; legacy redirect `generator.html`; archived entrypoint/restore guide `archive/route-generator/` |
| Plan/history/shape | `src/flightplan/FlightPlanStore.ts`, `RouteShapeController.ts`, `workingRoutePersistence.ts`, `savedPlans.ts`; `src/components/PlanningHistory.ts` |
| Sidebar/OFP/persistence UX | `src/components/PlanningWorkflow.ts`, `RoutePanel.ts`, `WaypointListResize.ts`, `SequentialLegPanel.ts`, `OFPTable.ts`, `RouteReviewPanel.ts`, `WorkingRouteStatus.ts`, `WorkspaceLayout.ts`, `legEditorEvents.ts`; `src/utils/panelMarkup.ts`, `src/readability.css` |
| Map route editing/colors | `src/map/MapManager.ts`, `routeSectors.ts`; `tests/routeEditing.test.ts`, `e2e/route-editing.spec.ts` |
| Performance/fuel/rounding | `src/performance/schoolPreset.ts`, `cruisePerformance.ts`, `climbPerformance.ts`, `airspeed.ts`; `src/fuel/fuelPlanning.ts`; `src/presentation/planningRounding.ts` |
| Navigation/profile/MSA | `src/navigation/geodesy.ts`, `verticalProfile.ts`, `verticalConflicts.ts`, `msaCorridor.ts`, `wind.ts`, `magneticVariation.ts` |
| Weather | `src/weather/openMeteo.ts`, `forecastFreshness.ts`; `src/components/WeatherPanel.ts` |
| AIP/frequencies | `src/aip/aerodromes.ts`, `mapPoints.ts`; `src/frequencies/catalog.ts`, `routeFrequencies.ts`, `FrequencyPlanner.ts` |
| Routing/terrain/airspace | `src/routing/terrain.ts`, `terrainRaster.ts`, `terrainRouter.ts`, `airspace.ts`, `restrictions.ts`, `vfrInputs.ts`, `northernAirports.ts`, `issues.ts` |
| Generator | `src/generator/candidates.ts`, `model.ts`, `review.ts`, `transfer.ts`, `GeneratorPage.ts`, `GeneratorMap.ts`, `terrainSummary.ts`; `scripts/diagnose-generator.mjs`, [current-source diagnosis](GENERATOR_ENDU_ENTC_DIAGNOSTIC.md) |
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

Dev manual page: `http://localhost:5173/flightplanner/`; former `generator.html` redirects there. Browser tests use Vite preview on 4173 and the same `/flightplanner/` base. Keep the base and legacy redirect; do not add the archived generator entrypoint to production. The production CSP is injected on build, so inspect preview/production as well as the dev server after provider changes.

Poppler (`pdftotext`) is needed by AIP publication extraction. Explicit refresh commands are `npm run aip:update` and `npm run aip:frequencies`; they use external sources and can modify checked-in snapshots. Use reviewed current publication checksums, not speculative edits to imported points or limits.

CI runs on pushes/PRs: lint, unit tests and build, plus a separate Chromium/axe job with browser dependencies installed and failure artifacts retained. If a local environment cannot download Chromium, say so and inspect the actual CI browser result; do not disable checks or report a local pass.

Pages workflow runs on `main`, manual dispatch and daily **04:17 UTC** schedule. It refreshes both AIP datasets, reports failures, retains verified snapshots on failure, tests/builds and deploys `dist`. The bot may add snapshot commits while a feature is in review. Recheck base/head before merging and preserve those commits. The workflow uses a shared Pages concurrency group, so a newer run may cancel an older one.

For code changes, run appropriate checks and inspect representative UI flows. For routing/performance/persistence changes, add focused meaningful regressions. For docs-only changes, validate file references and `git diff --check`; do not pretend behavioral tests were rerun. Distinguish local work, open PR, merge, CI result, Pages deployment and live verification in reports. A passed PR check alone does not prove the live site uses that commit.

## 9. Keeping the handoff useful

After meaningful development, update the date, feature/data checkpoint, completed items, remaining issues and verification evidence here. Record changed behavior and source limitations, not every tool invocation. Move proposed work to completed only after implementation/verification, and distinguish confirmed aircraft values from assumptions. Keep root `AGENTS.md` concise and avoid duplicating this entire document there.

Suggested opening prompt in a new Codex session:

> Read AGENTS.md and docs/CODEX_HANDOFF.md. Inspect current main and propose the next useful manual-planner improvement. Keep automatic planning shelved and preserve the backup in archive/route-generator/ and Git tag backup/route-generator-2026-10-10. Preserve all settled navigation, terrain, UI and saved-plan requirements.
