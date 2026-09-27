#!/bin/zsh
# Download every public input into data/raw (about 1.5 GB, not redistributed in this repository).
set -euo pipefail
cd "$(dirname "$0")/../data/raw" 2>/dev/null || { mkdir -p "$(dirname "$0")/../data/raw"; cd "$(dirname "$0")/../data/raw"; }
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
T=https://www2.census.gov/geo/tiger/TIGER2025
for u in COUNTY/tl_2025_us_county.zip ZCTA520/tl_2025_us_zcta520.zip TRACT/tl_2025_06_tract.zip BG/tl_2025_06_bg.zip \
         PLACE/tl_2025_06_place.zip CBSA/tl_2025_us_cbsa.zip CSA/tl_2025_us_csa.zip UAC20/tl_2025_us_uac20.zip \
         TABBLOCK20/tl_2025_06_tabblock20.zip; do
  curl -sS -o "$(basename $u)" "$T/$u" &
done
curl -sS -o cb_2024_us_county_500k.zip https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip &
R=https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520
curl -sS -o tab20_zcta520_county20_natl.txt $R/tab20_zcta520_county20_natl.txt &
curl -sS -o tab20_zcta520_tract20_natl.txt $R/tab20_zcta520_tract20_natl.txt &
A=https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData
for t in b01003 b11001 b03002 b19001; do curl -sS -o acsdt5y2024-$t.dat $A/acsdt5y2024-$t.dat & done
wait
curl -sSL -A "$UA" -o ruca2020_tract.csv "https://www.ers.usda.gov/media/5443/2020-rural-urban-commuting-area-codes-census-tracts.csv"
curl -sSL -A "$UA" -o ruca2020_zip.csv "https://www.ers.usda.gov/media/5444/2020-rural-urban-commuting-area-codes-zip-codes.csv"
F=https://transition.fcc.gov/bureaus/mb/databases/map
curl -sS -A "$UA" -o FM_service_contour_current.zip $F/FM_service_contour_current.zip
curl -sS -A "$UA" -o TV_service_contour_current.zip $F/TV_service_contour_current.zip
curl -sS -A "$UA" -o fmq_CA.txt "https://transition.fcc.gov/fcc-bin/fmq?state=CA&list=4&size=9"
curl -sS -A "$UA" -o tvq_CA.txt "https://transition.fcc.gov/fcc-bin/tvq?state=CA&list=4&size=9"
for f in *.zip; do unzip -o -q "$f" -d "${f%.zip}"; done
mv -f FM_service_contour_current fmc 2>/dev/null || true
mv -f TV_service_contour_current tvc 2>/dev/null || true
mv -f cb_2024_us_county_500k cb_county 2>/dev/null || true

# FCC ownership report (Forms 323 / 323-E, data as of Oct 1, 2023). www.fcc.gov refuses scripted downloads:
# open https://www.fcc.gov/biennial-forms-323-and-323-e-broadcast-ownership-data-and-reports in a browser,
# save "Form 323 Spreadsheets" and "Form 323-E Spreadsheets" (the 2023 row) as fcc323_2023.zip and
# fcc323e_2023.zip in data/raw, then:
for f in fcc323_2023 fcc323e_2023; do
  if [[ -f $f.zip ]]; then unzip -o -q $f.zip -d $f; else echo "missing $f.zip (manual download, see above)"; fi
done
echo "downloads done"
