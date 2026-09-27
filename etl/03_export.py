"""Freeze the audit into static JSON for the page. Display geometry only (simplified); every number comes from
the PostGIS run and is copied as-is. Output: web/src/data/{audit,geo}.json"""
import json
import os
from datetime import date

import geopandas as gpd
import psycopg
from psycopg.rows import dict_row
from shapely import wkt
from shapely.geometry import box, mapping

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "web", "src", "data")
DSN = "host=/tmp port=5438 user=geo dbname=bay"
VIEW = box(-124.2, 36.2, -120.4, 39.4)  # base-map extraction window (lon/lat)
TOL = 0.0012  # ~120 m display simplification; analysis never uses these shapes


def d3_orient(geom):
    """d3-geo is spherical: exterior rings must be clockwise, holes counter-clockwise."""
    from shapely.geometry import MultiPolygon, Polygon
    from shapely.geometry.polygon import orient
    if isinstance(geom, Polygon):
        return orient(geom, sign=-1.0)
    if isinstance(geom, MultiPolygon):
        return MultiPolygon([orient(p, sign=-1.0) for p in geom.geoms])
    if hasattr(geom, "geoms"):
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        parts = []
        for g in polys:
            parts.extend(g.geoms if g.geom_type == "MultiPolygon" else [g])
        return MultiPolygon([orient(p, sign=-1.0) for p in parts])
    return geom


def rnd(geom, nd=4):
    geom = d3_orient(geom)
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    m = mapping(geom)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


def main():
    os.makedirs(OUT, exist_ok=True)
    con = psycopg.connect(DSN, row_factory=dict_row)
    cur = con.cursor()

    cur.execute("""
      select p.*, s.frequency,
        (select ST_AsText(ST_Transform(ST_Union(c.geom_aea), 4326)) from geo.audit_contour c
          where c.facility_id = p.facility_id and c.status = 'LIC' and c.service = p.service) as contour_wkt
      from geo.audit_policy p
      left join lateral (select frequency from raw.fcc_station_list s where s.facility_id = p.facility_id
                         and s.status = 'LIC' and s.service = p.service limit 1) s on true
      order by p.residents_est desc, p.callsign""")
    stations = []
    for r in cur.fetchall():
        g = wkt.loads(r.pop("contour_wkt")).simplify(TOL, preserve_topology=True)
        r["contour"] = rnd(g)
        for k, v in list(r.items()):
            if hasattr(v, "is_finite"):  # Decimal
                r[k] = float(v) if v % 1 else int(v)
        stations.append(r)

    def val(sql):
        cur.execute(sql)
        return list(cur.fetchone().values())

    zone_est, zone_low, zone_high = val("select round(sum(pop*w)) a, sum(pop) filter (where inside) b, sum(pop) filter (where w>0) c from geo.audit_block")
    edge_n, edge_pop = val("select count(*) a, sum(pop) b from geo.audit_block where w = 0")
    shortlist_union = val("""select est, low, high from geo.zone_pop_in((select ST_Union(c.geom_aea) from geo.audit_contour c
        join geo.audit_policy p on p.facility_id=c.facility_id and p.policy_research like 'in:%'
        where c.status='LIC' and c.service=p.service))""")
    all_union = val("""select est from geo.zone_pop_in((select ST_Union(c.geom_aea) from geo.audit_contour c
        join geo.audit_policy p on p.facility_id=c.facility_id and p.geo_status='qualifies'
        where c.status='LIC' and c.service=p.service))""")
    fm = [s for s in stations if s["service"] in ("FM", "FL")]
    qual = [s for s in fm if s["geo_status"] == "qualifies"]
    summary = {
        "zone": {"label": "Oakland city", "geoid": "0653000", "residents_2020": int(zone_est),
                 "residents_low": int(zone_low), "residents_high": int(zone_high),
                 "edge_only_blocks": int(edge_n), "edge_only_residents": int(edge_pop)},
        "touching": len(fm), "qualifying": len(qual),
        "research_in": sum(s["policy_research"].startswith("in") for s in fm),
        "research_owner": sum(s["policy_research"] == "in: reported ownership, not certified" for s in fm),
        "research_board": sum(s["policy_research"] == "in: reported board majority, nonprofit" for s in fm),
        "certified_na": sum(s["policy_certified"].startswith("not applicable") for s in fm),
        "research_confirm": sum(s["policy_research"] == "needs confirmation" for s in fm),
        "research_not_established": sum(s["policy_research"].startswith("not established") for s in fm),
        "certified_in": sum(s["policy_certified"].startswith("in") for s in fm),
        "certified_confirm": sum(s["policy_certified"].startswith("needs") for s in fm),
        "naive_any_minority": sum(1 for s in qual if s["any_minority"] == 1),
        "naive_any_minority_or_women": sum(1 for s in qual if s["any_minority"] == 1 or s["any_female"] == 1),
        "majority_minority": sum(1 for s in qual if s["maj_minority"] == 1),
        "majority_women": sum(1 for s in qual if s["maj_female"] == 1),
        "shortlist_union": {"est": int(shortlist_union[0]), "low": int(shortlist_union[1]), "high": int(shortlist_union[2])},
        "shortlist_sum": int(sum(s["residents_est"] for s in fm if s["policy_research"].startswith("in"))),
        "qualifying_union": int(all_union[0]),
        "qualifying_sum": int(sum(s["residents_est"] for s in qual)),
        "largest_record_differs": [s["callsign"] for s in fm if not s["largest_record"].endswith("/LIC") or not s["largest_record"].startswith(s["service"])],
        "rebroadcast_listed": sum(1 for s in stations if s["service"] in ("FX", "FB")),
        "boundary_uncertain": [s["callsign"] for s in fm if s["share_low"] < 0.5 <= s["share_high"]],
        "built": date.today().isoformat(),
    }

    contours_by_id = {s["facility_id"]: s["contour"] for s in stations}
    # display base map: Census cartographic boundary counties (shoreline-clipped), Oakland (TIGER place)
    cb = gpd.read_file(os.path.join(ROOT, "data/raw/cb_county/cb_2024_us_county_500k.shp"))
    cb = cb[cb.STATEFP == "06"].to_crs(4326)
    cb = cb[cb.intersects(VIEW)]
    counties = []
    bay9 = {"001", "013", "041", "055", "075", "081", "085", "095", "097"}
    for _, r in cb.iterrows():
        g = r.geometry.intersection(VIEW.buffer(0.3)).simplify(TOL, preserve_topology=True)
        counties.append({"geoid": r.GEOID, "name": r.NAME, "bay": r.COUNTYFP in bay9, "geom": rnd(g)})
    land = cb.union_all()
    # internal county lines on land only (shoreline-clipped polygons still meet across some water)
    from shapely.ops import unary_union
    lines = unary_union([g.boundary for g in cb.geometry]).intersection(land.buffer(-0.002))
    lines = lines.simplify(TOL)
    cur.execute("select ST_AsText(ST_Transform(geom,4326)) w from geo.place where geoid='0653000'")
    oak = wkt.loads(cur.fetchone()["w"])
    oak_land = oak.intersection(land)
    from shapely.geometry import shape
    drawn = [shape(contours_by_id[s["facility_id"]]) for s in stations
             if s["service"] in ("FM", "FL") and not s["policy_research"].startswith(("out", "not"))]
    minx, miny, maxx, maxy = unary_union(drawn).bounds
    geo = {"view": [minx - 0.04, miny - 0.04, maxx + 0.04, maxy + 0.04], "counties": counties,
           "county_lines": mapping(lines) if not lines.is_empty else None,
           "oakland": rnd(oak.simplify(0.0004)), "oakland_land": rnd(oak_land.simplify(0.0004)),
           "places": []}
    for name, lon, lat in [("San Francisco", -122.4194, 37.7749), ("San Jose", -121.8863, 37.3382),
                           ("Berkeley", -122.2730, 37.8715), ("Walnut Creek", -122.0652, 37.9101),
                           ("Santa Rosa", -122.7141, 38.4405), ("Livermore", -121.7680, 37.6819),
                           ("San Mateo", -122.3255, 37.5630), ("Vallejo", -122.2566, 38.1041)]:
        geo["places"].append({"name": name, "lon": lon, "lat": lat})

    contours = {s["facility_id"]: s.pop("contour") for s in stations}  # server-side only (map paths)
    with open(os.path.join(OUT, "audit.json"), "w") as f:
        json.dump({"summary": summary, "stations": stations}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "contours.json"), "w") as f:
        json.dump(contours, f, separators=(",", ":"))
    with open(os.path.join(OUT, "geo.json"), "w") as f:
        json.dump(geo, f, separators=(",", ":"))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
