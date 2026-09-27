"""Load FCC broadcast data (FM/TV service contours, station list, Form 323/323-E ownership 2023) and
ACS 2020-2024 5-year tables into PostGIS (schema raw). Public sources, no key.

FCC files: transition.fcc.gov/bureaus/mb/databases/map/{FM,TV}_service_contour_current.zip,
transition.fcc.gov/fcc-bin/{fmq,tvq}?state=CA&list=4, fcc.gov/sites/default/files/323-spreadsheets.zip and
323-e-spreadsheets.zip (Report on Ownership of Broadcast Stations, data as of Oct 1, 2023).
ACS: www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/.
"""
import glob
import io
import os

import pandas as pd
import psycopg
from shapely.geometry import Polygon, box

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
DSN = "host=/tmp port=5438 user=geo dbname=bay"
# nine-county bbox, widened by ~1 degree so every contour that can touch the area is kept
AREA = box(-124.6, 35.9, -120.2, 39.9)


def parse_list(path):
    """FCC fmq/tvq 'list=4' pipe format -> DataFrame with the columns we use."""
    rows = []
    for line in open(path, encoding="latin-1"):
        f = [x.strip() for x in line.split("|")]
        if len(f) < 38:
            continue
        rows.append({
            "callsign": f[1], "frequency": f[2].replace("MHz", "").strip(), "service": f[3], "channel": f[4], "station_class": f[7], "status": f[9], "city": f[10], "state": f[11],
            "facility_id": int(f[18]) if f[18].isdigit() else None, "licensee": f[27],
            "lms_hash_a": f[-3], "lms_hash_b": f[-2],
        })
    return pd.DataFrame(rows)


def parse_contours(path):
    out = []
    with open(path, encoding="latin-1") as fh:
        next(fh)
        for line in fh:
            f = line.rstrip("\n").split("|")
            if len(f) < 10:  # the FCC file carries a few stray HTML lines
                continue
            app_id, service, lms_id, site = f[0].strip(), f[1].strip(), f[2].strip(), f[3].strip()
            pts = []
            for p in f[5:]:
                p = p.strip()
                if not p or "," not in p:
                    continue
                la, lo = p.split(",")
                pts.append((float(lo), float(la)))
            if len(pts) < 3:
                continue
            poly = Polygon(pts)
            if not poly.intersects(AREA):
                continue
            tla, tlo = [float(x) for x in f[4].split(",")]
            out.append({"application_id": app_id, "service": service, "lms_application_id": lms_id,
                        "site": site, "tx_lon": tlo, "tx_lat": tla, "wkt": poly.buffer(0).wkt})
    return pd.DataFrame(out)


def load_323():
    frames = []
    for path in glob.glob(os.path.join(RAW, "fcc323*_2023", "**", "*.xlsx"), recursive=True):
        kind = os.path.basename(path).replace(".xlsx", "")
        any_ = pd.read_excel(path, sheet_name=0, header=1)
        maj = pd.read_excel(path, sheet_name=1, header=1)
        any_ = any_.rename(columns=lambda c: str(c).strip())
        maj = maj.rename(columns=lambda c: str(c).strip())
        keep_any = ["Female", "Hispanic", "Asian", "Black / African American", "American Indian / Alaska Native",
                    "Native Hawaiian / Pacific Islander", "Racial and/or Ethnic Minority"]
        # The report carries two identities: the licensee AS OF the report date (10/1/2023), which is the one the
        # ownership data describes, and the licensee as of December 2024, added at publication.
        a = any_[["FCC ID", "Call Sign (as of December 2024)", "10/1/2023 Call Sign (if different)", "City", "State",
                  "10/1/2023 Licensee", "Licensee (as of December 2024)"] + keep_any]
        a.columns = ["facility_id", "callsign_dec2024", "callsign_2023", "city_323", "state_323", "licensee_2023",
                     "licensee_dec2024"] + [
            "any_" + c.lower().replace(" / ", "_").replace(" ", "_").replace("/", "_") for c in keep_any]
        keep_maj = ["Female", "Joint Female/Male", "Hispanic", "Asian", "Black / African American",
                    "American Indian / Alaska Native", "Native Hawaiian / Pacific Islander",
                    "Racial and/or Ethnic Minority", "No Majority Interest Race", "Not Filed", "Insufficient Data"]
        m = maj[["FCC ID"] + keep_maj]
        m.columns = ["facility_id"] + ["maj_" + c.lower().replace(" / ", "_").replace(" ", "_").replace("/", "_")
                                       for c in keep_maj]
        d = a.merge(m, on="facility_id", how="outer")
        d["report_file"] = kind
        frames.append(d)
    return pd.concat(frames, ignore_index=True)


ACS_TABLES = {
    "b01003": {"B01003_E001": "pop"},
    "b11001": {"B11001_E001": "households"},
    "b03002": {"B03002_E003": "nh_white", "B03002_E004": "nh_black", "B03002_E006": "nh_asian",
               "B03002_E012": "hispanic"},
    "b19001": {"B19001_E001": "hh_income_universe", "B19001_E014": "hh_100_125k", "B19001_E015": "hh_125_150k",
               "B19001_E016": "hh_150_200k", "B19001_E017": "hh_200k_plus"},
}
KEEP_PREFIX = ("1500000US06", "0500000US", "310M700US", "330M700US", "1600000US06", "860Z200US9")


def load_acs():
    merged = None
    for t, cols in ACS_TABLES.items():
        df = pd.read_csv(os.path.join(RAW, f"acsdt5y2024-{t}.dat"), sep="|", dtype=str,
                         usecols=["GEO_ID"] + list(cols))
        df = df[df.GEO_ID.str.startswith(KEEP_PREFIX)].rename(columns=cols)
        merged = df if merged is None else merged.merge(df, on="GEO_ID", how="outer")
    for c in merged.columns[1:]:
        merged[c] = pd.to_numeric(merged[c], errors="coerce")
    return merged.rename(columns={"GEO_ID": "geo_id"})


def copy_df(cur, df, table, ddl):
    cur.execute(f"drop table if exists {table}; create table {table} ({ddl});")
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False)
    buf.seek(0)
    with cur.copy(f"copy {table} from stdin with (format csv)") as cp:
        cp.write(buf.read())


def main():
    fm = parse_list(os.path.join(RAW, "fmq_CA.txt"))
    tv = parse_list(os.path.join(RAW, "tvq_CA.txt"))
    stations = pd.concat([fm.assign(band="FM"), tv.assign(band="TV")], ignore_index=True)
    cont = pd.concat([parse_contours(glob.glob(os.path.join(RAW, "fmc", "*.txt"))[0]).assign(band="FM"),
                      parse_contours(glob.glob(os.path.join(RAW, "tvc", "*.txt"))[0]).assign(band="TV")],
                     ignore_index=True)
    own = load_323()
    acs = load_acs()
    with psycopg.connect(DSN, autocommit=True) as con, con.cursor() as cur:
        copy_df(cur, stations, "raw.fcc_station_list",
                "callsign text, frequency text, service text, channel text, station_class text, status text, city text, state text, facility_id int, "
                "licensee text, lms_hash_a text, lms_hash_b text, band text")
        copy_df(cur, cont[["application_id", "service", "lms_application_id", "site", "tx_lon", "tx_lat", "band", "wkt"]],
                "raw.fcc_contour", "application_id text, service text, lms_application_id text, site text, "
                "tx_lon float8, tx_lat float8, band text, wkt text")
        cur.execute("alter table raw.fcc_contour add column geom geometry(MultiPolygon,4269); "
                    "update raw.fcc_contour set geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(wkt,4269)),3));")
        own_cols = list(own.columns)
        copy_df(cur, own, "raw.fcc_323_2023", ", ".join(
            f"{c} {'int' if c.startswith(('any_', 'maj_')) or c == 'facility_id' else 'text'}" for c in own_cols))
        copy_df(cur, acs, "raw.acs5_2024", ", ".join(
            [f"{c} {'text' if c == 'geo_id' else 'float8'}" for c in acs.columns]))
    print(len(stations), "stations in list;", len(cont), "contours near the bay;", len(own), "323 rows;",
          len(acs), "ACS rows")


if __name__ == "__main__":
    main()
