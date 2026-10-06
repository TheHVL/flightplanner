# Route Generator and automatic planner data

The **Route Generator** is a separate page at `generator.html`, with its own form, map and temporary plan state. Initial coverage is ENDU, ENTC and ENSR. It generates route drafts for comparison and later editing in Manual Planner. It is not a complete operational route solver: published chart bends, airport joins, obstacles, restricted airspace and NOTAM are not fully encoded.

## Using the separate page

Choose departure, finish, ordered airport visits, touch-and-goes or pattern counts, flight date, lesson duration and preferred altitude. Airport lists use ICAO order; altitude changes use 100 ft steps. Aircraft assumptions are in a collapsed section. Add, remove or reorder up to four visits. Patterns contribute their requested duration; the generator does not invent holding, extra patterns or ground time to fill a lesson.

The generator compares up to three different reporting-point routes using C182T Figure 5-9 cruise and Figure 5-8 normal climb at 90 KIAS, still air and ISA at preferred altitude. Descent and pattern fuel flows are editable assumptions. Published directional MAX limits constrain draft levels. Approach levels can be lowered to fit the shared descent model; they remain choices for chart and terrain review. Unresolved ENSR directions and unqualified chart altitude labels remain withheld; reporting-point anchors there are explicitly labelled as incomplete procedure coverage.

Each generation verifies the deployed AIP edition and flight date, fetches terrain afresh and checks available terminal airspace. Alternatives are ranked by profile validity, sampled transit terrain margins, missing data and duration. Transit samples below the 500 ft review reference block transfer. Samples within 3 NM of airports are counted separately for arrival/departure review; they are not a verified approach corridor. Missing terrain remains unknown. If no draft passes, the page displays that outcome without inventing a terrain-safe route. The duration target may be unattainable.

Generation, preview, cancellation and ordinary page navigation never read or replace the current manual route. **Use this route in Manual Planner** stages a temporary session-only transfer and opens the manual page. Only that explicit, matching token applies the draft. The existing save/load recovery mechanism preserves the previous manual work before replacement, and named saved plans stay unchanged. Invalid, expired or failed recovery writes leave manual work intact. Transferred routes have no invented MSA, frequencies or forecast winds; fetch fresh winds for the intended departure time in Manual Planner.

## Terrain

`src/routing/terrain.ts` samples the plotted path, including bends, at intervals no greater than 0.5 NM. Five samples per station span a strip 1 NM either side. This strip is not the complete rounded MSA corridor or an exhaustive terrain maximum.

Heights come from Kartverket's public [height API](https://ws.geonorge.no/hoydedata/v1/), using EPSG 4258 and `punkter` in longitude/latitude order. Requests have at most 50 unique points, with three concurrent workers, 20-second batch timeouts and a 6000-probe route limit. Every requested check fetches fresh data. Responses are matched by coordinate; missing, malformed or failed samples remain unknown. Sea depth is replaced by the sea surface, never used as terrain clearance. Surface elevations are returned in metres and converted to feet.

Results retain fetch time and per-sample terrain/dataset identifiers. The API does not supply each dataset's observation date. A recent fetch is not a claim that its survey was recently updated.

The optional panel compares modeled flight altitude at each station with sampled heights. The 500 ft review margin comes from this project's training rule. Departure/arrival samples are included, so a low margin there can be intentional. No manual MSA is overwritten. Peaks between samples, obstacles, pressure/datum differences, end caps and finer terrain geometry must still be reviewed. A full terrain raster and obstacle source are required before automatic MSA or terrain-safe routing can be claimed.

## Airspace

`src/routing/airspace.ts` follows plotted paths and modeled climb/descent, splitting at geometry and AMSL altitude boundaries. Chords are at most 0.5 NM; intersection distances are planning estimates. It uses the existing verified AIP terminal-volume catalog, excluding Polaris ATS radio sectors from airspace restrictions. Each encounter retains published limits and source links.

FL and AGL boundaries are marked for review without assuming QNH or terrain-reference conversions. Unresolved geometry or missing modeled altitude is also marked for review. The catalog is a terminal/radio-data subset, not complete legal airspace coverage: restricted/danger areas, temporary restrictions, NOTAM and all local procedures are not covered. A missing encounter never means unrestricted airspace. Source freshness uses the existing matching-edition, 48-hour verification and flight-date checks.

## VFR inputs for the generator

`scripts/aip/verified-vfr-routes.json` stores reviewed point sequences, directional altitude ceilings and source-chart checksums. The importer adds structured adjacent segments to `aip-aerodromes.json` only when the chart checksum and all points match. Changed publications withhold the old definitions until reviewed again. Invalid segment limits are withheld too. Existing daily/deployment AIP refreshes maintain these inputs.

Chart review corrected two older inferred connections: ENTC's northeast sequence now stops at TØNSNES, rather than connecting it to MOVIKVANN; ENSR's western sequence stops at STORTIND rather than inferring a STORTIND–STORSLETT leg. NIPØYA–TØNSNES has different inbound/outbound ceilings. The MUSVÆR leg is encoded outbound only. ENDU's NORA–ROSSVOLL sequence has a charted MAX 2500 ft in both directions. ENSR's unqualified chart altitude labels are preserved as chart altitudes, not invented MAX limits; those directions/altitudes are withheld from graph edges pending further review.

`src/routing/vfrInputs.ts` creates directed reporting-point edges with provenance. It checks source edition, freshness, flight date, chart checksum and point resolution. Airport joins and inter-airport connections are not inferred. Every edge requires chart review because point-to-point lines do not encode the chart's actual bends. `readyForAutomaticRouting` deliberately remains false. These inputs are not exposed as route guidance in the manual planner; official chart links and individual points remain available.

## Remaining work before operational automatic routing

Review and encode actual chart geometry, airport joins and unresolved altitude/direction requirements. Add authoritative obstacle and restricted-airspace coverage and a complete terrain corridor. Terrain-aware search beyond the bounded reporting-point alternatives, forecast winds during generation and runway-specific approach/pattern geometry remain future work. `readyForAutomaticRouting` stays false to distinguish the present draft comparison from complete operational routing.

Route-review results are temporary. Editing route, profile, flight date, aircraft or fuel settings cancels pending checks and removes old results. Loading a saved plan likewise requires a fresh check. Nothing is added to saved-plan JSON.
