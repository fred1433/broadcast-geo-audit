-- Ownership evidence and export policies for the Oakland FM audit.
-- Evidence is what the FCC report says, at its date, about the licensee AT THAT DATE. It is never completed from
-- names, programming or photos.

-- Entity type facts that the FCC ownership tables do not carry, each with its public source.
drop table if exists geo.entity_evidence cascade;
create table geo.entity_evidence (facility_id int primary key, licensee text, entity_type text, source text);
insert into geo.entity_evidence values
 (36029, 'FRIENDS OF KEXP', 'nonprofit',
  'IRS exempt organization, 501(c)(3), EIN 91-2061474 (IRS data via ProPublica Nonprofit Explorer, retrieved 2026-09-27)');

drop view if exists geo.audit_policy;
drop table if exists geo.audit_result;
create table geo.audit_result as
with cls as (select distinct on (facility_id, service) facility_id, service, station_class,
                    nullif(regexp_replace(frequency, '[^0-9.]', '', 'g'), '')::numeric as mhz
             from raw.fcc_station_list where status = 'LIC' order by facility_id, service),
base as (
  select a.*, c.station_class,
         -- protected contour: 54 dBu class B, 57 dBu class B1, 60 dBu otherwise and for every reserved-band
         -- (88.1-91.9 MHz) noncommercial station (FCC, FM station classes and service contours)
         case when c.mhz < 92 then 60 when c.station_class = 'B' then 54 when c.station_class = 'B1' then 57 else 60 end as contour_dbu,
         o.report_file, o.workbook, o.row_t12, o.row_t34,
         regexp_replace(trim(o.licensee_2023), '\s+', ' ', 'g') as licensee_in_report,            -- licensee on 10/1/2023: the one the data describes
         coalesce(nullif(o.callsign_2023, ''), o.callsign_dec2024) as callsign_in_report,
         o.maj_racial_and_or_ethnic_minority as maj_minority, o.maj_female, o.maj_hispanic,
         o.maj_black_african_american as maj_black, o.maj_asian, o.maj_american_indian_alaska_native as maj_aian,
         o.maj_native_hawaiian_pacific_islander as maj_nhpi, o.maj_joint_female_male as maj_joint_fm,
         o.any_racial_and_or_ethnic_minority as any_minority, o.any_female,
         o.maj_not_filed, o.maj_insufficient_data,
         regexp_replace(upper(coalesce(o.licensee_2023,'')), '[^A-Z0-9]', '', 'g')
           <> regexp_replace(upper(a.licensee_fcc_query_2026), '[^A-Z0-9]', '', 'g') as licensee_changed,
         -- entity type: noncommercial educational (Form 323-E) and LPFM licensees must be nonprofit or public
         -- bodies (47 CFR 73.503, 73.853); other facts come from geo.entity_evidence with their source
         case when o.report_file like '%Noncommercial%' then 'nonprofit or public body (noncommercial licensee)'
              when a.service = 'FL' then 'nonprofit or public body (low power FM licensee)'
              when e.entity_type is not null then e.entity_type || ' (' || e.source || ')'
              when o.report_file like '%Commercial%' then 'commercial licensee'
         end as entity_type
  from geo.audit_station a
  left join cls c on c.facility_id = a.facility_id and c.service = a.service
  left join geo.station_ownership o on o.facility_id = a.facility_id
  left join geo.entity_evidence e on e.facility_id = a.facility_id)
select b.*,
  case when b.report_file like '%Noncommercial%' then 'noncommercial (Form 323-E): votes of the governing board, not equity'
       when b.report_file like '%Commercial%' then 'commercial (Form 323): majority of voting interests'
       else null end as interest_kind,
  concat_ws(', ',
    case when b.maj_hispanic = 1 then 'Hispanic' end, case when b.maj_black = 1 then 'Black' end,
    case when b.maj_asian = 1 then 'Asian' end, case when b.maj_aian = 1 then 'American Indian / Alaska Native' end,
    case when b.maj_nhpi = 1 then 'Native Hawaiian / Pacific Islander' end,
    case when b.maj_female = 1 then 'women' end) as majority_groups,
  case
    when b.service in ('FX','FB') then 'not assessed (rebroadcast facility)'
    when b.report_file is null and b.service = 'FL' then 'unresolved: no row in the 2023 report (LPFM is not among the services that file biennial reports)'
    when b.report_file is null then 'unresolved: no row in the 2023 report'
    when b.maj_insufficient_data = 1 then 'unresolved: the FCC marks this filing "insufficient data"'
    when b.maj_not_filed = 1 then 'unresolved: not filed'
    -- a name comparison only: a different name does not prove a change of control, and the same name does not
    -- prove unchanged ownership (a parent transaction can leave the licensee's name intact)
    when b.licensee_changed then 'unresolved: licensee name differs from the report'
    when (b.maj_minority = 1 or b.maj_female = 1) and b.report_file like '%Noncommercial%' then 'reported board majority'
    when b.maj_minority = 1 or b.maj_female = 1 then 'reported ownership majority'
    else 'no reported majority minority or women interest' end as evidence
from base b;

-- Policies. The user picks one; nothing is certified-only by default.
--   research : a reported majority is enough to shortlist, labelled "reported, not certified"; an ownership
--              majority and a nonprofit board majority are kept apart.
--   certified: an export that needs an ownership-based certification (NMSDC, WBENC or similar). Those
--              certify for-profit businesses at least 51% owned and controlled by the group, so nonprofits and
--              public bodies are out of scope, not "unconfirmed". No certification is established from FCC data.
create or replace view geo.audit_policy as
select r.*,
  case when r.geo_status <> 'qualifies' then 'out: geographic rule'
       when r.evidence = 'reported ownership majority' then 'in: reported ownership, not certified'
       when r.evidence = 'reported board majority' then 'in: reported board majority, nonprofit'
       when r.evidence like 'unresolved%' then 'needs confirmation'
       else 'not established from these sources' end as policy_research,
  case when r.geo_status <> 'qualifies' then 'out: geographic rule'
       when r.entity_type like 'nonprofit%' then 'not applicable: nonprofit or public body'   -- scope first
       when r.evidence like 'no reported majority%' then 'not established from these sources'
       else 'needs confirmation: certification not established' end as policy_certified
from geo.audit_result r;
