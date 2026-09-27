#!/bin/zsh
# Load the public Census geography for the nine Bay Area counties into PostGIS (schema raw).
# Sources (all public, no key): TIGER/Line 2025, 2020 block relationship files, USDA ERS RUCA 2020.
set -euo pipefail
cd "$(dirname "$0")/.."
PG="PG:${GEO_DSN:-host=/tmp port=5438 user=geo dbname=bay}"
PSQL=(bin/q)
for f in tl_2025_us_county tl_2025_06_tract tl_2025_06_bg tl_2025_06_tabblock20 tl_2025_06_place tl_2025_us_zcta520 \
         tl_2025_us_cbsa tl_2025_us_csa tl_2025_us_uac20; do
  [[ -f data/raw/$f/$f.shp ]] || { echo "missing data/raw/$f/$f.shp (run etl/00_download.sh)" >&2; exit 1; }
done
R=data/raw
COUNTIES="'001','013','041','055','075','081','085','095','097'"
# blocks also for the seven neighbouring counties that share a ZCTA with the nine (from the relationship file)
BLOCK_COUNTIES="$COUNTIES,'045','053','067','069','077','087','113'"
# bbox of the nine counties, generous (lon/lat, NAD83)
BBOX=(-123.64 36.89 -121.20 38.87)

"${PSQL[@]}" -c "create schema if not exists raw;"

load() { # $1 layer path, $2 table, rest = extra ogr2ogr args
  local src=$1 tbl=$2; shift 2
  ogr2ogr -q -f PostgreSQL "$PG" "$src" -nln raw.$tbl -overwrite -lco GEOMETRY_NAME=geom -lco FID=gid \
    -nlt PROMOTE_TO_MULTI -lco PRECISION=NO "$@"
}

load $R/tl_2025_us_county/tl_2025_us_county.shp county -where "STATEFP='06'"
load $R/tl_2025_06_tract/tl_2025_06_tract.shp tract -where "COUNTYFP in ($COUNTIES)"
load $R/tl_2025_06_bg/tl_2025_06_bg.shp bg -where "COUNTYFP in ($COUNTIES)"
load $R/tl_2025_06_tabblock20/tl_2025_06_tabblock20.shp block20 -where "COUNTYFP20 in ($BLOCK_COUNTIES)"
load $R/tl_2025_06_place/tl_2025_06_place.shp place -spat $BBOX
load $R/tl_2025_us_zcta520/tl_2025_us_zcta520.shp zcta -spat $BBOX
load $R/tl_2025_us_cbsa/tl_2025_us_cbsa.shp cbsa -spat $BBOX
load $R/tl_2025_us_csa/tl_2025_us_csa.shp csa -spat $BBOX
load $R/tl_2025_us_uac20/tl_2025_us_uac20.shp uac20 -spat $BBOX

# Official relationship file ZCTA <-> county (Census 2020), national, filtered at load.
"${PSQL[@]}" <<'SQL'
drop table if exists raw.rel_zcta_county;
create table raw.rel_zcta_county (oid_zcta text, zcta text, namelsad_zcta text, aland_zcta bigint, awater_zcta bigint,
  mtfcc_zcta text, classfp_zcta text, funcstat_zcta text, oid_county text, county text, namelsad_county text,
  aland_county bigint, awater_county bigint, mtfcc_county text, classfp_county text, funcstat_county text,
  aland_part bigint, awater_part bigint);
drop table if exists raw.ruca_tract;
create table raw.ruca_tract (tractfips23 text, countyfips23 text, countycode23 text, countyname23 text, tractfips20 text,
  tractcode20 text, tractname20 text, countyfips20 text, countycode20 text, countyname20 text, statefips20 text,
  statename20 text, urbanareacode20 text, urbanareaname20 text, urbancore text, urbancoretype text,
  primaryruca int, primaryrucadescription text, primarydestinationcode text, primarydestinationname text,
  secondaryruca numeric, secondaryrucadescription text, secondarydestinationcode text, secondarydestinationname text,
  population int, landarea numeric, popdensity numeric);
drop table if exists raw.ruca_zip;
create table raw.ruca_zip (zip text, state text, zip_type text, po_name text, primaryruca int, secondaryruca numeric);
SQL
tail -n +2 $R/tab20_zcta520_county20_natl.txt | sed 's/^\xef\xbb\xbf//' | \
  "${PSQL[@]}" -c "\copy raw.rel_zcta_county from stdin with (format csv, delimiter '|')"
"${PSQL[@]}" -c "\copy raw.ruca_tract from '$R/ruca2020_tract.csv' with (format csv, header true, encoding 'LATIN1')"
"${PSQL[@]}" -c "\copy raw.ruca_zip from '$R/ruca2020_zip.csv' with (format csv, header true, encoding 'LATIN1')"
echo "census loaded"
