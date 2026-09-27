"""Freeze the inputs of this run.

- manifest/sources.json : every input file with its URL, retrieval date, vintage, size and SHA-256.
- evidence/             : the inputs that live behind "current" URLs (FCC contour files, FCC station lists), cut to
                          the rows this study area can use, plus the FCC ownership workbooks (US government works),
                          so the run can be reproduced after the FCC replaces its daily files.
Run after etl/00_download.sh --refresh, never in reproduce mode."""
import gzip
import hashlib
import json
import os
import shutil

from shapely.geometry import Polygon, box

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "raw")
EVI = os.path.join(ROOT, "evidence")
AREA = box(-124.6, 35.9, -120.2, 39.9)  # same window as etl/02_load_fcc_acs.py

T = "https://www2.census.gov/geo/tiger/TIGER2025"
SOURCES = [
    ("tl_2025_us_county.zip", f"{T}/COUNTY/tl_2025_us_county.zip", "TIGER/Line 2025 (boundaries as of 2025-01-01)", "2026-09-27"),
    ("tl_2025_us_zcta520.zip", f"{T}/ZCTA520/tl_2025_us_zcta520.zip", "TIGER/Line 2025, 2020 ZCTAs", "2026-09-27"),
    ("tl_2025_06_tract.zip", f"{T}/TRACT/tl_2025_06_tract.zip", "TIGER/Line 2025", "2026-09-27"),
    ("tl_2025_06_bg.zip", f"{T}/BG/tl_2025_06_bg.zip", "TIGER/Line 2025", "2026-09-27"),
    ("tl_2025_06_place.zip", f"{T}/PLACE/tl_2025_06_place.zip", "TIGER/Line 2025 (boundaries as of 2025-01-01)", "2026-09-27"),
    ("tl_2025_us_cbsa.zip", f"{T}/CBSA/tl_2025_us_cbsa.zip", "TIGER/Line 2025 (OMB July 2023)", "2026-09-27"),
    ("tl_2025_us_csa.zip", f"{T}/CSA/tl_2025_us_csa.zip", "TIGER/Line 2025 (OMB July 2023)", "2026-09-27"),
    ("tl_2025_us_uac20.zip", f"{T}/UAC20/tl_2025_us_uac20.zip", "TIGER/Line 2025, 2020 urban areas", "2026-09-27"),
    ("tl_2025_06_tabblock20.zip", f"{T}/TABBLOCK20/tl_2025_06_tabblock20.zip", "TIGER/Line 2025, 2020 blocks with 2020 Census counts", "2026-09-27"),
    ("cb_2024_us_county_500k.zip", "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip", "Cartographic boundaries 2024 (display only)", "2026-09-27"),
    ("tab20_zcta520_county20_natl.txt", "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt", "2020 relationship file", "2026-09-27"),
    ("tab20_zcta520_tract20_natl.txt", "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt", "2020 relationship file", "2026-09-27"),
    ("ruca2020_tract.csv", "https://www.ers.usda.gov/media/5443/2020-rural-urban-commuting-area-codes-census-tracts.csv", "USDA ERS RUCA 2020, tract file", "2026-09-27"),
    ("ruca2020_zip.csv", "https://www.ers.usda.gov/media/5444/2020-rural-urban-commuting-area-codes-zip-codes.csv", "USDA ERS RUCA 2020, ZIP file", "2026-09-27"),
] + [
    (f"acsdt5y2024-{t}.dat", f"https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-{t}.dat",
     "ACS 2020-2024 5-year", "2026-09-27") for t in ("b01003", "b11001", "b03002", "b19001")
]
FCC = [  # (raw file, url, vintage, evidence file)
    ("FM_service_contour_current.zip", "https://transition.fcc.gov/bureaus/mb/databases/map/FM_service_contour_current.zip",
     "FCC daily file of 2026-09-26 (active records)", "fm_contours_bay_20260926.txt.gz"),
    ("TV_service_contour_current.zip", "https://transition.fcc.gov/bureaus/mb/databases/map/TV_service_contour_current.zip",
     "FCC daily file of 2026-09-26 (active records)", "tv_contours_bay_20260926.txt.gz"),
    ("fmq_CA.txt", "https://transition.fcc.gov/fcc-bin/fmq?state=CA&list=4&size=9", "FCC FM Query, California, retrieved 2026-09-27", "fmq_CA_20260927.txt.gz"),
    ("tvq_CA.txt", "https://transition.fcc.gov/fcc-bin/tvq?state=CA&list=4&size=9", "FCC TV Query, California, retrieved 2026-09-27", "tvq_CA_20260927.txt.gz"),
    ("fcc323_2023.zip", "https://www.fcc.gov/sites/default/files/323-spreadsheets.zip", "FCC Form 323 report tables, data as of 2023-10-01 (released Jan 2025)", "fcc323_2023.zip"),
    ("fcc323e_2023.zip", "https://www.fcc.gov/sites/default/files/323-e-spreadsheets.zip", "FCC Form 323-E report tables, data as of 2023-10-01 (released Jan 2025)", "fcc323e_2023.zip"),
]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cut_contours(src_txt, dst_gz):
    with open(src_txt, encoding="latin-1") as fh, gzip.open(dst_gz, "wt", encoding="latin-1") as out:
        out.write(next(fh))
        for line in fh:
            f = line.rstrip("\n").split("|")
            if len(f) < 10:
                continue
            pts = []
            for p in f[5:]:
                p = p.strip()
                if "," in p:
                    la, lo = p.split(",")
                    pts.append((float(lo), float(la)))
            if len(pts) >= 3 and Polygon(pts).buffer(0).intersects(AREA):
                out.write(line)


def main():
    os.makedirs(EVI, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "manifest"), exist_ok=True)
    rows = []
    for name, url, vintage, retrieved in SOURCES:
        p = os.path.join(RAW, name)
        rows.append({"file": name, "url": url, "vintage": vintage, "retrieved": retrieved, "bytes": os.path.getsize(p),
                     "sha256": sha(p), "kept": "no (versioned public file, fetched and verified by hash)"})
    for name, url, vintage, evi in FCC:
        p = os.path.join(RAW, name)
        dst = os.path.join(EVI, evi)
        if name.startswith(("FM_service", "TV_service")):
            txt = os.path.join(RAW, "fmc" if name.startswith("FM") else "tvc", name.replace(".zip", ".txt"))
            cut_contours(txt, dst)
            kept = "extract: contours intersecting the study window, same format"
        elif name.endswith(".txt"):
            with open(p, "rb") as fi, gzip.open(dst, "wb") as fo:
                shutil.copyfileobj(fi, fo)
            kept = "full file, gzipped"
        else:
            shutil.copyfile(p, dst)
            kept = "full file (US government work)"
        rows.append({"file": name, "url": url, "vintage": vintage, "retrieved": "2026-09-27", "bytes": os.path.getsize(p),
                     "sha256": sha(p), "kept": kept, "evidence_file": evi, "evidence_sha256": sha(dst)})
    with open(os.path.join(ROOT, "manifest", "sources.json"), "w") as f:
        json.dump({"run": "oakland-fm-audit 2026-09-27", "sources": rows}, f, indent=1)
    print(len(rows), "sources recorded")


if __name__ == "__main__":
    main()
