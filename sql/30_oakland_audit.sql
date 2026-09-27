-- Oakland FM audit. Rule frozen BEFORE looking at results (27/09/2026):
--   target area   : Census place 0653000 "Oakland city", TIGER/Line 2025 boundary (legal boundaries as of 2025-01-01)
--   residents     : 2020 Census block counts (P.L. 94-171, via TIGER tabblock20), allocated to the target area
--                   by the share of each block's land+water area inside it; bounds = fully-contained blocks only
--                   (low) and every intersecting block in full (high). Not an audience; not 2026 residents.
--   universe      : FM facilities with a LICENSED service contour intersecting the target area:
--                   full-power FM (service FM) and low-power FM (FL). Translators (FX) and boosters (FB) rebroadcast
--                   another station: listed, not qualified. Auxiliary transmitters (FS) are backups: ignored.
--                   AM is out of scope: the FCC publishes no AM contour file of the same kind.
--   contour       : the FCC's predicted F(50,50) service contour for the LICENSED main facility (matched by
--                   LMS application id to the FM Query record with status LIC), not the largest contour on file.
--   qualifies     : contour holds >= 50% of the target area's residents (allocation estimate).
--   ownership     : FCC Form 323 (commercial) / 323-E (noncommercial), Report on Ownership of Broadcast
--                   Stations, data as of 2023-10-01; Tables 3-4 = MAJORITY of voting interests.
drop table if exists geo.audit_zone;
create table geo.audit_zone as
select 'oakland' as id, 'Oakland city (Census place 0653000)' as label, geom, geom_aea from geo.place where geoid = '0653000';

drop table if exists geo.audit_block;
create table geo.audit_block as   -- blocks of the zone with allocation weight
select b.geoid, b.pop, b.pt_aea, b.geom_aea,
       case when ST_Within(b.geom_aea, z.geom_aea) then 1.0
            else ST_Area(ST_Intersection(b.geom_aea, z.geom_aea)) / nullif(ST_Area(b.geom_aea), 0) end as w,
       ST_Within(b.geom_aea, z.geom_aea) as inside
from geo.block b, geo.audit_zone z where ST_Intersects(b.geom_aea, z.geom_aea);

-- every FM contour record of facilities touching the zone (licensed or not), to test contour selection
drop table if exists geo.audit_contour;
create table geo.audit_contour as
select c.application_id, c.lms_application_id, s.facility_id, s.callsign, s.service, s.status, s.licensee,
       s.city as community_of_license, c.geom, ST_Transform(c.geom, 5070) as geom_aea,
       ST_Area(ST_Transform(c.geom, 5070)) / 1e6 as km2
from raw.fcc_contour c join raw.fcc_station_list s on s.lms_hash_a = c.lms_application_id
where c.band = 'FM' and s.facility_id in (
  select s2.facility_id from raw.fcc_contour c2 join raw.fcc_station_list s2 on s2.lms_hash_a = c2.lms_application_id,
         geo.audit_zone z
  where c2.band = 'FM' and s2.status = 'LIC' and s2.service in ('FM','FL','FX','FB')
    and ST_Intersects(ST_Transform(c2.geom, 5070), z.geom_aea));

-- residents of the zone inside one contour: estimate, low, high
create or replace function geo.zone_pop_in(g geometry)
returns table (est numeric, low numeric, high numeric) language sql stable as $$
  select round(sum(b.pop * b.w * f.frac)::numeric),
         sum(b.pop) filter (where b.inside and f.frac = 1),
         sum(b.pop) filter (where f.frac > 0 and b.w > 0)  -- a block that only shares an edge is not "in"
  from geo.audit_block b
  cross join lateral (select case when ST_Within(b.geom_aea, g) then 1.0
                                  when ST_Intersects(b.geom_aea, g) then ST_Area(ST_Intersection(b.geom_aea, g)) / nullif(ST_Area(b.geom_aea),0)
                                  else 0 end as frac) f
  where ST_Intersects(b.geom_aea, g)
$$;

drop table if exists geo.audit_station;
create table geo.audit_station as
with zone_total as (select sum(pop * w) as p, sum(pop) filter (where inside) as low, sum(pop) as high from geo.audit_block),
lic as (   -- the licensed main contour (one per facility; DTS/multi-record would be unioned)
  select facility_id, min(callsign) callsign, min(service) service, min(licensee) licensee,
         min(community_of_license) col, ST_Union(geom_aea) g, max(km2) km2, string_agg(application_id, ',') app_ids
  from geo.audit_contour where status = 'LIC' and service in ('FM','FL','FX','FB') group by facility_id),
largest as (
  select distinct on (facility_id) facility_id, geom_aea g, service lg_service, status lg_status, km2 lg_km2, application_id lg_app
  from geo.audit_contour order by facility_id, km2 desc)
select l.facility_id, l.callsign, l.service, l.licensee as licensee_fcc_query_2026, l.col as community_of_license,
       l.app_ids as licensed_application_ids, round(l.km2::numeric) as contour_km2,
       p.est as residents_est, p.low as residents_low, p.high as residents_high,
       round((p.est / zt.p)::numeric, 3) as share_est,
       round((p.low / zt.p)::numeric, 3) as share_low, round((p.high / zt.p)::numeric, 3) as share_high,
       lg.lg_service || '/' || lg.lg_status as largest_record, round(lg.lg_km2::numeric) as largest_km2, lg.lg_app,
       round((pl.est / zt.p)::numeric, 3) as share_if_largest,
       case when l.service in ('FX','FB') then 'rebroadcast, not qualified'
            when p.est / zt.p >= 0.5 then 'qualifies' else 'touches, below 50%' end as geo_status
from lic l cross join zone_total zt
join largest lg using (facility_id)
cross join lateral geo.zone_pop_in(l.g) p
cross join lateral geo.zone_pop_in(lg.g) pl;
