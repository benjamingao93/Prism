"use client";

import { geoEqualEarth, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { ArrowLeft, Globe2, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { Button } from "@/components/ui/button";
import { alpha2FromNumeric, countByCountry, countryName } from "@/lib/countries";
import { sortByMode } from "@/lib/ranking";
import { cn } from "@/lib/utils";
import { useAppState } from "./AppState";
import { MODE_LABELS } from "./RankingInfo";

const WIDTH = 960;
const HEIGHT = 470;

interface Shape {
  key: string;
  code: string | null;
  name: string;
  d: string;
}

/** Country outlines, projected once (Equal Earth keeps areas comparable). Antarctica omitted. */
const SHAPES: Shape[] = (() => {
  const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name: string }>;
  const features = fc.features.filter((f) => f.properties?.name !== "Antarctica");
  const projection = geoEqualEarth().fitExtent(
    [
      [4, 4],
      [WIDTH - 4, HEIGHT - 4],
    ],
    { type: "FeatureCollection", features } as FeatureCollection,
  );
  const path = geoPath(projection);
  return features.map((f: Feature<Geometry, { name: string }>, i) => ({
    key: `${f.id ?? "x"}-${i}`,
    code: alpha2FromNumeric(f.id as string | undefined),
    name: f.properties?.name ?? "",
    d: path(f) ?? "",
  }));
})();

/** 0–1 intensity. Square root keeps countries with a few papers visible next to the leader. */
function intensity(count: number, max: number): number {
  return max > 0 && count > 0 ? Math.sqrt(count / max) : 0;
}

function fillFor(t: number): string {
  if (t <= 0) return "var(--secondary)";
  return `color-mix(in oklch, var(--accent-blue) ${Math.round(18 + 82 * t)}%, var(--surface))`;
}

export function PublicationMap() {
  const { hydrated, lastSearch } = useAppState();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ code: string | null; name: string; x: number; y: number } | null>(null);

  const data = useMemo(() => {
    if (!lastSearch) return null;
    const { response, mode } = lastSearch;
    const top = sortByMode(response.papers, mode).slice(0, response.filters.limit);
    const { countries, unknown } = countByCountry(top);
    return {
      response,
      mode,
      total: top.length,
      known: top.length - unknown,
      unknown,
      countries,
      byCode: new Map(countries.map((c) => [c.code, c.count])),
      max: countries[0]?.count ?? 0,
    };
  }, [lastSearch]);

  if (!hydrated) {
    return <div className="mx-auto h-[60vh] max-w-6xl animate-pulse px-4 sm:px-6" aria-busy="true" />;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <Globe2 className="mx-auto mb-4 size-10 text-muted-foreground/60" aria-hidden="true" />
        <h1 className="font-serif text-2xl font-semibold">No search to map yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The map shows where the results of your latest search were published. Run a search, then come back here.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Go to Search</Link>
        </Button>
      </div>
    );
  }

  const { response, mode, total, known, unknown, countries, byCode, max } = data;
  const goTo = (code: string) => router.push(`/?q=${encodeURIComponent(response.query)}&country=${code}`);

  const onMove = (e: React.MouseEvent, shape: Shape) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ code: shape.code, name: shape.code ? countryName(shape.code) : shape.name, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const hoverCount = hover?.code ? (byCode.get(hover.code) ?? 0) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Where these papers were published</p>
          <h1 className="font-serif text-xl leading-snug font-semibold sm:text-2xl" lang={response.queryLanguage}>
            {response.query}
          </h1>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            Top {total} results · {known} with a known publication country · ranked by {MODE_LABELS[mode].toLowerCase()} relevance
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <Link href={`/?q=${encodeURIComponent(response.query)}`}>
            <ArrowLeft aria-hidden="true" /> Back to results
          </Link>
        </Button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-label="World map of publication countries" className="min-w-0 self-start rounded-lg border bg-surface p-3 sm:p-4">
          {known === 0 ? (
            <p className="py-24 text-center text-sm text-muted-foreground">
              OpenAlex records no publication country for these results.
            </p>
          ) : (
            <>
              <div ref={containerRef} className="relative" onMouseLeave={() => setHover(null)}>
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="group" aria-label="Countries shaded by number of papers">
                  {SHAPES.map((shape) => {
                    const count = shape.code ? (byCode.get(shape.code) ?? 0) : 0;
                    const t = intensity(count, max);
                    const active = hover?.code != null && hover.code === shape.code;
                    return (
                      <path
                        key={shape.key}
                        d={shape.d}
                        fill={fillFor(t)}
                        stroke={count > 0 ? "var(--brand-ink)" : "var(--border)"}
                        strokeOpacity={count > 0 ? 0.35 + 0.65 * t : 1}
                        strokeWidth={active ? 2.2 : count > 0 ? 0.5 + 1.4 * t : 0.5}
                        strokeLinejoin="round"
                        className={cn("transition-[stroke-width] duration-100", count > 0 && "cursor-pointer outline-none focus-visible:stroke-[var(--ring)]")}
                        onMouseMove={(e) => onMove(e, shape)}
                        onClick={count > 0 && shape.code ? () => goTo(shape.code!) : undefined}
                        tabIndex={count > 0 ? 0 : undefined}
                        role={count > 0 ? "button" : undefined}
                        aria-label={count > 0 && shape.code ? `${countryName(shape.code)}: ${count} papers. Show them in search.` : undefined}
                        onKeyDown={
                          count > 0 && shape.code
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  goTo(shape.code!);
                                }
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </svg>
                {hover && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute z-10 w-max max-w-[16rem] -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
                    style={{ left: hover.x, top: hover.y - 10 }}
                  >
                    <p className="font-medium">{hover.name}</p>
                    {hoverCount > 0 ? (
                      <>
                        <p className="tabular text-muted-foreground">
                          {hoverCount} {hoverCount === 1 ? "paper" : "papers"} · {Math.round((100 * hoverCount) / known)}% of those with a known
                          country
                        </p>
                        <p className="mt-0.5 text-accent-blue">Click to see them in Search</p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">No papers in these results</p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Fewer</span>
                <span
                  aria-hidden="true"
                  className="h-2 w-40 rounded-full"
                  style={{ background: `linear-gradient(to right, ${fillFor(0.05)}, ${fillFor(1)})` }}
                />
                <span>
                  More (<span className="tabular">{max}</span> max)
                </span>
                <span className="ml-auto">Small countries may be too small to see; they are listed alongside.</span>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-3">
          <section aria-labelledby="countries-title" className="rounded-lg border bg-surface p-4">
            <h2 id="countries-title" className="font-serif text-base font-semibold">
              Publication countries
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">Select a country to filter your results.</p>
            <ul className="space-y-1">
              {countries.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => goTo(c.code)}
                    onMouseEnter={() => setHover(null)}
                    className="grid w-full grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {countryName(c.code)}
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${(c.count / max) * 100}%` }} />
                    </span>
                    <span className="tabular w-6 text-right text-muted-foreground">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
            {unknown > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {unknown} {unknown === 1 ? "paper has" : "papers have"} no recorded publication country.
              </p>
            )}
          </section>
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Country is that of the venue (journal, repository or publisher) as recorded by OpenAlex, not the authors’ location or
            the paper’s language. Journals of large international publishers are registered in a few countries, such as Elsevier
            in the Netherlands or UK, so those countries can stand out.
          </p>
        </aside>
      </div>
    </div>
  );
}
