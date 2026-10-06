# Automatic planner data foundation

The automatic planner remains separate from the manual workflow. The first coverage area is ENDU, ENTC and ENSR. This change provides reusable terrain, terminal airspace and VFR inputs, plus an optional manual terrain/airspace review. It does not yet generate flight routes.

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

Chart review corrected two older inferred connections: ENTC's northeast sequence now stops at TØNSNES, rather than connecting it to MOVIKVANN; ENSR's western sequence stops at STORTIND rather than inferring a STORTIND–STORSLETT leg. NIPØYA–TØNSNES has different inbound/outbound ceilings. The MUSVÆR leg is encoded outbound only. ENSR's unqualified chart altitude labels are preserved as chart altitudes, not invented MAX limits; those directions/altitudes are withheld from graph edges pending further review.

`src/routing/vfrInputs.ts` creates directed reporting-point edges with provenance. It checks source edition, freshness, flight date, chart checksum and point resolution. Airport joins and inter-airport connections are not inferred. Every edge requires chart review because point-to-point lines do not encode the chart's actual bends. `readyForAutomaticRouting` deliberately remains false. These inputs are not exposed as route guidance in the manual planner; official chart links and individual points remain available.

## Next implementation

Before route generation, review and encode actual VFR geometry, airport joins and altitude/direction requirements, and add obstacle and restricted-airspace coverage. Then build a separate Route Generator page with departure, ordered airport visits/patterns, lesson duration and preferred altitude. Generate explainable candidates using aircraft performance and these shared checks. Transfer a candidate only through an explicit **Use this route in Manual Planner** action.

Route-review results are temporary. Editing route, profile, flight date, aircraft or fuel settings cancels pending checks and removes old results. Loading a saved plan likewise requires a fresh check. Nothing is added to saved-plan JSON.
