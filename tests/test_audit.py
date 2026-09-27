"""Tests of the Oakland FM audit: geography accounting, media evidence, and the claims the page makes.
Synthetic cases are labelled as such; everything else runs on the real frozen data."""
import psycopg
import pytest

DSN = "host=/tmp port=5438 user=geo dbname=bay"


@pytest.fixture(scope="module")
def cur():
    with psycopg.connect(DSN) as con:
        yield con.cursor()


def one(cur, sql, *a):
    cur.execute(sql, a or None)
    return cur.fetchone()


# ---------- geography and accounting ----------
def test_zone_total_reconciles_to_published_place_count(cur):
    est, = one(cur, "select round(sum(pop*w)) from geo.audit_block")
    assigned, = one(cur, "select sum(pop) from geo.block_xwalk where place_geoid='0653000'")
    assert assigned == 440646                     # 2020 Census, Oakland city
    assert abs(float(est) - float(assigned)) / float(assigned) < 0.002


def test_bounds_bracket_the_estimate(cur):
    bad, = one(cur, "select count(*) from geo.audit_station where not (residents_low <= residents_est and residents_est <= residents_high)")
    assert bad == 0


def test_one_row_per_facility_no_join_duplication(cur):
    a, b, c = one(cur, "select (select count(*) from geo.audit_station), (select count(*) from geo.audit_result), (select count(distinct facility_id) from geo.audit_result)")
    assert a == b == c


def test_synthetic_single_point_touch_does_not_qualify(cur):
    # SYNTHETIC: a square that shares exactly one corner with a block of the zone intersects it, yet holds nobody
    touches, share = one(cur, """
        with blk as (select geom_aea from geo.audit_block where inside order by geoid limit 1),
        corner as (select ST_PointN(ST_ExteriorRing(ST_GeometryN(geom_aea,1)),1) p from blk),
        sq as (select ST_MakeEnvelope(ST_X(p), ST_Y(p), ST_X(p)+1000, ST_Y(p)+1000, 5070) g from corner)
        select ST_Intersects((select geom_aea from blk), sq.g) and ST_Area(ST_Intersection((select geom_aea from blk), sq.g)) = 0,
               coalesce((select est from geo.zone_pop_in(sq.g)), 0) from sq""")
    assert share == 0 or touches is False


def test_union_never_exceeds_zone_and_sum_double_counts(cur):
    union_est, sum_est, zone = one(cur, """
        select (select est from geo.zone_pop_in((select ST_Union(c.geom_aea) from geo.audit_contour c
                 join geo.audit_policy p on p.facility_id=c.facility_id and p.policy_research like 'in:%'
                 where c.status='LIC' and c.service in ('FM','FL')))),
               (select sum(residents_est) from geo.audit_policy where policy_research like 'in:%'),
               (select round(sum(pop*w)) from geo.audit_block)""")
    assert union_est <= zone
    assert sum_est > union_est


# ---------- media evidence ----------
def test_contour_is_the_licensed_authorization_not_the_largest(cur):
    # every audited contour comes from a record with status LIC and the facility's own service code
    bad, = one(cur, """select count(*) from geo.audit_station a
        where exists (select 1 from unnest(string_to_array(a.licensed_application_ids, ',')) app
                      where not exists (select 1 from geo.audit_contour c where c.application_id = app and c.status='LIC'
                                        and c.facility_id = a.facility_id))""")
    assert bad == 0
    # and the audit records where the "largest contour" rule would have picked something else
    cur.execute("select callsign, largest_record from geo.audit_station where service in ('FM','FL') and largest_record not like service||'/LIC' order by 1")
    assert cur.fetchall() == [("KBAY", "FM/APP"), ("KIOI", "FS/LIC")]


def test_auxiliary_transmitters_never_qualify(cur):
    n, = one(cur, "select count(*) from geo.audit_result where service in ('FS','FA')")
    assert n == 0


def test_noncommercial_rows_are_labelled_governance_not_equity(cur):
    n, = one(cur, "select count(*) from geo.audit_result where report_file like '%Noncommercial%' and interest_kind not like '%governing board%'")
    assert n == 0


def test_superseded_licensee_is_unresolved(cur):
    ev, = one(cur, "select evidence from geo.audit_result where callsign='KLVS'")
    assert ev.startswith("unresolved: licensee changed")


def test_missing_filing_is_never_read_as_not_diverse(cur):
    cur.execute("select evidence from geo.audit_result where report_file is null and service in ('FM','FL')")
    assert all(r[0].startswith("unresolved") for r in cur.fetchall())


# ---------- claims and export ----------
def test_certified_policy_never_admits_anyone_from_fcc_sources(cur):
    n, = one(cur, "select count(*) from geo.audit_policy where policy_certified like 'in%'")
    assert n == 0


def test_no_default_certified_only_filter_and_counts_frozen(cur):
    cur.execute("select policy_research, count(*) from geo.audit_policy where service in ('FM','FL') group by 1 order by 1")
    assert dict(cur.fetchall()) == {"in: reported ownership, not certified": 2,
                                    "in: reported board majority, nonprofit": 2, "needs confirmation": 4,
                                    "not established from these sources": 26, "out: geographic rule": 6}


def test_touch_rule_would_admit_more_stations(cur):
    touch, rule = one(cur, """select count(*), count(*) filter (where geo_status='qualifies')
                              from geo.audit_station where service in ('FM','FL')""")
    assert (touch, rule) == (40, 34)


def test_blocks_that_only_share_an_edge_add_nobody(cur):
    # real case: blocks next to Oakland that touch its boundary along a line intersect it, with zero area inside
    n, pop = one(cur, "select count(*), sum(pop) from geo.audit_block where w = 0")
    assert n > 0 and pop > 0
    bad, = one(cur, "select count(*) from geo.audit_station where residents_high > (select sum(pop) from geo.audit_block where w > 0)")
    assert bad == 0


def test_contour_threshold_matches_class_rule_on_two_real_stations(cur):
    # Recorded FCC distance API results (geo.fcc.gov/api/contours/distance.json, F(50,50), 27/09/2026):
    #   KRBQ  33 kW / 319 m : 54 dBu -> 76.6 km, 60 dBu -> 62.6 km   (class B, commercial: 54 dBu expected)
    #   KQED-FM 110 kW / 387 m : 54 dBu -> 93.3 km, 60 dBu -> 79.8 km (reserved band NCE: 60 dBu expected)
    def mean_radius(call):
        r, = one(cur, """select avg(ST_Distance(ST_Transform(ST_SetSRID(ST_MakePoint(c.tx_lon,c.tx_lat),4269),5070), (dp).geom))/1000
            from raw.fcc_contour c join raw.fcc_station_list s on s.lms_hash_a=c.lms_application_id,
            lateral ST_DumpPoints(ST_Transform(ST_ExteriorRing(ST_GeometryN(c.geom,1)),5070)) dp
            where s.callsign=%s and s.service='FM' and s.status='LIC'""", call)
        return float(r)
    assert abs(mean_radius("KRBQ") - 76.6) < abs(mean_radius("KRBQ") - 62.6)
    assert abs(mean_radius("KQED-FM") - 79.8) < abs(mean_radius("KQED-FM") - 93.3)
    d1, = one(cur, "select contour_dbu from geo.audit_result where callsign='KRBQ'")
    d2, = one(cur, "select contour_dbu from geo.audit_result where callsign='KQED-FM'")
    assert (d1, d2) == (54, 60)



def test_board_majority_is_never_counted_as_ownership(cur):
    cur.execute("select callsign, policy_research from geo.audit_policy where policy_research like 'in:%' order by 1")
    assert cur.fetchall() == [("KPFA", "in: reported board majority, nonprofit"),
                              ("KQED-FM", "in: reported board majority, nonprofit"),
                              ("KRZZ", "in: reported ownership, not certified"),
                              ("KSJO", "in: reported ownership, not certified")]


def test_certified_export_separates_candidates_from_out_of_scope(cur):
    cur.execute("""select policy_certified, string_agg(callsign, ',' order by callsign) from geo.audit_policy
                   where geo_status='qualifies' and policy_certified not like 'not established%' group by 1""")
    assert dict(cur.fetchall()) == {
        "needs confirmation: certification not established": "KRZZ,KSJO",
        "not applicable: nonprofit or public body": "KEXC,KEXU-LP,KGPC-LP,KLVS,KPFA,KQED-FM"}


def test_kexc_is_read_with_the_licensee_at_the_report_date(cur):
    # The 2023 row for facility 36029 describes KREV, held by a bankruptcy estate on 10/1/2023. Friends of KEXP
    # is only the December 2024 licensee added at publication. The row is "insufficient data": its zeros say nothing.
    lic, call, ev, changed = one(cur, """select licensee_in_report, callsign_in_report, evidence, licensee_changed
                                        from geo.audit_result where facility_id = 36029""")
    assert lic == "BANKRUPTCY ESTATE OF GOLDEN STATE BROADCASTING LLC" and call == "KREV"
    assert ev == 'unresolved: the FCC marks this filing "insufficient data"' and changed is True
    # it is the only station of the 40 whose 2023 and December 2024 licensees differ in the report itself
    cur.execute("""select a.callsign from geo.audit_station a join geo.station_ownership o using (facility_id)
        where a.service in ('FM','FL') and regexp_replace(upper(o.licensee_2023),'[^A-Z0-9]','','g')
                                       <> regexp_replace(upper(o.licensee_dec2024),'[^A-Z0-9]','','g')""")
    assert [r[0] for r in cur.fetchall()] == ["KEXC"]
