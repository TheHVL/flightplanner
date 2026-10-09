# Flightplanner: instructions for coding agents

Read [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) before substantive work. It contains the implementation checkpoint, settled product decisions, known limitations, aircraft assumptions, proposed roadmap and verification instructions. Verify the current branch and code: that checkpoint is not a live status feed.

## Product constraints

- Keep Manual Planner (`index.html`) and Route Generator (`generator.html`) on separate pages. Prioritize a simple first-time student workflow and progressive disclosure.
- Keep the planner free of paid services, API-key requirements and runtime AI for now. Do not replace geographic routing with manually coded airport-pair routes.
- **TT, MT and wind-derived headings use the direct course between named waypoints.** Hidden shaping bends change distance, time, fuel and the map/terrain path only. Add a real waypoint for another navigation leg.
- Manual terrain/MSA assistance is optional and initially collapsed. Never overwrite pilot-entered MSA with sampled terrain. The training reference is 500 ft above the highest obstacle within 1 NM; present sampling does not establish that maximum or obstacle coverage.
- New planned levels default to 2,500 ft, editable in 100 ft increments. Preserve restored explicit levels and blanks. PL remains a documented pressure-altitude proxy; the user does not want QNH input or promises to add it later.
- Use “pattern” in the UI; airport-only, separate OFP row, time/fuel fields only. Preserve compatible internal `circuits` values in saved data.
- OFP shows one selected frequency per leg; suggestions belong in the sidebar. Do not guess Polaris coverage, restriction activation or chart geometry.
- INT fuel rounds each row up to whole US gal; ACC adds displayed INT values, including patterns. Exact trip/remaining consumption stays unrounded. Leg distance rounds down when the fractional NM is below 0.3, otherwise up. ACC distance and total sum those displayed whole-NM legs without decimals; calculation inputs stay exact.
- Waypoints can be reordered by mouse/touch drag handles or arrow buttons. Preserve list/sidebar scroll position during edits, including deletion. Waypoint-list height is adjustable by mouse/touch or keyboard and remembered as a UI preference. When vertical scrolling reaches the list/sidebar edge, let it continue to the page/OFP. Route-line clicks offer insertion between endpoints; dragging a line still adds a hidden shaping bend. Airport-to-airport sectors have distinct map colors through intermediate points. Preserve undo, input compatibility and readable sidebar text.
- Generator airport coverage is mainland ENVA/Trondheim and north. Preserve missing-data, restriction and profile transfer blocks. Acknowledgement never overrides them. Never turn unknown terrain into zero or offer an unchecked straight-line fallback.
- Preserve saved-plan compatibility, manual wind backups, recovery copies and native text-input undo. Fetch new forecasts when reusing a plan; never silently reuse old forecasts or change winds on age alone.

## Work and verification

Use Node 22 and npm with the committed lockfile. For code changes run `npm run lint`, `npm test`, `npm run build`, and relevant browser checks (`npm run test:e2e`; Chromium installation may be needed). Use focused regression tests for navigation, performance, terrain and persistence changes. Docs-only changes need link/path and diff checks; do not claim fresh behavioral tests when none ran.

Keep changes scoped. Do not undertake a framework/state rewrite just because earlier feedback suggested one. No sub-agent delegation unless the active user request explicitly calls for it. Follow current task authorization for commits, merges and deployment; this file is not blanket permission for unrelated changes.

Report what changed, evidence, limitations and whether it is local, in a PR, merged or deployed. Passing CI is not proof of live terrain coverage or operational route suitability. After meaningful work, update the handoff checkpoint, open issues and test evidence. Proposed roadmap entries require a concrete user task before implementation.
