# ENDU–ENTC generator diagnosis, 2026-10-10

The current-source run produces four drafts, all blocked by terrain/profile margins on the plotted terminal paths. One missing-height warning was a parser error for an explicitly classified sea surface; correcting it does **not** make any draft transferable. Airport joins and curved chart tracks still need source review.

## Reproduce

Use Node 22, installed project dependencies, and fresh bundled AIP/radio snapshots:

```sh
node scripts/diagnose-generator.mjs --departure ENDU --destination ENTC \
  --date 2026-10-10 --altitude 2500 --minutes 45 --output /tmp/flightplanner-diagnostic/report.json
```

Choose a valid current flight date on later runs. The command runs the actual application pipeline with no visits, wind or patterns, POH climb defaults, 2200 RPM / 20 inHg cruise, and 10 US gal/h descent. It does not apply the separate school climb preset. Normal freshness, profile, restriction and transfer checks remain active.

The report retains request assumptions, snapshot checksums, every provider response URL/status/retrieval time/SHA-256, candidate geometry, per-leg modeled levels, individual point heights, controlling raster sections and blocking notices. Provider bodies are saved alongside it in `raw/`; keep these generated files outside the repository. Add `--curl` in a cloud environment where Node fetch cannot use its HTTPS proxy. Add `--replay` to compare code against the **same captured responses**; replay is explicitly labelled and is not a new live-source check. It does not freeze time or bypass AIP freshness.

In the UI, open the separate Route Generator, remove both default visits, select ENDU → ENTC, preferred 2500 ft, target 45 minutes, flight date 2026-10-10 and leave POH assumptions unchanged. Generate and review the selected legs/notices.

## Sources and evidence

- Baseline source retrieval: **2026-10-09 22:27–22:28 UTC**, or **2026-10-10 00:27–00:28 Europe/Oslo**. A second fresh run at **22:35 UTC** reproduced the corrected result.
- Starting repository checkpoint: `a0bccc5e8234e68e8ec7c16ff2c6d9ce343f6ac0`.
- [Official AIP edition list](https://aim-prod.avinor.no/no/AIP/View/Index/155/history-no-NO.html) resolved to effective edition **2026-09-03**, matching the bundled snapshot checked **2026-10-09T20:40:11.256Z**. The two freshly downloaded VAC files matched the checksum-reviewed definitions.
- [ENDU VAC](https://aim-prod.avinor.no/no/AIP/View/Index/155/2026-09-03-AIRAC/graphics/623256.pdf): SHA-256 `f93dd046804a5e00cf2b8a5baa76d5e5a4083a077fa6ff2429e2e88930e9b966`.
- [ENTC VAC](https://aim-prod.avinor.no/no/AIP/View/Index/155/2026-09-03-AIRAC/graphics/623173.pdf): SHA-256 `864c552dba14af7f1fefbef08344728a1b7f3f45ea1a84d6ad2275ca8a45be64`.
- Aerodrome snapshot SHA-256 `2675dfb2dab08b3c525493d282392382f30ddb4d1c4b23dd86a55f84b0b950a8`; radio snapshot `cf8514c0eac08667fdc18a358a78c4f1ccda8191b6edeac9b87de3dc423c2e2f`.
- Each diagnostic fetched four [Kartverket WCS](https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833) tiles and 34 [height API](https://ws.geonorge.no/hoydedata/v1/) batches: **38 HTTP 200 responses**, no failed batches or missing raster corridors. WCS samples were 100 m, max-pooled into 200 m search cells. These are returned samples, not complete native-model maxima or obstacle coverage.
- Nine departure/arrival sequence combinations were searched. Four drafts were reviewed; the UI shows the highest-ranked three. All profiles were computable, with no profile-calculation errors or unknown modeled altitudes. Verified airspace/restriction data was available; restrictions did not cause these particular blocks.

Counts below are low-margin raster sections and individual transit probes **per draft**, not unique geographical obstacles. Distances are exact path lengths rounded here to one decimal for diagnosis; the planner's settled whole-NM display rule is unchanged.

| Draft | Departure chain → arrival chain | Exact path, NM | Raster conflicts | Transit point conflicts | Missing heights, before → after | Transfer |
| --- | --- | ---: | ---: | ---: | --- | --- |
| draft-1 | SØRREISA–FINNSNES → ANSNES–RYA–HÅKØYA | 51.9 | 23 | 7 | 1 → 0 | Blocked |
| draft-2 | NORA–ROSSVOLL → ANSNES–RYA–HÅKØYA | 54.0 | 29 | 9 | 1 → 0 | Blocked |
| draft-3 | SØRREISA–FINNSNES → SELNES–BERG–BREIVIKA | 61.3 | 14 | 28 | 0 → 0 | Blocked |
| draft-0 | NORA–ROSSVOLL → SELNES–BERG–BREIVIKA | 42.9 | 20 | 30 | 0 → 0 | Blocked |

## The false missing height

The affected point is on RYA → HÅKØYA, **3.935867 NM along the leg, 1 NM right**, at **69.61477714 N, 18.82201554 E**. Modeled altitude was about 1238 ft. Kartverket returned:

```json
{"datakilde":null,"terreng":"Havflate","x":18.82201554,"y":69.61477714,"z":null}
```

The [official API specification](https://ws.geonorge.no/hoydedata/v1/openapi.json) says `/punkt` returns lake height, land terrain height or **sea depth**, and `/terrengtyper` states that surface classification comes from **N50 Kartdata**. The parser already used 0 m sea surface instead of valid seabed depth, but rejected this response before checking its explicit sea classification.

The fix accepts a coordinate-matched, unambiguous `Havflate` point with unavailable depth as a **sea-surface reference**, with `dataset: "N50 surface classification"` and `surfaceOnly: true`. It does not fabricate a measured DTM height. Missing land/lake heights, unclassified depths, invalid projections, unmatched/duplicate points and malformed/out-of-range heights remain unknown. Classification does not establish obstacle clearance over water.

The before/after comparison replayed the identical 38 captured responses. Every raster conflict, transit conflict and transfer block stayed unchanged; only the two repeated missing-height notices disappeared. A subsequent fresh provider run reproduced the same counts.

## Remaining controlling constraints

Highest-ranked draft: ENDU → SØRREISA → FINNSNES → terrain turn → ANSNES → RYA → HÅKØYA → ENTC. Its modeled leg endpoints are **254→2500**, **2500→2500**, **2500→2500**, **2500→2500**, **2500→1500**, **1500→500**, **500→32 ft**. The last legs descend to fit the adjacent limits and airport elevation; preferred 2500 ft is not a promise of 2500 ft throughout.

| Section | Controlling evidence | Implication |
| --- | --- | --- |
| ENDU → SØRREISA | At 2.8366 NM, right-edge point **69.09381824 N, 18.44888817 E**: surface 959 ft, modeled 1388 ft, margin 430 ft. Controlling raster section 2.8366–3.3094 NM: surface 1147 ft / modeled 1388 ft; two failing sections. | Generic airport-to-point climb join needs review; the observed margin is below the unchanged 500 ft reference. |
| ANSNES → RYA, MAX 2500 | Controlling raster section 0.4950–0.9899 NM: surface 2911 ft / modeled 2500 ft; ten failing sections. A point at **69.51559496 N, 18.59461045 E**, 3.4647 NM / right 1 NM, returns surface 2141 ft / modeled 2366 ft, margin 225 ft. | Raster review level at least 3500 ft; point review level at least 2700 ft. Both exceed MAX 2500. |
| RYA → HÅKØYA, MAX 1500 | Controlling raster section 2.9519–3.4439 NM: surface 1216 ft / modeled 1361 ft; eleven failing sections. Point at **69.59474223 N, 18.70118410 E**, 1.9679 NM / left 1 NM: surface 1152 ft / modeled 1500 ft, margin 348 ft. | Raster/point review levels at least 1800/1700 ft exceed MAX 1500. |
| Other arrival via BERG → BREIVIKA, MAX 1000 | Returned point terrain about 2584 ft and controlling raster about 2598 ft against modeled 1000 ft. | Switching to this represented chain does not solve the terrain/ceiling mismatch. |
| NORA → ROSSVOLL alternative | Returned point surface about 2130 ft / modeled 2443 ft, below 500 ft margin and requiring about 2700 ft against MAX 2500. | Adds another terminal conflict. |

These conflicts are supported by current terrain along the **represented geometry**. The diagnosis does not establish that the published VFR procedure itself is unusable: current terminal sequences are point-to-point chords, not full reviewed curved chart tracks or runway joins. Visual review confirms curves and local terrain on both VACs. No new chart coordinates, MAX values or airport transitions were invented.

Next work: review and encode chart-backed directional geometry and airport joins, starting with the conflicting ENDU departure and ENTC arrival chains. Retain publication checksums and regenerate when charts change. Re-run these diagnostics to determine which conflicts persist with the reviewed geometry. Keep the 1 NM / 500 ft reference, missing-data and restriction blocks, and acknowledgement limits intact.

## Verification boundaries

Node 22 checks passed: **276 unit tests / 54 files**, lint and TypeScript/Vite build; **13 pinned-Chromium regressions**, no skips or retries. Focused parser tests include the actual sea response and unknown/malformed cases.

The local production-preview browser also completed this itinerary with fresh provider responses transported through curl: three displayed drafts remained blocked, with acknowledgement and transfer disabled. This validates application integration against current data; it does not validate native browser proxy/CORS access or the deployed Pages asset version. The cloud proxy rejected direct Chromium access, and direct live Pages requests are restricted in this environment. Map tiles had local certificate failures, separate from the successful WCS/height checks.
