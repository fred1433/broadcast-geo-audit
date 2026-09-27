"use client";

import { useMemo, useState } from "react";
import audit from "@/data/audit.json";
import type { MapData } from "@/lib/map";
import { MAP_W, MAP_H, INSET } from "@/lib/map";

type Station = (typeof audit.stations)[number];
type Policy = "research" | "certified";
type Bucket = "own" | "board" | "confirm" | "na" | "none" | "out";

const fmt = (n: number) => n.toLocaleString("en-US");
const pctW = (x: number) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`; // bar widths
const pct = (x: number) => {
  const v = x * 100;
  if (v === 0) return "0%";
  if (v < 1) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
};
const title = (t: string) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/, Etc\.$/, ", etc.").replace(/\bLlc\b/g, "LLC");
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
  const art = /^[AEIOU]/.test(who) ? "an" : "a";
  if (e === "reported ownership majority") {
    const base = `Reports ${art} ${who} majority of voting interests, as of ${REPORT_DATE}.`;
    return policy === "certified" ? `${base} A for-profit licensee: a certification could exist, none is established here.` : base;
  }
  if (e === "reported board majority") {
    const base = `Nonprofit. Reports ${art} ${who} majority on its governing board, as of ${REPORT_DATE}. Governance, not ownership.`;
    return policy === "certified" ? "Nonprofit licensee with no owners: outside ownership-based certification." : base;
  }
  if (policy === "certified" && s.policy_certified.startsWith("not applicable")) {
    if (s.callsign === "KEXC") return "Now held by Friends of KEXP, a 501(c)(3) nonprofit: outside ownership-based certification.";
    if (s.service === "FL") return "Low power FM licensees are nonprofits or public bodies: outside ownership-based certification.";
    return "Noncommercial licensee, a nonprofit or public body: outside ownership-based certification.";
  }
  if (s.callsign === "KLVS")
    return `Assigned after the report from ${title(s.licensee_in_report ?? "")} to K-LOVE, Inc. Public sources describe the assignor as a subsidiary of the same group, so control likely did not change. Confirm with the current filing.`;
  if (e.includes("insufficient data"))
    return `The ${REPORT_DATE} row describes a different licensee (${title(s.licensee_in_report ?? "")}, then ${s.callsign_in_report}) and the FCC marks it insufficient data. Nothing is established about the current licensee.`;
  if (e.startsWith("unresolved: licensee changed"))
    return `Licensee changed after the report, from ${title(s.licensee_in_report ?? "")} to ${title(s.licensee_fcc_query_2026)}. Confirm with the current filing.`;
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
        {pct(s.share_est)} of Oakland residents{range ? `, ${pct(s.share_low)} to ${pct(Math.min(1, s.share_high))}` : ""}
      </span>
    </span>
  );
}

function Detail({ s }: { s: Station }) {
  const nce = s.report_file?.includes("Noncommercial");
  const rebroadcast = s.service === "FX" || s.service === "FB";
  const kind = s.service === "FL" ? "low power FM" : s.service === "FX" ? "FM translator" : s.service === "FB" ? "FM booster" : "FM";
  return (
    <div className="detail">
      <div>
        <h4>Contour used</h4>
        <dl>
          <dt>Record</dt><dd>FCC {kind} license, application {s.licensed_application_ids}</dd>
          {!rebroadcast && <><dt>Model</dt><dd>{s.contour_dbu} dBu protected contour, F(50,50) prediction</dd></>}
          <dt>Station</dt><dd>{s.station_class ? `Class ${s.station_class}, ` : ""}{s.frequency} MHz, licensed to {title(s.community_of_license)}</dd>
          <dt>Area</dt><dd className="num">{fmt(s.contour_km2)} km²</dd>
          {!rebroadcast && !s.largest_record.startsWith(`${s.service}/LIC`) && (
            <><dt>Note</dt><dd>The largest contour on file for this facility is a {s.largest_record === "FS/LIC" ? "licensed auxiliary (backup) transmitter" : "pending application"}, not this license. The audit uses the license.</dd></>
          )}
        </dl>
      </div>
      <div>
        <h4>Oakland residents inside it</h4>
        <dl>
          <dt>Estimate</dt><dd className="num">{fmt(s.residents_est)} of {fmt(audit.summary.zone.residents_2020)}</dd>
          <dt>Range</dt><dd className="num">{fmt(s.residents_low)} to {fmt(s.residents_high)}</dd>
          <dt>Basis</dt><dd>2020 Census blocks. The range runs from blocks wholly inside the contour to every block it cuts. Not listeners, not 2026 residents.</dd>
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
            <dt>Source</dt><dd>{s.report_file ? `FCC Form ${nce ? "323-E (noncommercial)" : "323 (commercial)"}, Report on Ownership of Broadcast Stations, data as of ${REPORT_DATE}` : "None in the 2023 report"}</dd>
            {s.report_file && <><dt>Measure</dt><dd>{nce ? "Votes on the governing board. A nonprofit has no owners." : "Majority of voting interests."}</dd></>}
            {s.licensee_in_report && <><dt>In report</dt><dd>{s.licensee_in_report}{s.callsign_in_report && s.callsign_in_report !== s.callsign ? ` (then ${s.callsign_in_report})` : ""}, as of {REPORT_DATE}</dd></>}
            <dt>Licensee now</dt><dd>{s.licensee_fcc_query_2026} (FCC FM Query)</dd>
            {s.entity_type && <><dt>Entity</dt><dd>{s.entity_type.replace(/^nonprofit \(IRS/, "nonprofit (IRS")}</dd></>}
            {s.report_file && !s.maj_insufficient_data && (
              <><dt>Any interest</dt><dd>{s.any_minority ? "At least one minority interest holder" : "No minority interest holder"}{s.any_female ? ", at least one woman" : ""}. A presence, not control.</dd></>
            )}
            {s.maj_insufficient_data === 1 && <><dt>Interests</dt><dd>Not established: the FCC could not process the reported interests.</dd></>}
            <dt>Certification</dt><dd>{s.policy_certified.startsWith("not applicable") ? "Not applicable: nonprofit or public body." : "Not established from these sources."}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

type Label = { id: number; x: number; y: number; text: string; kind: string };

function placeLabels(cands: { id: number; text: string; kind: string; pts: [number, number][] }[],
  blockers: { x: number; y: number; w: number; h: number }[], charW: number, h: number, minX: number, maxX: number) {
  const boxes = [...blockers];
  const out: Label[] = [];
  const hit = (b: { x: number; y: number; w: number; h: number }) =>
    boxes.some((o) => Math.abs(o.x - b.x) * 2 < o.w + b.w + 6 && Math.abs(o.y - b.y) * 2 < o.h + b.h + 4);
  for (const c of cands) {
    const w = c.text.length * charW;
    let chosen: [number, number] | null = null;
    for (const p of c.pts) {
      const x = Math.min(maxX - w / 2, Math.max(minX + w / 2, p[0]));
      const b = { x, y: p[1], w, h };
      if (!hit(b)) { chosen = [x, p[1]]; break; }
    }
    if (chosen) {
      boxes.push({ x: chosen[0], y: chosen[1], w, h });
      out.push({ id: c.id, x: chosen[0], y: chosen[1], text: c.text, kind: c.kind });
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
  const drawn = useMemo(() => [...groups.own, ...groups.board, ...groups.confirm, ...groups.na], [groups]);
  const cls = (s: Station) => `contour ${bucket(s, policy)}${sel === s.facility_id ? " selected" : ""}`;

  // Main map labels: large contours only (small ones are labelled in the inset). Collision boxes are sized
  // for the phone layout, where the text is largest relative to the map.
  const labels = useMemo(() => {
    const list = [...drawn].filter((s) => s.contour_km2 > 1500).sort((a, b) => b.contour_km2 - a.contour_km2);
    if (selected && !list.includes(selected) && selected.contour_km2 > 1500) list.unshift(selected);
    const blockers = [
      ...map.places.map((p) => ({ x: p.anchor === "end" ? p.x - p.name.length * 6.5 : p.x + p.name.length * 6.5, y: p.y, w: p.name.length * 13 + 12, h: 26 })),
      { x: map.oaklandLabel[0] + 60, y: map.oaklandLabel[1] + 18, w: 150, h: 34 },
      { x: map.oaklandLabel[0], y: map.oaklandLabel[1], w: 170, h: 170 }, // keep the focal city clear
      { x: 22 + INSET.w / 2, y: MAP_H - 22 - INSET.h / 2, w: INSET.w + 20, h: INSET.h + 20 }, // desktop inset
      { x: MAP_W - 90, y: MAP_H - 30, w: 180, h: 50 }, // scale bar
    ];
    return placeLabels(list.map((s) => ({ id: s.facility_id, text: s.callsign, kind: bucket(s, policy), pts: map.anchors[s.facility_id] ?? [] })),
      blockers, 15, 26, 8, MAP_W - 8);
  }, [drawn, selected, map, policy]);

  // Inset: contours whose edge crosses the city (partial coverage), in or out of the rule
  const insetStations = useMemo(() => fm.filter((s) => s.share_est < 0.999 && s.share_est > 0.02).map((s) => ({
    ...s, kind: s.geo_status !== "qualifies" ? "below" : bucket(s, policy) === "none" ? "muted" : bucket(s, policy),
  })), [fm, policy]);
  const insetLabels = useMemo(() => {
    const want = insetStations.filter((s) => s.kind !== "muted");
    const merged = new Map<string, { id: number; text: string; kind: string; pts: [number, number][] }>();
    for (const s of want) {
      const key = map.inset.contours[s.facility_id];
      const prev = merged.get(key);
      if (prev) prev.text = `${prev.text} / ${s.callsign}`;
      else merged.set(key, { id: s.facility_id, text: s.callsign, kind: s.kind, pts: map.inset.anchors[s.facility_id] ?? [] });
    }
    return placeLabels([...merged.values()], [{ x: 95, y: 30, w: 190, h: 50 }, { x: INSET.w - 40, y: INSET.h - 20, w: 90, h: 36 }],
      8.2, 16, 4, INSET.w - 4);
  }, [insetStations, map]);

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

  const inset = (
    <svg viewBox={`0 0 ${INSET.w} ${INSET.h}`} className="inset" role="img" aria-label="Oakland at city scale, with the contours that cross it">
      <defs>
        <pattern id="hatch-i" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--contour)" strokeWidth="1.4" />
        </pattern>
        <clipPath id="insetclip"><rect width={INSET.w} height={INSET.h} /></clipPath>
      </defs>
      <rect width={INSET.w} height={INSET.h} fill="var(--water)" />
      <g clipPath="url(#insetclip)">
        <path d={map.inset.land} fill="var(--land)" />
        <path d={map.inset.oakland} fill="url(#hatch-i)" stroke="var(--contour)" strokeWidth={1.4} />
        {insetStations.map((s) => (
          <path key={s.facility_id} d={map.inset.contours[s.facility_id]} className={`contour ${s.kind}${sel === s.facility_id ? " selected" : ""}`} />
        ))}
        {insetLabels.map((l) => (
          <text key={l.id} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className={`ilabel ${l.kind}`}>{l.text}</text>
        ))}
      </g>
      <rect width={INSET.w} height={INSET.h} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
      <text x={12} y={22} className="insetlabel">Oakland, closer</text>
      <text x={12} y={39} className="insetnote">Contours that cut the city. Dotted: under half.</text>
      <g transform={`translate(${INSET.w - map.inset.scalePx - 14}, ${INSET.h - 14})`}>
        <line x1={0} y1={0} x2={map.inset.scalePx} y2={0} stroke="var(--ink)" strokeWidth={2} />
        <text x={map.inset.scalePx / 2} y={-6} textAnchor="middle" className="insetscale">5 km</text>
      </g>
    </svg>
  );

  return (
    <>
      <div className="lead">
        <div>
          <p className="answer sans">
            <span className="n num">{S.qualifying}</span> FM stations put at least half of Oakland&apos;s residents inside their modeled contour.
          </p>
          {policy === "research" ? (
            <p className="answer2 sans">
              <span className="in num">{S.research_owner}</span> report a minority majority of their owners&apos; voting interests.{" "}
              <span className="board num">{S.research_board}</span> more are nonprofits with a women-majority board: governance, not ownership.{" "}
              <span className="open num">{S.research_confirm}</span> need confirmation.
            </p>
          ) : (
            <p className="answer2 sans">
              <span className="num">{S.certified_in}</span> carry a certification in public FCC records.{" "}
              <span className="open num">{S.certified_confirm}</span> for-profit candidates need one confirmed.{" "}
              <span className="na num">{S.certified_na}</span> are nonprofits or public bodies, outside ownership-based certification.
            </p>
          )}
          <div className="policy" role="group" aria-label="Export policy">
            <button aria-pressed={policy === "research"} onClick={() => setPolicy("research")}>Research shortlist</button>
            <button aria-pressed={policy === "certified"} onClick={() => setPolicy("certified")}>Certified export</button>
          </div>
          <p className="policy-note">
            {policy === "research"
              ? "What the FCC ownership forms report, kept as reported: owners apart from boards, nothing certified."
              : "An export that must carry an ownership-based certification (NMSDC, WBENC or similar). Those certify for-profit businesses; FCC filings cannot supply one."}
          </p>
          <p className="residents">
            {policy === "research" ? (
              <><strong className="num">{fmt(S.shortlist_union.est)}</strong> residents (2020 Census) live inside the combined modeled contours of the {S.research_owner + S.research_board} reported stations: all of Oakland. Not an audience estimate.</>
            ) : (
              <>Nothing is exported until a certification is attached to KRZZ or KSJO. The FCC forms remain the evidence that sends them to be checked.</>
            )}
          </p>
          <ul className="legend">
            {policy === "research" ? (
              <>
                <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--contour)" strokeWidth="2.4" /></svg>Reported ownership majority</li>
                <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--board)" strokeWidth="1.6" strokeDasharray="1 4" strokeLinecap="round" /></svg>Nonprofit, women-majority board</li>
              </>
            ) : (
              <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--ink-3)" strokeWidth="1.2" /></svg>Outside certification</li>
            )}
            <li><svg width="34" height="10" aria-hidden><line x1="1" y1="5" x2="33" y2="5" stroke="var(--open)" strokeWidth="2" strokeDasharray="7 4" /></svg>Needs confirmation</li>
            <li><svg width="34" height="14" aria-hidden><rect x="1" y="1" width="32" height="12" fill="url(#hatch-legend)" stroke="var(--contour)" strokeWidth="1.2" /><defs><pattern id="hatch-legend" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--contour)" strokeWidth="1.2" /></pattern></defs></svg>Oakland city, Census place 0653000</li>
          </ul>
        </div>

        <figure className="mapfig">
          <div className={`mapframe${selected ? " dim" : ""}`}>
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="mainmap" role="img" aria-label="Map of the Bay Area with Oakland hatched and the modeled FM contours of the stations in the current list">
              <defs>
                <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="7" stroke="var(--contour)" strokeWidth="1.6" />
                </pattern>
                <clipPath id="frame"><rect width={MAP_W} height={MAP_H} /></clipPath>
              </defs>
              <g clipPath="url(#frame)">
                {map.counties.map((c) => <path key={c.geoid} d={c.d} className={`county${c.bay ? "" : " out"}`} />)}
                <path d={map.countyLines} fill="none" stroke="#c3cdd1" strokeWidth={0.8} strokeDasharray="5 3" />
                <path d={map.oaklandLand} fill="url(#hatch)" stroke="var(--contour)" strokeWidth={1.4} />
                {drawn.map((s) => <path key={s.facility_id} d={map.contours[s.facility_id]} className={cls(s)} />)}
                {selected && !drawn.includes(selected) && <path d={map.contours[selected.facility_id]} className="contour selected" />}
                {map.places.map((p) => (
                  <g key={p.name}>
                    <circle cx={p.x} cy={p.y} r={2.4} fill="var(--ink-2)" />
                    <text x={p.anchor === "end" ? p.x - 6 : p.x + 6} y={p.y + 4} textAnchor={p.anchor} className="placelabel">{p.name}</text>
                  </g>
                ))}
                <text x={map.oaklandLabel[0] + 14} y={map.oaklandLabel[1] + 22} className="oaklabel">Oakland</text>
                {labels.map((l) => (
                  <text key={l.id} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle"
                    className={`clabel ${l.kind}${sel === l.id ? " selected" : ""}`}>{l.text}</text>
                ))}
              </g>
              <g transform={`translate(${MAP_W - map.scaleBar.px - 30}, ${MAP_H - 30})`}>
                <rect x={-10} y={-24} width={map.scaleBar.px + 20} height={36} fill="var(--land)" opacity={0.85} />
                <line x1={0} y1={0} x2={map.scaleBar.px} y2={0} stroke="var(--ink)" strokeWidth={2} />
                <line x1={0} y1={-5} x2={0} y2={5} stroke="var(--ink)" strokeWidth={2} />
                <line x1={map.scaleBar.px} y1={-5} x2={map.scaleBar.px} y2={5} stroke="var(--ink)" strokeWidth={2} />
                <text x={map.scaleBar.px / 2} y={-9} textAnchor="middle" className="placelabel">20 km</text>
              </g>
            </svg>
            <div className="insetwrap">{inset}</div>
          </div>
          <figcaption className="mapcap">
            <span>Contours: FCC FM service contour file of Sept 26, 2026. Land: Census cartographic boundaries.</span>
            <span>Lambert conformal conic</span>
          </figcaption>
        </figure>
      </div>

      <section className="block" aria-labelledby="ledger">
        <h2 id="ledger" className="sans">The stations, and what their filings establish</h2>
        <p className="sub">
          Rule, fixed before the run: a licensed FM or low power FM station qualifies when its modeled contour holds at least half of Oakland&apos;s 2020 residents.
          Select a station to see the record behind each line.
        </p>

        {policy === "research" ? (
          <>
            {group("own", "Reported ownership majority", "For-profit licensees whose owners' voting interests are reported as majority minority. Reported, not certified.")}
            {group("board", "Nonprofits with a reported board majority", "Noncommercial licensees file Form 323-E, which reports the governing board. A nonprofit has no owners.")}
            {group("confirm", "Needs confirmation", "Evidence is missing, superseded or insufficient. None of these is read as \"not diverse\".")}
          </>
        ) : (
          <>
            <div className="group">
              <h3>Admitted to a certified export <span className="count num">0</span></h3>
              <p>No station. Certification is not something the FCC records; it comes from the certifying body or from your own verified records.</p>
            </div>
            {group("confirm", "For-profit candidates, certification to confirm", "A reported ownership majority makes them worth checking with the certifying bodies.")}
            {group("na", "Outside ownership-based certification", "Nonprofits and public bodies have no owners to certify. They stay in a research list; they do not enter this export.")}
          </>
        )}

        <div className="group">
          <h3>Qualifies geographically, no majority reported <span className="count num">{groups.none.length}</span></h3>
          <p>Their 2023 filings report no majority of minority or women voting interests. Share of Oakland residents inside each contour:</p>
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
