#!/bin/zsh
# Fill data/raw.
#   (default) reproduce : fetch the versioned public files listed in manifest/sources.json, verify each SHA-256,
#                         and restore the FCC inputs of this run from evidence/ (their URLs serve "current" data).
#   --refresh           : fetch today's FCC files instead. The results will describe a new run: rerun
#                         etl/make_manifest.py so the displayed vintages follow the new inputs.
set -euo pipefail
ROOT=${0:A:h:h}
RAW=$ROOT/data/raw
mkdir -p $RAW
cd $RAW
MODE=${1:-reproduce}
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
PY=${PYTHON:-python3}

# versioned public files, verified by hash
$PY - "$ROOT/manifest/sources.json" <<'EOF' > fetch_list.tsv
import json, sys
for s in json.load(open(sys.argv[1]))["sources"]:
    if "evidence_file" not in s:
        print(f'{s["file"]}\t{s["url"]}\t{s["sha256"]}')
EOF
while IFS=$'\t' read -r name url want; do
  if [[ ! -f $name ]] || [[ $(shasum -a 256 $name | cut -d' ' -f1) != $want ]]; then
    curl -fsSL -A "$UA" -o $name "$url"
  fi
  got=$(shasum -a 256 $name | cut -d' ' -f1)
  if [[ $got != $want ]]; then
    echo "HASH MISMATCH $name: the publisher changed this file since the recorded run" >&2
    [[ $MODE == --refresh ]] || exit 1
  fi
done < fetch_list.tsv

if [[ $MODE == --refresh ]]; then
  F=https://transition.fcc.gov/bureaus/mb/databases/map
  curl -fsS -A "$UA" -o FM_service_contour_current.zip $F/FM_service_contour_current.zip
  curl -fsS -A "$UA" -o TV_service_contour_current.zip $F/TV_service_contour_current.zip
  curl -fsS -A "$UA" -o fmq_CA.txt "https://transition.fcc.gov/fcc-bin/fmq?state=CA&list=4&size=9"
  curl -fsS -A "$UA" -o tvq_CA.txt "https://transition.fcc.gov/fcc-bin/tvq?state=CA&list=4&size=9"
  unzip -o -q FM_service_contour_current.zip -d fmc
  unzip -o -q TV_service_contour_current.zip -d tvc
  # www.fcc.gov refuses scripted downloads of the ownership workbooks: save them from
  # https://www.fcc.gov/biennial-forms-323-and-323-e-broadcast-ownership-data-and-reports as fcc323_2023.zip and
  # fcc323e_2023.zip in data/raw (or keep the copies from evidence/, which are the same report).
  for f in fcc323_2023 fcc323e_2023; do [[ -f $f.zip ]] || cp $ROOT/evidence/$f.zip .; done
else
  E=$ROOT/evidence
  mkdir -p fmc tvc
  gunzip -c $E/fm_contours_bay_20260926.txt.gz > fmc/FM_service_contour_current.txt
  gunzip -c $E/tv_contours_bay_20260926.txt.gz > tvc/TV_service_contour_current.txt
  gunzip -c $E/fmq_CA_20260927.txt.gz > fmq_CA.txt
  gunzip -c $E/tvq_CA_20260927.txt.gz > tvq_CA.txt
  cp $E/fcc323_2023.zip $E/fcc323e_2023.zip .
fi

for f in tl_2025_*.zip; do unzip -o -q $f -d ${f%.zip}; done
unzip -o -q cb_2024_us_county_500k.zip -d cb_county
for f in fcc323_2023 fcc323e_2023; do unzip -o -q $f.zip -d $f; done
rm -f fetch_list.tsv
echo "data/raw ready ($MODE)"
