# Map sources

## Kartverket / Norgeskart

The public build uses Kartverket's official WMTS cache service, `topo` layer in EPSG:3857 (`webmercator`). The service is loaded directly by Leaflet and requires no API key.

## Avinor Norway Aeronautical Chart ICAO 1:500 000

Avinor's AIS portal exposes the Norway Aeronautical Chart to users through an ArcGIS application. A legacy public integration also references an Avinor ArcGIS `ICAO_500000` MapServer export endpoint.

However, Avinor's current professional-user information states that ICAO 1:500 000 PDF and GeoTIFF products are subject to a contract governing personal use and reuse in products made available to third parties. Because this repository is public, the application does not hard-code or redistribute the aeronautical chart service until reuse rights are confirmed.

The UI and map architecture support the chart as either a base layer or a semi-transparent overlay. To enable it after confirming authorization, set `VITE_AVINOR_ICAO_EXPORT_URL` to the approved ArcGIS MapServer endpoint ending at `/MapServer`. Do not place tokens or credentials in the browser bundle.

Route geometry and navigation state are independent of the selected base map.
