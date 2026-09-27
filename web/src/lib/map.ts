import { geoConicConformal, geoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import geo from "@/data/geo.json";
import contourData from "@/data/contours.json";

// Main view: Oakland at city scale (the decision area). Inset: the region, for the full contour loops.
export const CITY = { w: 900, h: 760 };
export const REGION = { w: 300, h: 300 };

type Geom = GeoPermissibleObjects;
type Pos = [number, number];
type Win = [[number, number], [number, number]];

export type View = {
  land: string;
  countyLines: string;
  oakland: string;
  contours: Record<number, string>;
  anchors: Record<number, Pos[]>;
  scalePx: number;
  scaleKm: number;
};
export type MapData = {
  city: View;
  region: View & { places: { name: string; x: number; y: number; anchor: "start" | "end" }[]; oaklandLabel: Pos; cityFrame: string };
};

function box(w: Win): Geom {
  // clockwise ring (d3-geo winding)
  return {
    type: "Polygon",
    coordinates: [[[w[0][0], w[0][1]], [w[0][0], w[1][1]], [w[1][0], w[1][1]], [w[1][0], w[0][1]], [w[0][0], w[0][1]]]],
  } as Geom;
}

function conic(size: [number, number], w: Win): GeoProjection {
  // Lambert conformal conic on the standard parallels of California zone III, north up
  return geoConicConformal().parallels([37.0667, 38.4333]).rotate([120.5, 0]).fitSize(size, box(w));
}

function rings(g: { type: string; coordinates: unknown }): Pos[] {
  if (g.type === "Polygon") return (g.coordinates as Pos[][]).flat();
  if (g.type === "MultiPolygon") return (g.coordinates as Pos[][][]).flat(2);
  return [];
}

function kmToPx(pr: GeoProjection, lat: number, km: number, lon: number) {
  const a = pr([lon, lat]) ?? [0, 0];
  const b = pr([lon + km / (111.32 * Math.cos((lat * Math.PI) / 180)), lat]) ?? [0, 0];
  return Math.abs(b[0] - a[0]);
}

function view(size: { w: number; h: number }, win: Win, margin: number, scaleKm: number): { v: View; pr: GeoProjection } {
  const pr = conic([size.w, size.h], win);
  const path = geoPath(pr);
  const p = (g: unknown) => path(g as Geom) ?? "";
  const contours: Record<number, string> = {};
  const anchors: Record<number, Pos[]> = {};
  for (const [id, g] of Object.entries(contourData)) {
    contours[Number(id)] = p(g);
    const pts = rings(g as { type: string; coordinates: unknown })
      .map((c) => pr(c) as Pos)
      .filter((q) => q && q[0] > margin && q[0] < size.w - margin && q[1] > margin && q[1] < size.h - margin);
    const step = Math.max(1, Math.floor(pts.length / 40));
    anchors[Number(id)] = pts.filter((_, i) => i % step === 0);
  }
  return {
    pr,
    v: {
      land: geo.counties.map((c) => p(c.geom)).join(""),
      countyLines: geo.county_lines ? p(geo.county_lines) : "",
      oakland: p(geo.oakland_land),
      contours,
      anchors,
      scalePx: kmToPx(pr, win[0][1] + (win[1][1] - win[0][1]) * 0.1, scaleKm, (win[0][0] + win[1][0]) / 2),
      scaleKm,
    },
  };
}

export function buildMap(): MapData {
  const ob = rings(geo.oakland_land as { type: string; coordinates: unknown });
  const xs = ob.map((q) => q[0]), ys = ob.map((q) => q[1]);
  const cityWin: Win = [[Math.min(...xs) - 0.03, Math.min(...ys) - 0.018], [Math.max(...xs) + 0.03, Math.max(...ys) + 0.018]];
  const city = view(CITY, cityWin, 40, 2).v;

  const regionWin: Win = [[geo.view[0], geo.view[1]], [geo.view[2], geo.view[3]]];
  const r = view(REGION, regionWin, 14, 20);
  const labelLeft = new Set(["San Francisco", "San Mateo"]);
  const cf = geoPath(r.pr)(box(cityWin)) ?? "";
  const [lx, ly] = r.pr([-122.2, 37.78]) ?? [0, 0];
  return {
    city,
    region: {
      ...r.v,
      cityFrame: cf,
      oaklandLabel: [lx, ly],
      places: geo.places
        .filter((pl) => ["San Francisco", "San Jose", "Santa Rosa", "Livermore"].includes(pl.name))
        .map((pl) => {
          const [x, y] = r.pr([pl.lon, pl.lat]) ?? [0, 0];
          return { name: pl.name, x, y, anchor: labelLeft.has(pl.name) ? "end" : "start" };
        }),
    },
  };
}
