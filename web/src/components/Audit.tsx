"use client";

import { useMemo, useState } from "react";
import audit from "@/data/audit.json";
import type { MapData } from "@/lib/map";
import { CITY, REGION } from "@/lib/map";

type Station = (typeof audit.stations)[number];
type Policy = "research" | "certified";
type Bucket = "own" | "board" | "confirm" | "na" | "none" | "out";

const REPO = "https://github.com/fred1433/broadcast-geo-audit";
const FCC_323_PAGE = "https://www.fcc.gov/biennial-forms-323-and-323-e-broadcast-ownership-data-and-reports";
const IRS_KEXP = "https://projects.propublica.org/nonprofits/organizations/912061474";
const FCC_CONTOURS_PAGE = "https://www.fcc.gov/media/radio/fm-service-contour-data-points";

const fmt = (n: number) => n.toLocaleString("en-US");
const pctW = (x: number) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;
const pct = (x: number) => {
  const v = x * 100;
  if (v === 0) return "0%";
  if (v < 1) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
};
const title = (t: string) =>
  t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/, Etc\.$/, ", etc.").replace(/\bLlc\b/g, "LLC");
const REPORT_DATE = "Oct 1, 2023";

function bucket(s: Station, policy: Policy): Bucket {
  const v = policy === "research" ? s.policy_research : s.policy_certified;
  if (v === "in: reported ownership, not certified") return "own";
  if (v === "in: reported board majority, nonprofit") return "board";
  if (v.startsWith("needs")) return "confirm";
  if (v.startsWith("not applicable")) return "na";
  if (v.startsWith("not established")) return "none";
  return "out";
}

function evidenceLine(s: Station, policy: Policy): string {
  const e = s.evidence;
  const who = s.majority_groups;
  if (e === "reported ownership majority") {
    const base = `Reports a majority-${who === "Asian" || who === "Hispanic" ? who : who.toLowerCase()} share of voting interests, as of ${REPORT_DATE}.`;
    return policy === "certified" ? `${base} A for-profit licensee: a credential could exist; none was supplied or verified here.` : base;
  }
  if (e === "reported board majority") {
    return policy === "certified"
      ? "Nonprofit licensee with no equity owners: outside ownership-based certification."
      : `Nonprofit. Reports a female majority of governing voting interests, as of ${REPORT_DATE}. Governance, not equity ownership.`;
  }
  if (policy === "certified" && s.policy_certified.startsWith("not applicable")) {
    if (s.callsign === "KEXC") return "Now held by Friends of KEXP, a 501(c)(3) nonprofit: outside ownership-based certification.";
    if (s.service === "FL") return "Low power FM licensees are nonprofits or public bodies: outside ownership-based certification.";
    return "Noncommercial licensee, a nonprofit or public body: outside ownership-based certification.";
  }
  if (s.callsign === "KLVS")
    return `The licensee name differs from the report: ${title(s.licensee_in_report ?? "")} then, K-LOVE, Inc. now. Continuity of control not independently established.`;
  if (e.includes("insufficient data"))
    return `The ${REPORT_DATE} row describes a different licensee (${title(s.licensee_in_report ?? "")}, then ${s.callsign_in_report}) and the FCC marks it insufficient data. Nothing is established about the current licensee.`;
  if (e.startsWith("unresolved: licensee name differs"))
    return `The licensee name differs from the report (${title(s.licensee_in_report ?? "")} then, ${title(s.licensee_fcc_query_2026)} now). Confirm with a current filing.`;
  if (e.includes("LPFM")) return "No row in the FCC's 2023 ownership report. Low power FM is not among the services that file biennial reports.";
  if (e.startsWith("no reported majority")) return "No majority of minority or women voting interests reported.";
  return e;
}

function Bar({ s }: { s: Station }) {
  const range = s.share_high - s.share_low > 0.004;
  return (
    <span className="barcell">
      <span className="bar" aria-hidden>
        <i style={{ width: pctW(s.share_est) }} />
        {range && <span className="rng" style={{ left: pctW(s.share_low), width: pctW(Math.min(1, s.share_high) - s.share_low) }} />}
        <span className="half" />
      </span>
      <span className="barlabel num">
        {pct(s.share_est)} of Oakland residents{range ? `, bounds ${pct(s.share_low)} to ${pct(Math.min(1, s.share_high))}` : ""}
      </span>
    </span>
  );
}

function Detail({ s }: { s: Station }) {
  const nce = s.report_file?.includes("Noncommercial");
  const rebroadcast = s.service === "FX" || s.service === "FB";
  const kind = s.service === "FL" ? "low power FM" : s.service === "FX" ? "FM translator" : s.service === "FB" ? "FM booster" : "FM";
  const wb = s.workbook ? s.workbook.split("/").pop() : null;
  return (
    <div className="detail">
      <div>
        <h4>Contour used</h4>
        <dl>
          <dt>Record</dt><dd>FCC {kind} license, application {s.licensed_application_ids}</dd>
          {!rebroadcast && <><dt>Model</dt><dd>{s.contour_dbu} dBu protected contour, F(50,50) prediction</dd></>}
          <dt>Station</dt><dd>{s.station_class ? `Class ${s.station_class}, ` : ""}{s.frequency} MHz, licensed to {title(s.community_of_license)}</dd>
          <dt>Area</dt><dd className="num">{fmt(s.contour_km2)} km²</dd>
          <dt>Source</dt><dd><a href={FCC_CONTOURS_PAGE}>FCC FM service contour file</a>, daily file of Sept 26, 2026</dd>
          {!rebroadcast && !s.largest_record.startsWith(`${s.service}/LIC`) && (
            <><dt>Note</dt><dd>The largest contour on file for this facility is a {s.largest_record === "FS/LIC" ? "licensed auxiliary (backup) transmitter" : "pending application"}, not this license. The audit uses the license.</dd></>
          )}
        </dl>
      </div>
      <div>
        <h4>Oakland residents inside it</h4>
        <dl>
          <dt>Estimate</dt><dd className="num">{fmt(s.residents_est)} of {fmt(audit.summary.zone.residents_2020)}</dd>
          <dt>Allocation bounds</dt><dd className="num">{fmt(s.residents_low)} to {fmt(s.residents_high)}</dd>
          <dt>Basis</dt><dd>2020 Census blocks. Bounds run from blocks wholly inside to every block the contour cuts; they bound the allocation of published counts, not a confidence interval. Not listeners, not 2026 residents.</dd>
        </dl>
      </div>
      <div>
        <h4>Ownership evidence</h4>
        {rebroadcast ? (
          <dl>
            <dt>Licensee</dt><dd>{s.licensee_fcc_query_2026} (FCC FM Query)</dd>
            <dt>Status</dt><dd>Not assessed. Rebroadcast facilities are left for a separate rule.</dd>
          </dl>
        ) : (
          <dl>
            <dt>FCC facility</dt><dd className="num">{s.facility_id}</dd>
            {s.report_file ? (
              <>
                <dt>Source</dt>
                <dd>
                  <a href={FCC_323_PAGE}>FCC Report on Ownership of Broadcast Stations</a>, processed Form {nce ? "323-E" : "323"} table,
                  data as of {REPORT_DATE}. Workbook {wb}, sheet &quot;Tables 3 and 4&quot; row {s.row_t34}, &quot;Tables 1 and 2&quot; row {s.row_t12}.
                  {" "}<a href={`${REPO}/tree/main/evidence`}>Retained copy</a>.
                </dd>
                <dt>Measure</dt><dd>{nce ? "Governing voting interests. A nonprofit has no equity owners." : "Majority of voting interests."}</dd>
                <dt>Licensee then</dt><dd>{s.licensee_in_report}{s.callsign_in_report && s.callsign_in_report !== s.callsign ? ` (${s.callsign_in_report})` : ""}, as of {REPORT_DATE}</dd>
              </>
            ) : (
              <><dt>Source</dt><dd>None: no row in the 2023 report.</dd></>
            )}
            <dt>Licensee now</dt><dd>{s.licensee_fcc_query_2026} (FCC FM Query, Sept 27, 2026). A name match is not a check of current ownership.</dd>
            {s.callsign === "KEXC" ? (
              <><dt>Entity</dt><dd>Nonprofit, 501(c)(3), <a href={IRS_KEXP}>IRS record EIN 91-2061474</a></dd></>
            ) : s.entity_type ? (
              <><dt>Entity</dt><dd>{s.entity_type}</dd></>
            ) : null}
            {s.report_file && !s.maj_insufficient_data && (
              <><dt>Any interest</dt><dd>{s.any_minority ? "At least one minority interest holder" : "No minority interest holder"}{s.any_female ? ", at least one woman" : ""}. A presence, not control.</dd></>
            )}
            {s.maj_insufficient_data === 1 && <><dt>Interests</dt><dd>Not established: the FCC could not process the reported interests.</dd></>}
            <dt>Certification</dt><dd>{s.policy_certified.startsWith("not applicable") ? "Not applicable: nonprofit or public body." : "None supplied or verified in this demonstration."}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

type Label = { id: number; x: number; y: number; text: string; kind: string };
type Box = { x: number; y: number; w: number; h: number };

function placeLabels(cands: { id: number; text: string; kind: string; pts: [number, number][] }[], blockers: Box[],
  charW: number, h: number, maxX: number) {
  const boxes = [...blockers];
  const out: Label[] = [];
  const hit = (b: Box) => boxes.some((o) => Math.abs(o.x - b.x) * 2 < o.w + b.w + 6 && Math.abs(o.y - b.y) * 2 < o.h + b.h + 4);
  for (const c of cands) {
    const w = c.text.length * charW;
    for (const p of c.pts) {
      const x = Math.min(maxX - w / 2 - 4, Math.max(w / 2 + 4, p[0]));
      const b = { x, y: p[1], w, h };
      if (!hit(b)) { boxes.push(b); out.push({ id: c.id, x, y: p[1], text: c.text, kind: c.kind }); break; }
    }
  }
  return out;
}

export default function Audit({ map }: { map: MapData }) {
  const [policy, setPolicy] = useState<Policy>("research");
  const [sel, setSel] = useState<number | null>(null);
  const S = audit.summary;

  const fm = useMemo(() => audit.stations.filter((s) => s.service === "FM" || s.service === "FL"), []);
  const translators = useMemo(() => audit.stations.filter((s) => s.service === "FX"), []);
  const boosters = useMemo(() => audit.stations.filter((s) => s.service === "FB"), []);
  const groups = useMemo(() => {
    const g: Record<Bucket, Station[]> = { own: [], board: [], confirm: [], na: [], none: [], out: [] };
    for (const s of fm) g[bucket(s, policy)].push(s);
    return g;
  }, [fm, policy]);
  const selected = sel === null ? null : audit.stations.find((s) => s.facility_id === sel) ?? null;

  // what each view draws
  const kindOf = (s: Station) => (s.geo_status !== "qualifies" ? "below" : bucket(s, policy) === "none" ? "muted" : bucket(s, policy));
  const cityStations = useMemo(() => fm.filter((s) => s.share_est > 0.002).map((s) => ({ ...s, kind: kindOf(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fm, policy]);
  const regionStations = useMemo(() => [...groups.own, ...groups.board, ...groups.confirm, ...(policy === "certified" ? groups.na : [])], [groups, policy]);

  const cityLabels = useMemo(() => {
    const merged = new Map<string, { id: number; text: string; kind: string; pts: [number, number][] }>();
    const order = [...cityStations].filter((s) => s.kind !== "muted" || sel === s.facility_id)
      .sort((a, b) => ["own", "board", "confirm", "na", "below", "muted"].indexOf(a.kind) - ["own", "board", "confirm", "na", "below", "muted"].indexOf(b.kind));
    for (const s of order) {
      const key = map.city.contours[s.facility_id];
      const prev = merged.get(key);
      if (prev) prev.text = `${prev.text} / ${s.callsign}`;
      else merged.set(key, { id: s.facility_id, text: s.callsign, kind: s.kind, pts: map.city.anchors[s.facility_id] ?? [] });
    }
    const blockers: Box[] = [
      { x: CITY.w - REGION.w / 2 - 12, y: REGION.h / 2 + 12, w: REGION.w + 30, h: REGION.h + 30 }, // region inset (desktop)
      { x: 110, y: CITY.h - 26, w: 220, h: 40 }, // scale bar
    ];
    return placeLabels([...merged.values()], blockers, 17, 34, CITY.w);
  }, [cityStations, map, sel]);

  const row = (s: Station) => {
    const b = bucket(s, policy);
    return (
      <div key={s.facility_id} className={`row b-${b}${sel === s.facility_id ? " sel" : ""}`}>
        <button aria-expanded={sel === s.facility_id} onClick={() => setSel(sel === s.facility_id ? null : s.facility_id)}>
          <span className="call">{s.callsign}<small className="num">{s.frequency} FM{s.service === "FL" ? ", low power" : ""}</small></span>
          <span className="lic">{s.licensee_fcc_query_2026}<br />licensed to {title(s.community_of_license)}</span>
          <Bar s={s} />
          <span className="ev">{evidenceLine(s, policy)}</span>
          <span className="chev" aria-hidden>›</span>
        </button>
        {sel === s.facility_id && <Detail s={s} />}
      </div>
    );
  };

  const chips = (list: Station[]) => (
    <>
      <ul className="compact">
        {list.map((s) => (
          <li key={s.facility_id}>
            <button aria-pressed={sel === s.facility_id} onClick={() => setSel(sel === s.facility_id ? null : s.facility_id)}>
              {s.callsign}<span className="share num">{pct(s.share_est)}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && list.includes(selected) && <div className="row sel chipdetail"><Detail s={selected} /></div>}
    </>
  );

  const group = (key: Bucket, heading: string, note?: string) =>
    groups[key].length > 0 && (
      <div className="group">
        <h3>{heading} <span className="count num">{groups[key].length}</span></h3>
        {note && <p>{note}</p>}
        {groups[key].map(row)}
      </div>
    );

  const region = (
    <svg viewBox={`0 0 ${REGION.w} ${REGION.h}`} className="region" role="img" aria-label="The Bay Area, with the full contours of the listed stations">
      <defs>
        <clipPath id="regionclip"><rect width={REGION.w} height={REGION.h} /></clipPath>
      </defs>
      <rect width={REGION.w} height={REGION.h} fill="var(--water)" />
      <g clipPath="url(#regionclip)">
        <path d={map.region.land} fill="var(--land)" />
        <path d={map.region.countyLines} fill="none" stroke="#c3cdd1" strokeWidth={0.6} strokeDasharray="4 3" />
        {regionStations.map((s) => <path key={s.facility_id} d={map.region.contours[s.facility_id]} className={`contour r ${bucket(s, policy)}${sel === s.facility_id ? " selected" : ""}`} />)}
        {selected && !regionStations.includes(selected) && <path d={map.region.contours[selected.facility_id]} className="contour r selected" />}
        <path d={map.region.oakland} fill="var(--contour)" />
        <path d={map.region.cityFrame} fill="none" stroke="var(--ink)" strokeWidth={1} />
        {map.region.places.map((p) => (
          <g key={p.name}>
            <circle cx={p.x} cy={p.y} r={1.8} fill="var(--ink-2)" />
            <text x={p.anchor === "end" ? p.x - 4 : p.x + 4} y={p.y + 3} textAnchor={p.anchor} className="rlabel">{p.name}</text>
          </g>
        ))}
      </g>
      <rect width={REGION.w} height={REGION.h} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
      <text x={10} y={18} className="rtitle">The region</text>
      <g transform={`translate(${REGION.w - map.region.scalePx - 10}, ${REGION.h - 10})`}>
        <line x1={0} y1={0} x2={map.region.scalePx} y2={0} stroke="var(--ink)" strokeWidth={1.5} />
        <text x={map.region.scalePx / 2} y={-4} textAnchor="middle" className="rlabel">20 km</text>
      </g>
    </svg>
  );

  return (
    <>
      <div className="lead">
        <div className="lead-head">
          <p className="answer sans">
            <span className="n num">{S.qualifying}</span> FM stations meet the Oakland coverage rule.{" "}
            <span className="n num">{S.research_owner === 2 ? "Two" : S.research_owner}</span> report majority-minority voting interests in the 2023 FCC data.
          </p>
          {policy === "research" ? (
            <p className="answer2 sans">
              Two nonprofits report a female majority of governing voting interests: governance, not equity ownership.{" "}
              <span className="open">{S.research_confirm === 4 ? "Four" : S.research_confirm} need confirmation.</span>
            </p>
          ) : (
            <p className="answer2 sans">
              No supplier-diversity certificates were supplied or verified in this demonstration. FCC ownership data cannot establish certification.
              Of the {S.certified_denominator}: <span className="open num">{S.certified_confirm}</span> for-profit candidates to check,{" "}
              <span className="na num">{S.certified_na}</span> nonprofits or public bodies outside ownership-based certification,{" "}
              {S.certified_not_established} with no reported majority.
            </p>
          )}
          <p className="interest sans num">
            <strong>{S.naive_any_minority} of {S.qualifying}</strong> report at least one minority interest holder: a presence, not a majority.
          </p>
          <ul className="vintage sans">
            <li><span>Contours</span> Sept 2026</li>
            <li><span>Ownership evidence</span> Oct 2023</li>
            <li><span>Residents</span> 2020 Census</li>
          </ul>
        </div>

        <figure className="mapfig">
          <div className={`mapframe${selected ? " dim" : ""}`}>
            <svg viewBox={`0 0 ${CITY.w} ${CITY.h}`} className="citymap" role="img"
              aria-label="Oakland at city scale, hatched, with the modeled contours whose edge crosses the city">
              <defs>
                <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="9" stroke="var(--contour)" strokeWidth="1.3" />
                </pattern>
                <clipPath id="cityclip"><rect width={CITY.w} height={CITY.h} /></clipPath>
              </defs>
              <rect width={CITY.w} height={CITY.h} fill="var(--water)" />
              <g clipPath="url(#cityclip)">
                <path d={map.city.land} fill="var(--land)" />
                <path d={map.city.countyLines} fill="none" stroke="#c3cdd1" strokeWidth={1} strokeDasharray="6 4" />
                <path d={map.city.oakland} fill="url(#hatch)" stroke="var(--contour)" strokeWidth={2} />
                {cityStations.map((s) => (
                  <path key={s.facility_id} d={map.city.contours[s.facility_id]} className={`contour c ${s.kind}${sel === s.facility_id ? " selected" : ""}`} />
                ))}
                {cityLabels.map((l) => (
                  <text key={l.id} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className={`clabel ${l.kind}${sel === l.id ? " selected" : ""}`}>{l.text}</text>
                ))}
              </g>
              <g transform={`translate(28, ${CITY.h - 24})`}>
                <line x1={0} y1={0} x2={map.city.scalePx} y2={0} stroke="var(--ink)" strokeWidth={2} />
                <line x1={0} y1={-5} x2={0} y2={5} stroke="var(--ink)" strokeWidth={2} />
                <line x1={map.city.scalePx} y1={-5} x2={map.city.scalePx} y2={5} stroke="var(--ink)" strokeWidth={2} />
                <text x={map.city.scalePx / 2} y={-10} textAnchor="middle" className="placelabel">2 km</text>
              </g>
            </svg>
            <div className="regionwrap">{region}</div>
          </div>
          <figcaption className="mapcap">
            <span>Oakland city, hatched. At this scale only contours whose edge crosses the city show; the others cover all of it. Dotted grey: under half.</span>
          </figcaption>
        </figure>

        <div className="lead-rest">
          <div className="policy" role="group" aria-label="View">
            <button aria-pressed={policy === "research"} onClick={() => setPolicy("research")}>Research shortlist</button>
            <button aria-pressed={policy === "certified"} onClick={() => setPolicy("certified")}>Certification-required view (policy preview)</button>
          </div>
          <p className="policy-note">
            {policy === "research"
              ? "What the FCC ownership tables report, kept as reported: owners apart from governing boards, nothing certified."
              : "A preview of an export that requires an ownership-based credential. NMSDC also certifies minority-controlled companies below 51% ownership (MCC, MPC), so the credential type matters as much as the issuer."}
          </p>
          <ul className="legend">
            <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--contour)" strokeWidth="2.4" /></svg>{policy === "research" ? "Reported ownership majority" : "For-profit candidate"}</li>
            {policy === "research" && <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--board)" strokeWidth="1.8" strokeDasharray="1 4" strokeLinecap="round" /></svg>Nonprofit, female majority of governing votes</li>}
            {policy === "certified" && <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--ink-3)" strokeWidth="1.2" /></svg>Outside ownership-based certification</li>}
            <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--open)" strokeWidth="2" strokeDasharray="7 4" /></svg>Needs confirmation</li>
            <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--ink-3)" strokeWidth="1.4" strokeDasharray="2 3" /></svg>Touches Oakland, under half of its residents</li>
          </ul>
          <p className="download sans"><a href="/oakland_fm_audit_decisions.csv" download>Download the decision table</a> (60 facilities, reasons and source references, CSV)</p>
        </div>
      </div>

      <section className="block" aria-labelledby="ledger">
        <h2 id="ledger" className="sans">The stations, and what their filings establish</h2>
        <p className="sub">
          Rule, fixed before the run: a licensed FM or low power FM station qualifies when its modeled contour holds at least half of Oakland&apos;s 2020 residents.
          Select a station to see the record behind each line.
        </p>

        {policy === "research" ? (
          <>
            {group("own", "Reported ownership majority", "For-profit licensees whose reported voting interests are majority minority. Reported in 2023, not certified.")}
            {group("board", "Nonprofits with a reported governing majority", "Noncommercial licensees file Form 323-E, which reports governing voting interests. A nonprofit has no equity owners.")}
            {group("confirm", "Needs confirmation", "Evidence is missing, dated to another licensee, or insufficient. None of these is read as \"not diverse\".")}
          </>
        ) : (
          <>
            <div className="group">
              <h3>Credential verified <span className="count num">0</span></h3>
              <p>No supplier-diversity certificates were supplied or verified in this demonstration. A credential comes from its issuer or from your own verified records, and is checked for every supplier, not only those the 2023 FCC data flags.</p>
            </div>
            {group("confirm", "For-profit candidates to check", "Flagged by the 2023 FCC data. Check the issuer, the credential type and the legal entity it covers.")}
            {group("na", "Outside ownership-based certification", "Nonprofits and public bodies have no equity owners to certify. They stay in a research list; they do not enter this export.")}
          </>
        )}

        <div className="group">
          <h3>Qualifies geographically, no majority reported <span className="count num">{groups.none.length}</span></h3>
          <p>Their 2023 rows report no majority of minority or women voting interests. Share of Oakland residents inside each contour:</p>
          {chips(groups.none)}
        </div>

        <div className="group">
          <h3>Touch Oakland, below the rule <span className="count num">{groups.out.length}</span></h3>
          <p>Their contours intersect the city but hold less than half of its residents. A plain intersection test would have kept them.</p>
          {chips(groups.out)}
        </div>

        <div className="group">
          <h3>Translators, listed and left for a separate rule <span className="count num">{translators.length}</span></h3>
          <p>A translator can have its own licensee and often carries an AM or HD2 signal: here K229DD (Pham Radio Communication) and K257GE (Lazer Licenses) are held by their own companies. Only K205BM (K-LOVE) reaches half of Oakland, at 51%.</p>
          {chips(translators)}
        </div>

        <div className="group">
          <h3>Boosters, not counted <span className="count num">{boosters.length}</span></h3>
          <p>A booster repeats its own station on the same frequency. It extends that station&apos;s reach; it is not a separate property.</p>
          {chips(boosters)}
        </div>
      </section>
    </>
  );
}
