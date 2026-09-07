# MSA implementation proposal

This document describes a proposed implementation of Minimum Safe Altitude (MSA) for the Flightplanner training tool.

## UTSA daytime VFR rule supplied for this project

For daytime VFR planning, use:

- at least 500 ft above the highest obstacle along the route within 1 NM of the route; and
- when flying above water, remain within gliding distance of land.

This is a project/training rule supplied for Flightplanner. The planner should display the source/rule used and should not silently replace it with a different regulatory interpretation.

## Recommended user-facing result

Calculate an MSA for every route leg and place it directly in the OFP MSA column. For each leg also show:

- controlling terrain/obstacle elevation;
- MSA resulting from the 500 ft clearance rule;
- whether the leg crosses water;
- any glide-to-land minimum that is higher than the obstacle-based MSA;
- data source, coverage status and timestamp;
- a clear warning if man-made obstacle data is unavailable.

A map overlay should optionally show the 1 NM corridor and the location of the controlling terrain/obstacle point.

## 1. Terrain and obstacle corridor

For each great-circle leg, construct a corridor extending 1 NM to either side of the route centerline, including the end caps at both waypoints.

Within that corridor determine:

```text
highest controlling elevation = max(highest terrain MSL, highest obstacle top MSL)

obstacle-based MSA = highest controlling elevation + 500 ft
```

The 500 ft addition is the actual project rule. Any display rounding, for example rounding upward to the next 100 ft, should be a separate display/planning option rather than silently changing the underlying minimum.

### Terrain source

Kartverket provides national terrain/elevation models and API services. The preferred implementation is to use a national DTM raster service rather than sampling only the route centerline, because the rule requires the highest point anywhere within 1 NM of the route.

Potential source family:

- Kartverket National Elevation Model / DTM through Geonorge and WCS/API services
- https://www.kartverket.no/api-og-data/terrengdata

For performance, the planner should request a raster/window covering the 1 NM corridor, clip it to the corridor in code, then find the maximum terrain elevation. Results should be cached by leg geometry so small UI changes do not repeatedly download the same terrain data.

### Man-made obstacle source

The correct Norwegian source is Nasjonalt register over luftfartshindre (NRL). Since 1 July 2026, Kartverket requires approved access for NRL data. The public Flightplanner repository must therefore not contain copied restricted NRL data or private credentials.

Official information:

- https://www.kartverket.no/en/geodataarbeid/nrl
- https://kartverket.no/om-kartverket/nyheter/geodataarbeid/2026/april/tilgang-til-nrl-data-krever-godkjenning-fra-1.-juli

Recommended approach:

1. Implement terrain-only MSA first, with a very visible `TERRAIN ONLY - OBSTACLE DATA NOT VERIFIED` state.
2. Add a manual obstacle-elevation override per leg so training flights can use a checked chart/AIP value when NRL cannot be queried.
3. If approved NRL access is later obtained, add an authenticated server-side/provider integration. Do not put NRL credentials in the browser or public repository.
4. Before exposing derived NRL results publicly, confirm that the approved access terms allow the intended use and output.

The planner should never label a result as a complete MSA if it only used terrain while obstacle coverage is unavailable.

## 2. Water and glide-to-land rule

A separate land/water analysis should examine the route centerline and determine where it passes over water. Kartverket N50 areal-cover/water data is a suitable Norwegian source family for identifying land and water at useful planning resolution.

For each sampled route position over water:

1. Find the nearest suitable land boundary/location.
2. Determine the horizontal distance to land.
3. Determine the altitude required to glide that distance with the configured aircraft glide performance.
4. Compare that requirement with the obstacle-based MSA.

Conceptually, for a simple still-air glide-ratio model:

```text
required height above landing point [ft]
  = distance to land [NM] × 6076.12 / glide ratio

required glide altitude MSL [ft]
  = landing-point elevation MSL + required height above landing point
```

Then:

```text
leg MSA = max(obstacle-based MSA, maximum glide-to-land altitude required on the leg)
```

The constant-ratio formula should only be used if the aircraft data supports representing glide performance this way. A better C182T implementation would use the applicable POH glide-performance data if available. Wind materially affects a real glide footprint, so the first implementation should be explicitly labelled `still-air glide check` unless wind is incorporated.

Do not invent a glide ratio from cruise data. Add the glide-performance source only after the relevant C182T POH page/data has been verified.

## 3. Proposed architecture

Keep the aviation calculation independent from the UI:

```text
src/msa/msa.ts                  MSA rule and result model
src/msa/terrainProvider.ts      Kartverket DTM querying/caching
src/msa/obstacleProvider.ts     manual/authorized NRL provider interface
src/msa/landProvider.ts         land/water and nearest-land analysis
src/msa/glide.ts                aircraft glide model
src/components/MsaPanel.ts      coverage/status/settings UI
```

Suggested result model per leg:

```text
leg id
highest terrain ft MSL
highest obstacle ft MSL or unavailable
controlling elevation ft MSL
obstacle-based MSA ft
water crossing yes/no
maximum distance to land NM
required glide altitude ft MSL or unavailable
final MSA ft
status: complete | terrain-only | incomplete
sources and timestamps
```

## 4. Interaction with the OFP

The MSA column should be calculated per leg. The value should update whenever:

- a waypoint is added, removed, inserted, moved or reordered;
- the 1 NM corridor rule changes;
- terrain/obstacle data changes;
- glide-performance settings change;
- land/water data changes.

A user should be able to inspect why a particular MSA was produced. Clicking/hovering the MSA cell could show something like:

```text
MSA 3,200 ft
Controlling terrain: 2,642 ft MSL
Clearance rule: +500 ft
Water glide requirement: 2,900 ft
Obstacle coverage: verified / unavailable
```

## 5. Validation and tests

Minimum automated tests should cover:

- highest terrain exactly on centerline;
- higher terrain 0.9 NM off track is included;
- terrain 1.1 NM off track is excluded;
- obstacle higher than terrain controls MSA;
- terrain higher than obstacle controls MSA;
- water segment whose glide requirement controls MSA;
- water segment already satisfied by obstacle-based MSA;
- missing obstacle data produces `terrain-only`, not `complete`;
- route edits invalidate/recalculate the correct leg;
- geometry around high latitudes in Norway and near longitude wrapping remains correct.

## Recommended implementation order

1. MSA core model, 1 NM corridor geometry and terrain-only result.
2. OFP MSA column integration plus map corridor/controlling-point visualization.
3. Manual obstacle override and explicit data-quality state.
4. Land/water detection and still-air glide-to-land check using verified C182T glide data.
5. Authorized NRL provider if access and terms permit it.
6. Optional wind-aware glide footprint later.

This staged approach gives a useful terrain MSA early without pretending that restricted obstacle data is available when it is not.
