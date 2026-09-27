-- Query layer: every answer on the page comes out of these functions.
-- Input geometries are EPSG:4326/4269 GeoJSON-style polygons (what MapLibre draw returns); work happens in 5070.

-- 1. Population / households of ANY polygon, apportioned from 2020 blocks (pop, housing units) and
--    ACS 2020-2024 block groups (households, demographics) weighted by the block population inside.
create or replace function geo.apportion(zone geometry)
returns table (pop numeric, housing_units numeric, households numeric, hispanic numeric, nh_black numeric,
               nh_asian numeric, nh_white numeric, hh_100k_plus numeric, blocks_touched int, block_groups_touched int)
language sql stable as $$
  with z as (select ST_Transform(ST_SetSRID(zone, 4269), 5070) as g),
  b as (
    select bl.geoid, bl.bg_geoid, bl.pop, bl.housing_units,
           case when ST_Within(bl.geom_aea, z.g) then 1.0
                else ST_Area(ST_Intersection(bl.geom_aea, z.g)) / nullif(ST_Area(bl.geom_aea), 0) end as share
    from geo.block bl, z where ST_Intersects(bl.geom_aea, z.g)),
  bgw as (   -- share of each block group's 2020 population that falls inside the zone
    select b.bg_geoid, sum(b.pop * b.share) / nullif((select sum(pop) from geo.block x where x.bg_geoid = b.bg_geoid), 0) as w
    from b group by b.bg_geoid)
  select round(sum(b.pop * b.share)), round(sum(b.housing_units * b.share)),
         (select round(sum(a.households * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (select round(sum(a.hispanic * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (select round(sum(a.nh_black * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (select round(sum(a.nh_asian * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (select round(sum(a.nh_white * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (select round(sum(a.hh_100k_plus * w)) from bgw join geo.acs_bg a using (bg_geoid)),
         (count(*) filter (where b.share > 0))::int, (select count(*)::int from bgw where w > 0)
  from b;
$$;

-- 2. The naive answers people actually ship, for comparison.
create or replace function geo.naive_zcta(zone geometry)
returns table (zctas_touched int, pop_sum_of_touched_zctas numeric, pop_area_weighted_zctas numeric)
language sql stable as $$
  with z as (select ST_Transform(ST_SetSRID(zone, 4269), 5070) as g),
  zp as (select zcta, sum(pop) as pop from geo.block_xwalk group by zcta),
  t as (select zc.zcta, zp.pop, ST_Area(ST_Intersection(zc.geom_aea, z.g)) / ST_Area(zc.geom_aea) as ashare
        from geo.zcta zc join zp using (zcta), z where ST_Intersects(zc.geom_aea, z.g))
  select count(*)::int, sum(pop), round(sum(pop * ashare)) from t;
$$;

-- 3. Urban / suburban / exurban / rural mix of a zone (house rule in geo.class_rule), by population.
create or replace function geo.class_mix(zone geometry)
returns table (klass text, pop numeric)
language sql stable as $$
  with z as (select ST_Transform(ST_SetSRID(zone, 4269), 5070) as g)
  select coalesce(tc.klass, 'unclassified'), round(sum(bl.pop *
         case when ST_Within(bl.geom_aea, z.g) then 1.0
              else ST_Area(ST_Intersection(bl.geom_aea, z.g)) / nullif(ST_Area(bl.geom_aea), 0) end))
  from geo.block bl join geo.tract_class tc on tc.tract_geoid = bl.tract_geoid, z
  where ST_Intersects(bl.geom_aea, z.g)
  group by 1 order by 2 desc;
$$;

-- 4. Which broadcast stations reach a zone, and what share of its PEOPLE sits inside their service contour.
--    Coverage is population-weighted (blocks), not area-weighted. Rebroadcast facilities (translators,
--    boosters) are returned but flagged: they repeat another station's programming.
create or replace function geo.stations_reaching(zone geometry, min_pop_share numeric default 0.5)
returns table (facility_id int, callsign text, service text, tier text, community_of_license text, licensee text,
               pop_covered numeric, pop_share numeric,
               maj_minority int, maj_female int, maj_hispanic int, maj_black int, maj_asian int,
               any_minority int, any_female int, filed_323 text)
language sql stable as $$
  with z as (select ST_Transform(ST_SetSRID(zone, 4269), 5070) as g),
  zb as (   -- blocks of the zone with their in-zone population, computed once
    select bl.pt_aea, bl.pop * case when ST_Within(bl.geom_aea, z.g) then 1.0
             else ST_Area(ST_Intersection(bl.geom_aea, z.g)) / nullif(ST_Area(bl.geom_aea), 0) end as p
    from geo.block bl, z where ST_Intersects(bl.geom_aea, z.g) and bl.pop > 0),
  tot as (select sum(p) as p from zb),
  cov as (   -- union of all contours of a facility (DTS sites, several applications)
    select s.facility_id, ST_Union(s.contour_aea) as g from geo.station s, z
    where ST_Intersects(s.contour_aea, z.g) group by s.facility_id),
  reach as (
    select c.facility_id, sum(zb.p) as p from cov c join zb on ST_Intersects(c.g, zb.pt_aea) group by c.facility_id)
  select r.facility_id, s.callsign, s.service, s.tier, s.community_of_license, s.licensee,
         round(r.p::numeric), round((r.p / tot.p)::numeric, 3),
         o.maj_racial_and_or_ethnic_minority, o.maj_female, o.maj_hispanic, o.maj_black_african_american, o.maj_asian,
         o.any_racial_and_or_ethnic_minority, o.any_female,
         case when o.facility_id is null then 'no 2023 filing matched' when o.maj_not_filed = 1 then 'not filed'
              when o.maj_insufficient_data = 1 then 'insufficient data' else o.report_file end
  from reach r, tot,
       lateral (select * from geo.station s where s.facility_id = r.facility_id order by s.application_id limit 1) s
       left join lateral (select * from geo.station_ownership o where o.facility_id = r.facility_id limit 1) o on true
  where r.p / tot.p >= min_pop_share
  order by r.p desc;
$$;
