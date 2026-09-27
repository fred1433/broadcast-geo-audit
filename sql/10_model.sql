-- Geographic foundation, Bay Area slice. Same model scales to the nation: nothing here is Bay-specific
-- except the rows loaded.
--
-- Conventions
--   * geom       : geometry as published (TIGER/Line = NAD83, EPSG:4269), never edited. Source of truth.
--   * geom_aea   : generated copy in EPSG:5070 (CONUS Albers equal-area, metres). Every area, overlap share
--                  and buffer is computed here, never in degrees. (Alaska 3338 / Hawaii 102007 when those
--                  states are loaded; one column per row is enough, keyed on the state.)
--   * Simplified geometries are NOT stored here: they live in the vector tiles only (display), so a
--     simplification never leaks into a population answer.
--   * Every table carries vintage + source so an answer can be cited ("TIGER 2025, blocks 2020").
--   * GiST index on geom_aea for analysis, on geom for tile generation.

drop schema if exists geo cascade;
create schema geo;

-- ---------- Census hierarchy ----------------------------------------------------------------------
create table geo.county as
select geoid, namelsad as name, statefp, aland, awater, geom,
       ST_Transform(geom, 5070) as geom_aea, 'TIGER/Line 2025'::text as source
from raw.county where countyfp in ('001','013','041','055','075','081','085','095','097');

create table geo.tract as
select t.geoid, t.namelsad as name, t.statefp || t.countyfp as county_geoid, t.aland, t.geom,
       ST_Transform(t.geom, 5070) as geom_aea, 'TIGER/Line 2025'::text as source
from raw.tract t;

create table geo.block_group as
select b.geoid, b.statefp || b.countyfp || b.tractce as tract_geoid, b.statefp || b.countyfp as county_geoid,
       b.aland, b.geom, ST_Transform(b.geom, 5070) as geom_aea, 'TIGER/Line 2025'::text as source
from raw.bg b;

-- 2020 tabulation blocks: the atom. POP20 / HOUSING20 are the P.L. 94-171 counts carried by TIGER.
-- Every other unit (ZCTA, place, urban area, drawn polygon) is apportioned from here.
create table geo.block as
select geoid20 as geoid, statefp20 || countyfp20 as county_geoid,
       statefp20 || countyfp20 || tractce20 as tract_geoid,
       statefp20 || countyfp20 || tractce20 || left(blockce20, 1) as bg_geoid,
       ur20 as urban_rural, nullif(uace20, '') as uace20, aland20 as aland, pop20 as pop, housing20 as housing_units,
       ST_SetSRID(ST_MakePoint(intptlon20::float8, intptlat20::float8), 4269) as pt,
       ST_Transform(ST_SetSRID(ST_MakePoint(intptlon20::float8, intptlat20::float8), 4269), 5070) as pt_aea,
       statefp20 || countyfp20 in ('06001','06013','06041','06055','06075','06081','06085','06095','06097') as in_area,
       geom, ST_Transform(geom, 5070) as geom_aea, 'TIGER/Line 2025 tabblock20 (2020 counts)'::text as source
from raw.block20;

create table geo.place as
select p.geoid, p.namelsad as name, p.lsad, p.classfp, p.geom, ST_Transform(p.geom, 5070) as geom_aea,
       'TIGER/Line 2025'::text as source
from raw.place p where exists (select 1 from geo.county c where ST_Intersects(c.geom, p.geom)
                               and ST_Area(ST_Intersection(c.geom_aea, ST_Transform(p.geom,5070))) > 0.5*ST_Area(ST_Transform(p.geom,5070)));

create table geo.cbsa as
select geoid, namelsad as name, lsad, geom, ST_Transform(geom, 5070) as geom_aea, 'TIGER/Line 2025 (OMB 2023)'::text as source
from raw.cbsa;
create table geo.csa as
select geoid, namelsad as name, geom, ST_Transform(geom, 5070) as geom_aea, 'TIGER/Line 2025 (OMB 2023)'::text as source
from raw.csa;
create table geo.urban_area as
select uace20, namelsad20 as name, geom, ST_Transform(geom, 5070) as geom_aea, 'TIGER/Line 2025 UAC20'::text as source
from raw.uac20;

-- ZCTA polygons (census approximations of ZIP delivery areas, built from 2020 blocks; TIGER 2025 still ships
-- the 2020 ZCTAs). Kept only if they touch the nine counties per the OFFICIAL relationship file.
create table geo.zcta as
select z.zcta5ce20 as zcta, z.aland20 as aland, z.geom, ST_Transform(z.geom, 5070) as geom_aea,
       'TIGER/Line 2025 ZCTA520 (2020 vintage)'::text as source
from raw.zcta z
where z.zcta5ce20 in (select zcta from raw.rel_zcta_county
                      where county in (select geoid from geo.county) and zcta <> '');

-- indexes first: the crosswalks below are spatial joins
do $$ declare t text; begin
  foreach t in array array['county','tract','block_group','block','place','cbsa','csa','urban_area','zcta'] loop
    execute format('create index on geo.%I using gist (geom_aea)', t);
    execute format('create index on geo.%I using gist (geom)', t);
  end loop; end $$;
create index on geo.block using gist (pt_aea);
create index on geo.block (bg_geoid);
create index on geo.block (tract_geoid);
analyze;

-- ---------- Crosswalks (bridge tables, the heart of the model) -------------------------------------
-- Block -> every unit it nests in or is assigned to. Blocks nest exactly in tract/BG/county; ZCTA, place
-- and urban area are assigned by the block's internal point (Census builds ZCTAs from whole blocks,
-- so this reproduces them; places and UAs are also block-based in 2020).
create table geo.block_xwalk as
select b.geoid as block_geoid, b.in_area, b.county_geoid, b.tract_geoid, b.bg_geoid, b.pop, b.housing_units,
       (select z.zcta from geo.zcta z where ST_Intersects(z.geom_aea, b.pt_aea) limit 1) as zcta,
       (select p.geoid from geo.place p where ST_Intersects(p.geom_aea, b.pt_aea) limit 1) as place_geoid,
       b.uace20
from geo.block b;

-- ZCTA <-> county, from the Census relationship file (land-area parts) PLUS population parts from blocks.
create table geo.zcta_county as
with pop as (
  select zcta, county_geoid, sum(pop) as pop, sum(housing_units) as housing_units
  from geo.block_xwalk where zcta is not null group by 1, 2)
select r.zcta, r.county as county_geoid, r.aland_part, r.aland_zcta,
       coalesce(p.pop, 0) as pop_part, coalesce(p.housing_units, 0) as hu_part,
       'Census 2020 ZCTA-county relationship file + 2020 blocks'::text as source
from raw.rel_zcta_county r
left join pop p on p.zcta = r.zcta and p.county_geoid = r.county
where r.zcta in (select zcta from geo.zcta) and r.county <> '';

-- USPS ZIP codes, described only. A ZIP is a delivery route, a ZCTA a Census area built from blocks; same code
-- does not mean same area, and PO-box ZIPs usually have no ZCTA. There is no official ZIP to ZCTA population
-- crosswalk: HUD-USPS relates ZIPs to tracts, counties and CBSAs with address-based ratios, which is a different
-- relationship. This table lists every California ZIP with its type (USDA RUCA 2020 ZIP file) and whether a ZCTA
-- with the same code exists; it is descriptive, not a crosswalk.
create table geo.zip as
select zip, state, zip_type, po_name, primaryruca as ruca_zip,
       (select zcta from geo.zcta z where z.zcta = r.zip) as same_code_zcta,
       'USDA ERS RUCA 2020 ZIP file (June 2024)'::text as source
from raw.ruca_zip r where state = 'CA';

-- ---------- Attributes -----------------------------------------------------------------------------
create table geo.ruca_tract as
select tractfips20 as tract_geoid, primaryruca as ruca, primaryrucadescription as ruca_desc,
       secondaryruca, population as ruca_pop, landarea as ruca_land_sqmi, popdensity as ruca_density,
       'USDA ERS RUCA 2020, tract'::text as source
from raw.ruca_tract where tractfips20 like '06%';

create table geo.acs_bg as
select substr(geo_id, 10) as bg_geoid, pop, households, nh_white, nh_black, nh_asian, hispanic,
       hh_income_universe, hh_100_125k + hh_125_150k + hh_150_200k + hh_200k_plus as hh_100k_plus,
       'ACS 2020-2024 5-year (B01003, B11001, B03002, B19001)'::text as source
from raw.acs5_2024 where geo_id like '1500000US06%';

create table geo.acs_summary as
select geo_id, pop, households from raw.acs5_2024 where geo_id not like '1500000US%';

-- Classification (a HOUSE RULE, not an official one: no federal source defines "suburban" or "exurban").
-- Tract level, from USDA RUCA 2020 primary code + 2020 population density. Thresholds are ours, stored as data.
create table geo.class_rule (klass text primary key, rank int, rule text, ruca_codes int[], min_density numeric, max_density numeric);
insert into geo.class_rule values
 ('urban core', 1, 'RUCA 1 and >= 7,500 people per sq mi of land', '{1}', 7500, null),
 ('suburban',   2, 'RUCA 1 and under 7,500 people per sq mi',      '{1}', null, 7500),
 ('exurban',    3, 'RUCA 2 or 3 (metro commuting areas outside the urban core)', '{2,3}', null, null),
 ('rural',      4, 'RUCA 4 to 10 (micropolitan, small town, rural)', '{4,5,6,7,8,9,10}', null, null);

create table geo.tract_class as
select t.geoid as tract_geoid, r.ruca,
       (select sum(pop) from geo.block b where b.tract_geoid = t.geoid) as pop20,
       t.aland / 2589988.11 as land_sqmi,
       case when t.aland > 0 then (select sum(pop) from geo.block b where b.tract_geoid = t.geoid) / (t.aland / 2589988.11) end as density,
       null::text as klass
from geo.tract t left join geo.ruca_tract r on r.tract_geoid = t.geoid;
update geo.tract_class tc set klass = cr.klass
from geo.class_rule cr
where tc.ruca = any (cr.ruca_codes)
  and (cr.min_density is null or tc.density >= cr.min_density)
  and (cr.max_density is null or tc.density < cr.max_density);

-- ---------- Media ----------------------------------------------------------------------------------
-- Broadcast facilities (FCC). One row per licensed facility; contours kept per application.
create table geo.station as
select distinct on (s.facility_id, c.application_id)
       s.facility_id, s.callsign, s.service, s.band, s.city as community_of_license, s.licensee, s.status,
       c.application_id, c.site as dts_site, c.geom as contour, ST_Transform(c.geom, 5070) as contour_aea,
       ST_SetSRID(ST_MakePoint(c.tx_lon, c.tx_lat), 4269) as tx_point,
       case when s.service in ('FX','FB') then 'rebroadcast'
            when s.service in ('FL') then 'low power FM'
            when s.service in ('LPD','DCA','LPT') then 'low power / class A TV'
            else 'full power' end as tier,
       'FCC service contours (daily file of 2026-09-26) + FM/TV Query'::text as source
from raw.fcc_contour c join raw.fcc_station_list s on s.lms_hash_a = c.lms_application_id
where s.status = 'LIC'
  and s.service not in ('FS','FA');  -- auxiliary (backup) transmitters: licensed, but not the station's service area

-- FCC Forms 323 / 323-E, data as of Oct 1 2023 (report released Jan 2025). SELF-REPORTED by licensees.
-- any_* = at least one attributable interest holder in the group (Tables 1-2)
-- maj_* = the group holds a MAJORITY of voting interests (Tables 3-4)
create table geo.station_ownership as
select * , 'FCC Report on Ownership of Broadcast Stations, data as of 2023-10-01'::text as source
from raw.fcc_323_2023;

-- Slots for licensed / proprietary data the client already owns. Empty on purpose.
-- Deliberately partial, county-level placeholder. Nielsen defines DMAs from counties and ZIP codes and licenses
-- ZIP-level assignments and shapefiles; a licensed load would add the ZIP grain and the vintage.
create table geo.dma_county (county_geoid text primary key, dma_code text, dma_name text, vintage text,
  note text default 'Partial county-level placeholder for licensed Nielsen DMA data');
create table geo.certification (subject_uid text, scheme text check (scheme in ('NMSDC','WBENC','NGLCC','Disability:IN','NaVOBA','other')),
  certificate_id text, certified_entity text, valid_from date, valid_to date, verified_on date, verification_source text,
  note text default 'Certification is evidence of its own kind: scheme, certificate, validity. Never derived from FCC filings.');
create table geo.outlet_coverage (outlet_uid text, outlet_name text, media_type text,
  coverage_kind text check (coverage_kind in ('contour','county_list','zcta_list','dma','declared_polygon')),
  county_geoid text, zcta text, geom geometry(MultiPolygon, 4269),
  note text default 'Your outlet ids join here; newspapers are declared areas (counties/ZIPs), not contours');

-- ---------- Indexes --------------------------------------------------------------------------------
create index on geo.block_xwalk (zcta);
create index on geo.station using gist (contour_aea);
create index on geo.station (facility_id);
create index on geo.station_ownership (facility_id);
analyze;
