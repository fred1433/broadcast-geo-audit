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
  ["Run manifest: every input with URL, vintage and SHA-256; FCC inputs kept as extracts", "This run", "In the repository (manifest/, evidence/)"],
  ["Nielsen DMA", "Not used", "Licensed data required"],
  ["Medill State of Local News", "Not used", "No suitable reuse permission established; excluded"],
];

const REPO = "https://github.com/fred1433/broadcast-geo-audit";

const TESTS = [
  "Block counts reproduce the published 2020 totals of all nine Bay Area counties and of Oakland (440,646)",
  "Allocation uses the joint intersection of block, city and contour; a block split between city and contour gets nobody (synthetic case)",
  "A shape that meets a block at a single point is first proven to touch, then shown to receive nobody (synthetic case)",
  "284 neighboring blocks that share only an edge with Oakland add no one to any count",
  "Owners and governing boards are never merged: the four reported stations split two and two",
  "Across all 34 qualifying stations, every nonprofit or public body is out of scope for ownership-based certification",
  "KEXC's 2023 row is read with its licensee of that date (KREV, a bankruptcy estate), not today's",
  "Every audited contour is the licensed record of its own facility; the two where the largest record differs are pinned",
  "Contour thresholds checked against the FCC distance calculator on two stations (54 dBu class B, 60 dBu reserved band)",
  "A different licensee name or a missing filing stays unresolved; it never becomes \"not diverse\"",
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
          <p>Built from public records; sources below</p>
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
            <h3>Governance is not ownership</h3>
            <p>KQED-FM and KPFA are nonprofits and file Form 323-E, which reports governing voting interests. Their female majority is governance, not equity ownership. Ownership-based certifications (WBENC, NMSDC&apos;s MBE) cover for-profit businesses, so these two are outside their scope, not waiting for them.</p>
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
            <p>This audit uses the synchronized ownership snapshot of October 1, 2023. The FCC waived the 2025 biennial round (DA 25-671). Later individual filings and ownership transactions are not comprehensively reviewed here, and a licensee name that still matches is not a check of current ownership.</p>
          </li>
          <li>
            <span className="fig num"><s>{fmt(S.shortlist_sum)}</s> {fmt(S.shortlist_union.est)}</span>
            <h3>Contours overlap</h3>
            <p>Summed station by station, the four reported stations hold more people than Oakland has; their union holds the city once. KRZZ alone already covers {Math.round(S.krzz_alone * 100)}% of it, so the union adds no reach: it only keeps the count honest.</p>
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
              <li>Residents come from 2020 Census blocks, allocated by the share of each block&apos;s area that lies inside both the city and the contour. Blocks carry disclosure-avoidance noise and are meant to be added up, which is how they are used here. Low and high figures are allocation bounds, not confidence intervals.</li>
              <li>Contours are the FCC&apos;s predicted protected contours: 54 dBu for class B, 57 dBu for B1, 60 dBu otherwise and for every reserved-band noncommercial station. A prediction, not a measurement of reception.</li>
              <li>AM is out of scope: the FCC publishes no comparable contour file. Television and DMA assignment are separate questions and are not mixed in.</li>
              <li>Geographies are joined by identifier (place 0653000), never by name. ZIP codes are not used; where a ZIP question comes up, a ZCTA is labelled as a ZCTA.</li>
            </ul>
            <h3 style={{ marginTop: 26 }}>The rule, as it runs</h3>
            <pre className="sql">{`-- share of a block allocated to city AND contour
create function geo.alloc_share(block, zone, target) as
  ST_Area(ST_Intersection(ST_Intersection(block, zone), target))
  / ST_Area(block);

-- residents of Oakland inside one licensed contour g
select sum(b.pop * ST_Area(ST_Intersection(b.geom_in, g))
                 / ST_Area(b.geom_aea))
from   geo.audit_block b   -- 2020 blocks; geom_in = part inside Oakland
where  ST_Intersects(b.geom_in, g);

-- g is the LICENSED contour (status LIC, matched by LMS id),
-- never the largest on file. Qualifies at >= 50% of 440,646.`}</pre>
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
            <p>Facility, outlet, licensed entity, ownership entity and certified supplier are five different things; this audit only reaches the first three. Three empty tables mark where your records attach: a partial, county-level DMA placeholder for your Nielsen license, an outlet-coverage table keyed on your own outlet identifiers, and a certification table with issuer, credential type, certified entity, validity and verification date. Linking an outlet to a certified entity is a reviewed decision with its own effective dates, never an automatic join.</p>
            <h3 style={{ marginTop: 26 }}>Code and tests</h3>
            <p>The loading scripts, the PostGIS model, the audit queries and the checks above are public. The repository separates reproducing this run (inputs pinned by hash, FCC files kept as extracts) from refreshing it with today&apos;s FCC data: <a href={REPO}>{REPO.replace("https://", "")}</a>.</p>
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
