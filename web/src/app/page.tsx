import Audit from "@/components/Audit";
import audit from "@/data/audit.json";
import { buildMap } from "@/lib/map";

const fmt = (n: number) => n.toLocaleString("en-US");

const SOURCES: [string, string, string][] = [
  ["FCC FM service contours", "Daily file of Sept 26, 2026 (active records)", "US government work"],
  ["FCC FM Query, California", "Retrieved Sept 27, 2026", "US government work"],
  ["FCC Report on Ownership of Broadcast Stations, Forms 323 and 323-E", "Data as of Oct 1, 2023, released Jan 2025", "US government work"],
  ["Census TIGER/Line, places and 2020 blocks with counts", "Release of Sept 2025; boundaries as of Jan 1, 2025; counts from the 2020 Census", "US government work, cite the Census Bureau"],
  ["Census cartographic boundaries, counties", "2024 release (display only)", "US government work"],
  ["IRS exempt organizations (via ProPublica Nonprofit Explorer)", "Retrieved Sept 27, 2026 (one record: Friends of KEXP)", "Public record"],
  ["Nielsen DMA", "Not used", "Licensed data required"],
  ["Medill State of Local News", "Not used", "No suitable reuse permission established; excluded"],
];

const REPO = "https://github.com/fred1433/broadcast-geo-audit";

const TESTS = [
  "Block counts reproduce the published 2020 totals of all nine Bay Area counties and of Oakland (440,646)",
  "Owners and boards are never merged: the four reported stations split two and two",
  "The certified export keeps only for-profit candidates; nonprofits and public bodies are marked not applicable",
  "KEXC's 2023 row is read with its licensee of that date (KREV, a bankruptcy estate), not today's",
  "A shape that meets the city at a single point intersects it and holds nobody (synthetic case)",
  "284 neighboring blocks that share only an edge with Oakland add no one to any count",
  "Every audited contour is the licensed record of its own facility; the two where the largest record differs are pinned",
  "Contour thresholds checked against the FCC distance calculator on two stations (54 dBu class B, 60 dBu reserved band)",
  "Noncommercial filings are always labelled as board votes, never as equity",
  "A superseded licensee or a missing filing stays unresolved; it never becomes \"not diverse\"",
  "The certified-export policy admits nobody from FCC sources",
  "The union of contours never exceeds the city; the sum does",
];

export default function Page() {
  const map = buildMap();
  const S = audit.summary;
  return (
    <main className="wrap">
      <header className="titleblock sans">
        <div>
          <h1>Oakland FM audit</h1>
          <p>Modeled coverage and reported ownership of FM stations, City of Oakland, California</p>
        </div>
        <div className="right">
          <p>Prepared {new Date(S.built + "T12:00:00").toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</p>
          <p>Public FCC and Census records only</p>
        </div>
      </header>

      <Audit map={map} />

      <section className="block" aria-labelledby="moves">
        <h2 id="moves" className="sans">What changed the list</h2>
        <p className="sub">Each of these was measured in this run. Where a check changed nothing in Oakland, it says so.</p>
        <ul className="moves">
          <li>
            <span className="fig num"><s>{S.naive_any_minority}</s> {S.majority_minority}</span>
            <h3>An interest is not a majority</h3>
            <p>{S.naive_any_minority} of the {S.qualifying} stations report at least one minority interest holder. {S.majority_minority} report a minority majority of voting interests. A flag built on presence would call most of the dial diverse.</p>
          </li>
          <li>
            <span className="fig num">2 of 4</span>
            <h3>A board is not an owner</h3>
            <p>KQED-FM and KPFA are nonprofits and file Form 323-E, which reports their governing board. Their women majority is governance. Ownership-based certifications (WBENC, NMSDC) cover for-profit businesses, so these two are outside their scope, not waiting for them.</p>
          </li>
          <li>
            <span className="fig num"><s>{S.touching}</s> {S.qualifying}</span>
            <h3>Touching is not reaching</h3>
            <p>{S.touching} FM and low power FM contours intersect Oakland; {S.qualifying} hold at least half of its residents. KPOO holds 0.5% of the city. The 50% line is ours: Oakland&apos;s own KACR-LP and KJTZ-LP sit at 47% (49.7% at the upper bound) and would cross a lower line.</p>
          </li>
          <li>
            <span className="fig num">KREV</span>
            <h3>A filing describes the licensee of its date</h3>
            <p>The 2023 row for today&apos;s KEXC describes KREV, then held by a bankruptcy estate; the station has since passed to Friends of KEXP. Read against today&apos;s licensee, the row would say something about the wrong company.</p>
          </li>
          <li>
            <span className="fig num">KIOI, KBAY</span>
            <h3>The largest contour is not always the license</h3>
            <p>Taking each facility&apos;s largest contour on file, as the FCC&apos;s published contour-lookup code does (sortBy=area, maxFeatures=1), would cite a backup transmitter for KIOI and a pending application for KBAY. In Oakland it changes no qualification; in a tighter area it could.</p>
          </li>
          <li>
            <span className="fig num">Oct 1, 2023</span>
            <h3>Filings age</h3>
            <p>The ownership data is a snapshot as of that date. The FCC waived the 2025 biennial filing and set the next deadline at June 1, 2027 (DA 25-671), so no newer snapshot exists. Summed station by station, the reported stations hold {fmt(S.shortlist_sum)} residents; their union holds Oakland once, {fmt(S.shortlist_union.est)}.</p>
          </li>
        </ul>
      </section>

      <section className="block" aria-labelledby="eng">
        <h2 id="eng" className="sans">For the engineers</h2>
        <p className="sub">Everything above is precomputed in PostGIS and frozen into this page. Nothing here is drawn freehand or queried live.</p>
        <div className="eng">
          <div>
            <h3>Method</h3>
            <ul>
              <li>Analysis in EPSG:5070 (Albers equal-area). Display shapes are simplified copies; no count is ever taken from them.</li>
              <li>Residents come from 2020 Census blocks, allocated by the share of each block inside the contour and the city. Blocks carry disclosure-avoidance noise and are meant to be added up, which is how they are used here.</li>
              <li>Contours are the FCC&apos;s predicted protected contours: 54 dBu for class B, 57 dBu for B1, 60 dBu otherwise and for every reserved-band noncommercial station. A prediction, not a measurement of reception.</li>
              <li>AM is out of scope: the FCC publishes no comparable contour file. Television and DMA assignment are separate questions and are not mixed in.</li>
              <li>Geographies are joined by identifier (place 0653000), never by name. ZIP codes are not used; where a ZIP question comes up, a ZCTA is labelled as a ZCTA.</li>
            </ul>
            <h3 style={{ marginTop: 26 }}>The rule, as it runs</h3>
            <pre className="sql">{`-- residents of Oakland inside one contour g
select round(sum(b.pop * b.w * f.frac))
from   geo.audit_block b      -- 2020 blocks; w = share inside Oakland
cross join lateral (
  select case when ST_Within(b.geom_aea, g) then 1.0
              else ST_Area(ST_Intersection(b.geom_aea, g))
                   / ST_Area(b.geom_aea) end as frac) f
where  ST_Intersects(b.geom_aea, g);

-- g is the facility's LICENSED contour (status LIC, matched
-- by LMS application id), never the largest one on file.
-- The station qualifies when the result is >= 50% of 440,646.`}</pre>
          </div>
          <div>
            <h3>Sources</h3>
            <div className="tablewrap">
              <table className="sources">
                <thead><tr><th>Source</th><th>Vintage</th><th>Rights</th></tr></thead>
                <tbody>
                  {SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}
                </tbody>
              </table>
            </div>
            <h3 style={{ marginTop: 26 }}>Checks that run with it</h3>
            <ul>{TESTS.map((t) => <li key={t}>{t}</li>)}</ul>
            <h3 style={{ marginTop: 26 }}>Where your data joins</h3>
            <p>Three empty tables wait for what you already hold: a county to DMA table loaded from your Nielsen license, an outlet-coverage table keyed on your own outlet identifiers (where a newspaper&apos;s declared counties sit next to a station&apos;s contour), and a certification table with scheme, certificate, validity and the date it was verified.</p>
            <h3 style={{ marginTop: 26 }}>Code and tests</h3>
            <p>The loading scripts, the PostGIS model, the audit queries and the {TESTS.length} checks above are public, with the steps to rebuild everything from the government files: <a href={REPO}>{REPO.replace("https://", "")}</a>.</p>
          </div>
        </div>
      </section>

      <footer className="sans">
        <span>Prepared by The AI Pipe</span>
        <span>Census and FCC data are public records; the method and its errors are ours.</span>
      </footer>
    </main>
  );
}
