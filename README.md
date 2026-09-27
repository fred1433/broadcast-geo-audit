# broadcast-geo-audit

Which FM stations put at least half of a city's residents inside their modeled service contour, and what their
FCC ownership filings actually establish. Worked example: Oakland, California. Live page:
https://oakland-radio.theaipipe.com

Everything is built from public US government records (Census, FCC, USDA, IRS). The raw files are not in this
repository; `etl/00_download.sh` fetches them. The page ships a frozen export of the results (`web/src/data/`).

## What it does
- Loads 2020 Census blocks, tracts, block groups, places, ZCTAs, CBSAs and urban areas for the nine Bay Area
  counties into PostGIS, with the official ZCTA to county relationship file, USDA RUCA 2020 and ACS 2020-2024.
- Loads FCC FM/TV service contours (daily file), the FM/TV Query station list and the FCC Report on Ownership of
  Broadcast Stations (Forms 323 and 323-E, data as of Oct 1, 2023).
- Allocates residents to any polygon from 2020 blocks, with low / high allocation bounds.
- Audits every licensed FM and LPFM contour that touches Oakland (Census place 0653000) against a written rule
  (at least 50% of residents), then classifies ownership evidence under two export policies: research shortlist
  and certified export.

The general drawn-area functions in `sql/20_functions.sql` are experimental and not validated by this audit.

Decisions that the tests pin (see `tests/`): contours are the licensed record, not the largest on file; board
majorities of nonprofits (Form 323-E) are never counted as ownership; nonprofits and public bodies are "not
applicable" to ownership-based certification; a 2023 filing is read with the licensee of that date; missing or
insufficient data stays unresolved; the union of contours is used, never the sum.

## Reproduce this run, or refresh it
Two modes, kept apart on purpose:
- **Reproduce** (default): `etl/00_download.sh` fetches the versioned public files listed in
  `manifest/sources.json` and stops if a SHA-256 differs; the FCC inputs, whose URLs serve "current" data, are
  restored from `evidence/` (contour and station-list extracts of Sept 26-27, 2026, and the FCC ownership workbooks).
  The rebuilt export must match `web/src/data/` byte for byte.
- **Refresh**: `etl/00_download.sh --refresh` takes today's FCC files. That is a new run: rerun
  `etl/make_manifest.py` so the vintages shown on the page follow the new inputs.

Requirements: PostgreSQL with PostGIS 3.x, GDAL (`ogr2ogr`), Python 3.12+, Node 20+. `bin/q` uses `PSQL`
(client binary, default `psql`) and `GEO_DSN` (libpq string, default `host=/tmp port=5438 user=geo dbname=bay`).

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./etl/00_download.sh                      # about 1.5 GB into data/raw, hashes verified
initdb -D data/build/pg -U geo --auth=trust && pg_ctl -D data/build/pg -o "-p 5438 -k /tmp" start
createdb -h /tmp -p 5438 -U geo bay && psql -h /tmp -p 5438 -U geo bay -c "create extension postgis"
bin/rebuild                               # stops on the first failed load or SQL statement
.venv/bin/python -m pytest -q tests
.venv/bin/python etl/03_export.py && git diff --stat web/src/data web/public   # empty diff = reproduced
cd web && npm ci && npm run build
```

A clean-environment reproduction of this commit is recorded in `docs/rebuild_log.md`.

## Layout
- `etl/` download, load (shell + Python), manifest, export
- `manifest/`, `evidence/` the inputs of this run
- `sql/10_model.sql` the geographic model (analysis in EPSG:5070, crosswalks, empty slots for licensed data)
- `sql/20_functions.sql` EXPERIMENTAL drawn-area helpers, outside the audit (ACS without margins of error)
- `sql/30_oakland_audit.sql`, `sql/40_audit_decisions.sql` the audit and its policies
- `tests/` foundation and audit checks
- `web/` Next.js page (static)

## Limits
AM is out of scope (no comparable FCC contour file). Contours are F(50,50) predictions, not reception.
Residents are 2020 Census counts, not an audience. FCC ownership data is self-reported and dated; no
certification (NMSDC, WBENC or other) is derived from it. Nielsen DMA data is licensed and not included.
