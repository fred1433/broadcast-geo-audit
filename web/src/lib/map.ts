import { geoConicConformal, geoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import geo from "@/data/geo.json";
import contourData from "@/data/contours.json";

export const MAP_W = 900;
export const MAP_H = 860;
export const INSET = { w: 330, h: 330 };

// window = extent of the contours drawn by default (computed at export), so every drawn contour is whole
const WINDOW: [[number, number], [number, number]] = [[geo.view[0], geo.view[1]], [geo.view[2], geo.view[3]]];

type Geom = GeoPermissibleObjects;
type Pos = [number, number];

export type MapData = {
  counties: { geoid: string; bay: boolean; d: string }[];
  countyLines: string;
  oaklandLand: string;
  oaklandLabel: Pos;
  places: { name: string; x: number; y: number; anchor: "start" | "end" }[];
  contours: Record<number, string>;
  anchors: Record<number, Pos[]>;
  inset: { land: string; oakland: string; contours: Record<number, string>; anchors: Record<number, Pos[]>; scaleKm: number; scalePx: number };
  scaleBar: { px: number; km: number };
};

function box(w: [[number, number], [number, number]]): Geom {
  // clockwise ring (d3-geo winding)
  return {
    type: "Polygon",
    coordinates: [[[w[0][0], w[0][1]], [w[0][0], w[1][1]], [w[1][0], w[1][1]], [w[1][0], w[0][1]], [w[0][0], w[0][1]]]],
  } as Geom;
}

function conic(size: [number, number], w: [[number, number], [number, number]]): GeoProjection {
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

export function buildMap(): MapData {
  const pr = conic([MAP_W, MAP_H], WINDOW);
  const path = geoPath(pr);
  const p = (g: unknown) => path(g as Geom) ?? "";

  const contours: Record<number, string> = {};
  const anchors: Record<number, Pos[]> = {};
  for (const [id, g] of Object.entries(contourData)) {
    contours[Number(id)] = p(g);
    // label candidates: the top, right, bottom and left extremes of the contour that fall inside the frame
    const pts = rings(g as { type: string; coordinates: unknown })
      .map((c) => pr(c) as Pos)
      .filter((q) => q && q[0] > 60 && q[0] < MAP_W - 60 && q[1] > 24 && q[1] < MAP_H - 16);
    if (!pts.length) { anchors[Number(id)] = []; continue; }
    const step = Math.max(1, Math.floor(pts.length / 36));
    const [ox, oy] = pr([-122.22, 37.79]) ?? [0, 0];
    // prefer the upper part of the map and points far from the focal city
    anchors[Number(id)] = pts.filter((_, i) => i % step === 0)
      .sort((a, b) => (a[1] - Math.hypot(a[0] - ox, a[1] - oy) * 0.3) - (b[1] - Math.hypot(b[0] - ox, b[1] - oy) * 0.3));
  }

  // inset: the city at a scale where a contour edge crossing it can be read
  const ob = rings(geo.oakland_land as { type: string; coordinates: unknown });
  const xs = ob.map((q) => q[0]), ys = ob.map((q) => q[1]);
  const pad = 0.035;
  const iw: [[number, number], [number, number]] = [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad]];
  const ipr = conic([INSET.w, INSET.h], iw);
  const ipath = geoPath(ipr);
  const ip = (g: unknown) => ipath(g as Geom) ?? "";
  const insetContours: Record<number, string> = {};
  const insetAnchors: Record<number, Pos[]> = {};
  for (const [id, g] of Object.entries(contourData)) {
    insetContours[Number(id)] = ip(g);
    // candidate label points: contour vertices inside the inset, ordered from the frame edges inwards
    const pts = rings(g as { type: string; coordinates: unknown }).map((c) => ipr(c) as Pos)
      .filter((q) => q && q[0] > 30 && q[0] < INSET.w - 30 && q[1] > 52 && q[1] < INSET.h - 12);
    const step = Math.max(1, Math.floor(pts.length / 24));
    insetAnchors[Number(id)] = pts.filter((_, i) => i % step === 0);
  }

  const [lx, ly] = pr([-122.2, 37.78]) ?? [0, 0];
  const labelLeft = new Set(["San Francisco", "San Mateo"]);

  return {
    counties: geo.counties.map((c) => ({ geoid: c.geoid, bay: c.bay, d: p(c.geom) })),
    countyLines: geo.county_lines ? p(geo.county_lines) : "",
    oaklandLand: p(geo.oakland_land),
    oaklandLabel: [lx, ly],
    places: geo.places
      .filter((pl) => pl.name !== "Berkeley")
      .map((pl) => {
        const [x, y] = pr([pl.lon, pl.lat]) ?? [0, 0];
        return { name: pl.name, x, y, anchor: labelLeft.has(pl.name) ? "end" : "start" };
      }),
    contours,
    anchors,
    inset: {
      land: geo.counties.map((c) => ip(c.geom)).join(""),
      oakland: ip(geo.oakland_land),
      contours: insetContours,
      anchors: insetAnchors,
      scaleKm: 5,
      scalePx: kmToPx(ipr, 37.75, 5, -122.2),
    },
    scaleBar: { px: kmToPx(pr, 37.3, 20, -122.27), km: 20 },
  };
}
