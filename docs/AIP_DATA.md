# Norwegian AIP data

The Aviation data panel searches aerodromes by ICAO/name and chart points by name/aerodrome. Add appends to the working route. Selecting an aerodrome displays runway ends, published declared distances and their remarks, ATS frequencies/channels with operating hours and remarks, transition altitude, local regulations, circuit/noise notes, flight procedures, and VFR chart links. Published elevation feeds the departure/destination model and intermediate Airport/T&G constraints. Circuit direction is only presented where actually stated by AD 2; no airport-specific circuit is invented.

The Sequential PL/MSA/wind panel uses Enter to traverse PL, MSA, wind FROM true north, and speed, then the next leg. Shift+Enter goes backwards. Blank altitude removes its override, and both wind fields blank removes manual wind. Enable per-leg winds in that panel or Route weather. Fetched forecasts have priority, then manual per-leg backup, then global wind. Editing PL invalidates a fetched forecast for that leg, as before. Settings use the existing autosave and undo mechanisms.

## Source and coverage

Source: https://aim-prod.avinor.no/no/AIP/

Initial imported edition: 2026-09-03, covering 53 AD 2 aerodromes and 299 published chart coordinate entries. Ten reviewed VFR point sequence definitions at ENDU, ENTC and ENSR are checksum-gated by their source charts, including NORA–ROSSVOLL. Coverage varies by aerodrome because not every visual chart publishes a machine-readable coordinate table. Coverage messages and official chart links are displayed when point extraction is unavailable. Points found only on helicopter charts and explicit helicopter-only notes are labelled. Other restrictions remain in the official chart; the catalog is not a complete classification of permissible aircraft or operations.

Route sequences represent ordered published reporting points, not digitized route geometry. The straight lines between points do not reproduce curved chart routes or guarantee terrain clearance. Charted altitude notes are shown as reference text; they do not override PL/MSA. Airport joins, holdings and circuits are not included. The user can also select a custom sequence of published points in chart-verified order.

## Refresh lifecycle

`npm run aip:update` resolves the latest edition effective today from Avinor's history, irrespective of link order. Future publication dates are retained as `nextEffectiveDate`; future editions are never substituted for today's edition. AD 2 chapter links are discovered from the official menu/AD 1.3, rather than a fixed airport list. HTML parsing excludes hidden AIXM annotations and deleted amendment text, and expands rowspans before reading runway/frequency cells. PDF coordinate tables are extracted from Poppler word bounding boxes, avoiding map terrain labels and PDF reading-order errors.

The Pages workflow checks daily at 04:17 UTC and on deployment. It installs Poppler, runs the refresh, tests, and builds. It commits the refreshed catalog and status to main with the Actions token so the next failed refresh retains the latest successful snapshot, rather than an increasingly old original fallback. Token-generated commits do not recursively trigger another workflow. The deployed JSON is fetched with cache revalidation; the chart-tile service worker does not cache the catalog. “Check deployed data” reloads the hosted snapshot; it does not contact Avinor directly from the browser.

`aip-status.json` records every attempt, including failures. A failed fetch, malformed mandatory fields, missing formerly covered aerodrome, corrupt PDF, or conflicting point coordinate refuses the entire replacement. Data from different editions are never combined. The existing snapshot is still deployed with a visible failure warning. Successful verification older than 48 hours, a future-only catalog, or a known next edition becoming effective produces a freshness warning. Old saved plans retain their original point coordinates and publication provenance; publication updates do not silently move a user's route.

Graphical route sequences live in `scripts/aip/verified-vfr-routes.json` with a SHA-256 of the reviewed source PDF. Only sequences whose chart checksum and all named points match the imported publication are included. A changed chart withholds the old sequence and produces a coverage warning until it is reviewed and the manifest is updated. Extend coverage by reviewing the current official chart, checking point order and all restrictions, and recording that chart's checksum. Never infer topology from PDF text order.

## Running locally

Use Node 22 or later, `npm ci`, and Poppler (`pdftotext`, supplied by `poppler-utils` on Ubuntu). Run `npm run aip:update`, `npm test`, and `npm run build`. Tests include real Avinor HTML/coordinate-table excerpts, amendment filtering, future-edition selection, checksum invalidation, provenance persistence/undo, and keyboard traversal. Fixtures are small excerpts retained for parser regression checks; PDFs are fetched from the official publication.

This mechanism tracks the published AIP baseline. It cannot guarantee continuous currency during publication/network failures, and it does not ingest NOTAM or AIP SUP. These must still be checked through official preflight sources. The AIP edition and ICAO basemap/chart edition are separate data products.
