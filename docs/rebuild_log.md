# Clean-environment reproduction, 2026-09-27

Commit reproduced: b5df5b5 (the correction pass; reproduced as e0f6a88 before the author rewrite, same tree), cloned into an empty temporary directory.

| Step | Result |
|---|---|
| Fresh clone, fresh Python venv, `pip install -r requirements.txt` | ok |
| `etl/00_download.sh` (reproduce mode): versioned Census and USDA files downloaded, every SHA-256 checked against `manifest/sources.json`; FCC inputs restored from `evidence/` | ok, 2 min 34 s |
| New PostgreSQL 18.x cluster with PostGIS 3.6.4 (port 5439), `PSQL` and `GEO_DSN` set, `bin/rebuild` | ok, 53 s |
| `pytest tests` | 30 passed |
| `etl/03_export.py`, then `git status` | no change: `web/src/data/*.json` and `web/public/oakland_fm_audit_decisions.csv` identical to the committed files |
| Failure check: a broken statement appended to `sql/zones.sql` | `bin/rebuild` stopped with exit status 3 and the SQL error, no "rebuilt" line |
| `npm ci && npm run build` in `web/` | ok |

Machine: macOS (Apple silicon), Homebrew PostgreSQL 18 + PostGIS 3.6.4, GDAL 3.13.3, Python 3.14.
Not covered: `--refresh` mode (by design it produces a different run), other operating systems.
