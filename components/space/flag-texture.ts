import { geoEquirectangular, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from "geojson";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon as TopoMultiPolygon, Polygon as TopoPolygon, Topology } from "topojson-specification";
import { alpha2FromNumeric } from "@/lib/countries";

const FLAG_ASPECT = 3 / 2; // country-flag-icons' 3x2 set
const OCEAN = "#8fd6f5"; // flat, light, cartoon water
const LAND = "#efe2bd"; // land without a flag (disputed areas)

/** world-atlas shapes without an ISO numeric id that still have an unambiguous flag. */
const CODES_BY_NAME: Record<string, string> = { Kosovo: "XK", "Indian Ocean Ter.": "AU" };

/** Load a flag SVG as a drawable image. The files only carry a viewBox, so give them a size first. */
async function loadFlag(code: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(`/flags/${code}.svg`);
    if (!res.ok) return null;
    const svg = (await res.text()).replace("<svg ", '<svg width="513" height="342" ');
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.src = url;
    await img.decode().finally(() => URL.revokeObjectURL(url));
    return img;
  } catch {
    return null;
  }
}

function polygonsOf(geometry: Geometry): Polygon[] {
  if (geometry.type === "Polygon") return [geometry];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((coordinates: Position[][]) => ({ type: "Polygon", coordinates }));
  }
  return [];
}

/**
 * Paint a cartoon equirectangular Earth texture: flat light ocean, each country filled by its
 * flag, a soft white halo along the coasts. Every landmass of a country gets its own flag, sized
 * to cover that piece; flags are widened by 1/cos(latitude) so they read with their true
 * proportions once wrapped onto the sphere.
 */
export async function paintFlagTexture(width: number): Promise<HTMLCanvasElement> {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, width, height);

  const world = (await import("world-atlas/countries-50m.json")).default;
  const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name: string }>;
  const countries = fc.features
    .map((f: Feature<Geometry, { name: string }>) => ({
      geometry: f.geometry,
      code: alpha2FromNumeric(f.id as string | undefined) ?? CODES_BY_NAME[f.properties?.name ?? ""] ?? null,
    }))
    .filter((c): c is { geometry: Geometry; code: string } => c.code !== null && c.geometry !== null);

  const codes = [...new Set(countries.map((c) => c.code))];
  const flags = new Map(await Promise.all(codes.map(async (code) => [code, await loadFlag(code)] as const)));

  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2]);
  const path = geoPath(projection, ctx);

  // Coastal halo first (half of it is then covered by the land), then plain land underneath the flags.
  const land = merge(topology, topology.objects.countries.geometries as (TopoPolygon | TopoMultiPolygon)[]);
  ctx.beginPath();
  path(land);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = width / 700;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fillStyle = LAND;
  ctx.fill();

  for (const { geometry, code } of countries) {
    const flag = flags.get(code);
    if (!flag) continue;
    for (const polygon of polygonsOf(geometry)) {
      const [[x0, y0], [x1, y1]] = path.bounds(polygon);
      const w = x1 - x0;
      const h = y1 - y0;
      if (!(w > 0 && h > 0)) continue;
      const latitude = projection.invert?.([(x0 + x1) / 2, (y0 + y1) / 2])?.[1] ?? 0;
      const aspect = FLAG_ASPECT / Math.max(0.25, Math.cos((latitude * Math.PI) / 180));
      // Cover the piece's bounding box, centred, keeping the (corrected) flag proportions.
      const [dw, dh] = w / h > aspect ? [w, w / aspect] : [h * aspect, h];
      ctx.save();
      ctx.beginPath();
      path(polygon);
      ctx.clip();
      ctx.drawImage(flag, x0 + (w - dw) / 2, y0 + (h - dh) / 2, dw, dh);
      ctx.restore();
    }
  }

  // Thin borders keep neighbouring flags distinct.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = Math.max(1, width / 2400);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const { geometry } of countries) path(geometry);
  ctx.stroke();

  return canvas;
}
