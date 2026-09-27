"""Checks of the geographic foundation against published truths and against its own invariants.
Run: .venv/bin/python -m pytest -q tests   (needs the local PostGIS on port 5438 built by etl/ + sql/)."""
import os

import psycopg
import pytest

DSN = os.environ.get("GEO_DSN", "host=/tmp port=5438 user=geo dbname=bay")

# 2020 Census (P.L. 94-171) county totals, as published by the Census Bureau.
OFFICIAL_2020 = {"06001": 1682353, "06013": 1165927, "06041": 262321, "06055": 138019, "06075": 873965,
                 "06081": 764442, "06085": 1936259, "06095": 453491, "06097": 488863}


@pytest.fixture(scope="module")
def cur():
    with psycopg.connect(DSN) as con:
        yield con.cursor()


def one(cur, sql, *args):
    cur.execute(sql, args)
    return cur.fetchone()


def test_block_counts_reproduce_official_county_totals(cur):
    cur.execute("select county_geoid, sum(pop) from geo.block where in_area group by 1")
    assert {k: int(v) for k, v in cur.fetchall()} == OFFICIAL_2020


def test_apportioning_a_county_polygon_returns_the_county(cur):
    # the drawn-area engine, fed a whole county, must give back its 2020 total (edge blocks cut by
    # water or shoreline simplification are the only tolerance)
    pop, = one(cur, "select pop from geo.apportion((select ST_GeometryN(geom,1) from geo.county where geoid='06075' ))")
    got_all, = one(cur, "select sum(pop) from geo.block where county_geoid='06075' and ST_Within(pt, (select ST_GeometryN(geom,1) from geo.county where geoid='06075'))")
    assert abs(pop - got_all) / got_all < 0.001


def test_apportion_is_additive(cur):
    a, = one(cur, "select pop from geo.apportion(ST_MakeEnvelope(-122.30,37.78,-122.25,37.82,4269))")
    b, = one(cur, "select pop from geo.apportion(ST_MakeEnvelope(-122.25,37.78,-122.20,37.82,4269))")
    ab, = one(cur, "select pop from geo.apportion(ST_MakeEnvelope(-122.30,37.78,-122.20,37.82,4269))")
    # tolerance: rounding plus sliver areas where two block edges do not share exact vertices
    assert abs((a + b) - ab) / ab < 0.0001


def test_every_populated_block_has_a_zcta_and_zcta_parts_add_up(cur):
    missing, = one(cur, "select coalesce(sum(pop),0) from geo.block_xwalk where in_area and zcta is null and pop > 0")
    assert missing < 0.0001 * sum(OFFICIAL_2020.values())
    parts, = one(cur, "select sum(pop_part) from geo.zcta_county")
    assigned, = one(cur, "select sum(pop) from geo.block_xwalk where zcta is not null")
    assert parts == assigned


def test_block_to_zcta_by_internal_point_matches_largest_overlap(cur):
    # Census builds ZCTAs from whole blocks; the internal point must land in the same ZCTA as the block's area
    n, = one(cur, """select count(*) from geo.block b join geo.block_xwalk x on x.block_geoid=b.geoid
        cross join lateral (select z.zcta from geo.zcta z where ST_Intersects(z.geom_aea,b.geom_aea)
                            order by ST_Area(ST_Intersection(z.geom_aea,b.geom_aea)) desc limit 1) a
        where b.county_geoid='06075' and b.pop>0 and x.zcta is not null and x.zcta <> a.zcta""")
    assert n == 0
    # a few populated blocks sit in NO ZCTA at all (Census leaves them out); they must stay marginal
    orphan, = one(cur, "select coalesce(sum(pop),0) from geo.block_xwalk where in_area and zcta is null")
    assert orphan < 1000


def test_naive_zcta_sum_overstates_a_drawn_area(cur):
    true, = one(cur, "select pop from geo.apportion((select geom from geo.demo_zone where id='oakland_flats'))")
    naive, = one(cur, "select pop_sum_of_touched_zctas from geo.naive_zcta((select geom from geo.demo_zone where id='oakland_flats'))")
    assert float(naive) > 1.5 * float(true)


def test_every_populated_tract_is_classified(cur):
    n, = one(cur, "select count(*) from geo.tract_class where pop20 > 0 and klass is null")
    assert n == 0


def test_no_auxiliary_transmitter_counts_as_a_station(cur):
    n, = one(cur, "select count(*) from geo.station where service in ('FS','FA')")
    assert n == 0


def test_majority_is_stricter_than_any_interest(cur):
    maj, anyi = one(cur, """select count(*) filter (where maj_minority=1), count(*) filter (where any_minority=1)
        from geo.stations_reaching((select geom from geo.demo_zone where id='oakland_flats'), 0.5)""")
    assert maj < anyi
    # QA of the SOURCE: a majority-owned station should also carry an attributable minority interest.
    # The FCC 2023 tables break this on exactly two AM rows (WHNM, DDWIRB); pinned so a new vintage is re-checked.
    cur.execute("""select callsign_dec2024 from geo.station_ownership
        where maj_racial_and_or_ethnic_minority=1 and coalesce(any_racial_and_or_ethnic_minority,0)=0 order by 1""")
    assert [r[0] for r in cur.fetchall()] == ["DDWIRB", "WHNM"]


def test_san_francisco_city_and_county_are_the_same_people(cur):
    place, = one(cur, "select sum(pop) from geo.block_xwalk where place_geoid='0667000'")
    county = OFFICIAL_2020["06075"]
    assert abs(place - county) / county < 0.001
