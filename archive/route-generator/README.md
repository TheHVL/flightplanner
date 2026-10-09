# Route Generator backup

Shelved at the user's request on **2026-10-10** after route suggestions failed to provide useful VFR itineraries. Development now prioritizes the manual planner. Do not restore the generator without a new user decision.

## Preserved snapshot

The annotated Git tag [`backup/route-generator-2026-10-10`](https://github.com/TheHVL/flightplanner/tree/backup/route-generator-2026-10-10) preserves the complete project immediately before shelving, at commit `bf365e3b5ee87e7fb852d7ac57c7a2b2b7469c57`. It includes the generator UI, routing, reviewed manifests, tests, diagnostics and matching dependency lockfile. This is a source backup, not an operationally validated planner.

The original [generator.html](generator.html) entrypoint is also preserved here. Current generator source remains at [`src/generator.ts`](../../src/generator.ts), [`src/generator/`](../../src/generator/), and [`src/generator.css`](../../src/generator.css). Its focused tests and [`scripts/diagnose-generator.mjs`](../../scripts/diagnose-generator.mjs) remain available. Shared navigation, terrain, reporting-point and transfer compatibility code is retained for the manual planner.

The published `generator.html` redirects to the manual planner. This archived entrypoint and the generator UI/routing bundle are excluded from the production build. Removing its navigation link or using the old bookmark does not clear browser-local plans.

## Restore for investigation

Fetch the tag, then inspect or extract the complete snapshot:

```sh
git fetch origin tag backup/route-generator-2026-10-10
git show backup/route-generator-2026-10-10:generator.html
git archive --format=zip --output=/tmp/flightplanner-generator-backup.zip backup/route-generator-2026-10-10
```

Extract the archive into a separate directory, install with Node 22 and `npm ci`, then use its documented development commands. Restoration of the published feature requires an explicit new task, updated navigation/docs and full validation. Fresh AIP/terrain data is still required; historical snapshots do not establish current suitability.

The [ENDU–ENTC diagnostic](../../docs/GENERATOR_ENDU_ENTC_DIAGNOSTIC.md) records the last source investigation and unresolved route-quality/terminal-geometry problems. Generator tests continue running to keep the retained code reviewable; passing them does not establish useful routes.
