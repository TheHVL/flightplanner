# MSA implementation plan

This document describes the current and proposed implementation of Minimum Safe Altitude (MSA) for the Flightplanner training tool.

## UTSA daytime VFR rule supplied for this project

For daytime VFR planning, use:

- at least 500 ft above the highest obstacle along the route within 1 NM of the route; and
- when flying above water, remain within gliding distance of land.

This is a project/training rule supplied for Flightplanner. The planner should display the source/rule used and should not silently replace it with a different regulatory interpretation.

## Current implementation

The first safe version is intentionally pilot-driven:

- an optional map overlay shows a corridor 1 NM either side of each route leg;
- the corridor includes 1 NM end caps around waypoints so the visual area represents points within 1 NM of the route centerline;
- MSA is entered manually for each OFP leg after the pilot inspects the relevant chart/data;
- PL is compared with the entered MSA and a warning is shown when `PL < MSA`;
- affected manual MSA values are cleared when route geometry changes, so a value checked for an old corridor is not silently reused;
- manual MSA state participates in Ctrl+Z/Cmd+Z undo.

No automatic terrain or obstacle value is currently presented as a complete MSA.

## 1. Terrain and obstacle corridor

For each great-circle leg, construct a corridor extending 1 NM to either side of the route centerline, including the end caps at both waypoints.

If complete terrain and obstacle data becomes available, the underlying rule is:

```text
highest controlling elevation = max(highest terrain MSL, highest obstacle top MSL)

obstacle-based MSA = highest controlling elevation + 500 ft
```

The 500 ft addition is the actual project rule. Any display rounding, for example rounding upward to the next 100 ft, should be a separate display/planning option rather than silently changing the underlying minimum.

### Current visual corridor geometry

The map currently constructs a 2 NM-wide corridor from 1 NM lateral offsets of each leg and adds 1 NM-radius waypoint caps. The lateral offset points are calculated on the Earth sphere rather than using a fixed pixel width, so the corridor remains approximately 1 NM wide as map zoom changes.

### Terrain source

Kartverket provides national terrain/elevation models and API services. A future terrain-assistance implementation should use a national DTM raster service rather than sampling only the route centerline, because the rule requires the highest point anywhere within 1 NM of the route.

Potential source family:

- Kartverket National Elevation Model / DTM through Geonorge and WCS/API services
- https://www.kartverket.no/api-og-data/terrengdata

For performance, the planner should request a raster/window covering the 1 NM corridor, clip it to the corridor in code, then find the maximum terrain elevation. Results should be cached by leg geometry so small UI changes do not repeatedly download the same terrain data.

### Man-made obstacle source

The correct Norwegian source is Nasjonalt register over luftfartshindre (NRL). Since 1 July 2026, Kartverket requires approved access for NRL data. The public Flightplanner repository must therefore not contain copied restricted NRL data or private credentials.

Official information:

- https://www.kartverket.no/en/geodataarbeid/nrl
- https://kartverket.no/om-kartverket/nyheter/geodataarbeid/2026/april/tilgang-til-nrl-data-krever-godkjenning-fra-1.-juli

Recommended future approach:

1. Keep the manual MSA workflow available even if automatic assistance is later added.
2. Add a terrain-only suggestion with a very visible `TERRAIN ONLY - OBSTACLE DATA NOT VERIFIED` state.
3. Add a manual controlling-obstacle elevation input if useful for training flights using a separately checked chart/AIP source.
4. If approved NRL access is later obtained, add an authenticated server-side/provider integration. Do not put NRL credentials in the browser or public repository.
5. Before exposing derived NRL results publicly, confirm that the approved access terms allow the intended use and output.

The planner should never label a result as a complete automatic MSA if it only used terrain while obstacle coverage is unavailable.

## 2. Water and glide-to-land rule

A separate land/water analysis should examine the route centerline and determine where it passes over water. Kartverket N50 areal-cover/water data is a suitable Norwegian source family for identifying land and water at useful planning resolution.

The C182T POH Maximum Glide Figure 3-1 supplied for this project has now been visually verified as suitable for a later still-air glide check. The chart states the conditions `propeller windmilling`, `flaps up`, and `zero wind`, and gives weight-dependent best-glide speeds. The first glide implementation must preserve those conditions in the UI rather than presenting the result as a wind-aware guarantee.

A visual glide-to-land overlay is preferred before any binary website decision. For each sampled route position over water, a later implementation should:

1. identify nearby land;
2. determine horizontal distance to land;
3. use verified C182T maximum-glide performance for available height above the relevant land/terrain;
4. show the still-air reachable-land envelope visually;
5. make it clear that wind can reduce or increase actual reach.

A generic glide-ratio formula may be useful internally only if it is demonstrated to match the verified POH chart sufficiently well. Do not invent a glide ratio from cruise data.

## 3. Proposed architecture

Keep the aviation calculation independent from the UI:

```text
src/navigation/msaCorridor.ts   current visual 1 NM corridor geometry
src/msa/msa.ts                  future MSA rule and result model
src/msa/terrainProvider.ts      future Kartverket DTM querying/caching
src/msa/obstacleProvider.ts     future manual/authorized NRL provider interface
src/msa/landProvider.ts         future land/water and nearest-land analysis
src/msa/glide.ts                future C182T glide model
src/components/MsaPanel.ts      future coverage/status/settings UI if needed
```

A future automatic-assistance result model per leg could include:

```text
leg id
highest terrain ft MSL
highest obstacle ft MSL or unavailable
controlling elevation ft MSL
obstacle-based MSA ft
water crossing yes/no
maximum distance to land NM
required glide altitude ft MSL or unavailable
suggested MSA ft
status: complete | terrain-only | incomplete
sources and timestamps
```

## 4. Interaction with the OFP

Current behavior:

```text
manual MSA = value entered by pilot

if PL and MSA are both entered:
  warn when PL < MSA
```

Manual MSA should be rechecked whenever the route geometry for that leg changes. Flightplanner therefore clears affected manual MSA values after geometry-changing edits.

If automatic terrain assistance is added later, the user must be able to inspect why a suggested value was produced and distinguish it from the manually accepted MSA.

## 5. Validation and tests

Current automated tests cover:

- 1 NM spherical offset geometry;
- corridor width at both ends of a Norwegian route leg;
- manual MSA storage;
- manual MSA restoration through undo;
- invalidation of manual MSA after waypoint geometry changes;
- clearing old manual MSA when a route leg is split.

Future automatic-terrain tests should cover:

- highest terrain exactly on centerline;
- higher terrain 0.9 NM off track is included;
- terrain 1.1 NM off track is excluded;
- obstacle higher than terrain controls MSA;
- terrain higher than obstacle controls MSA;
- water segment whose glide requirement controls planning;
- water segment already satisfied by obstacle-based MSA;
- missing obstacle data produces `terrain-only`, not `complete`;
- geometry around high latitudes in Norway and near longitude wrapping remains correct.

## Recommended implementation order from here

1. Keep and refine the current 1 NM visual corridor plus manual MSA workflow.
2. Add a C182T still-air glide-to-land visualization using the verified POH maximum-glide chart.
3. Add optional terrain-only assistance from Kartverket with explicit incomplete-data labelling.
4. Add manual obstacle assistance and data-quality/status information.
5. Add an authorized NRL provider only if access and terms permit it.
6. Consider a wind-aware glide footprint later.

This staged approach gives useful planning assistance without pretending that incomplete terrain/obstacle data is a verified automatic MSA.
