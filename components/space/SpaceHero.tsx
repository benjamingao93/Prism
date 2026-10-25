"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { paintFlagTexture } from "./flag-texture";

// three.js only loads on the landing page, in the browser.
const EarthScene = dynamic(() => import("./EarthScene").then((m) => m.EarthScene), { ssr: false });

/** How long the landing takes to dissolve into the results once they arrive. */
const EXIT_MS = 320;

export type HeroPhase = "idle" | "searching" | "exiting";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Faint CSS starfield under the 3D scene (also the backdrop if WebGL is unavailable). */
const STARFIELD = [
  "radial-gradient(1px 1px at 12% 18%, #fff9, transparent)",
  "radial-gradient(1px 1px at 72% 12%, #fff8, transparent)",
  "radial-gradient(1.5px 1.5px at 38% 72%, #fff7, transparent)",
  "radial-gradient(1px 1px at 86% 58%, #fff9, transparent)",
  "radial-gradient(1px 1px at 22% 88%, #fff6, transparent)",
  "radial-gradient(1.5px 1.5px at 58% 34%, #fff8, transparent)",
  "radial-gradient(1px 1px at 92% 86%, #fff7, transparent)",
  "radial-gradient(1px 1px at 6% 52%, #fff8, transparent)",
].join(",");

/** Flat, turning flag globe for browsers without WebGL. */
function FallbackGlobe({ spinning }: { spinning: boolean }) {
  const [map, setMap] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    paintFlagTexture(2048)
      .then((canvas) => !cancelled && setMap(canvas.toDataURL("image/jpeg", 0.85)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div
      aria-hidden="true"
      className="absolute inset-[8%] rounded-full bg-[#8fd6f5]"
      style={{
        backgroundImage: map ? `url(${map})` : undefined,
        backgroundSize: "200% 100%",
        animation: `prism-globe-spin ${spinning ? 4 : 120}s linear infinite`,
        boxShadow: "inset -30px -16px 60px #0006, 0 0 60px #8fd6f566",
      }}
    />
  );
}

/**
 * Full-screen space landing: headline and search beside a 3D flag globe. While a search runs
 * (`phase` "searching") the globe spins fast; when results arrive ("exiting") the section pins
 * itself over the page and dissolves into the results beneath, then calls `onExitEnd`.
 */
export function SpaceHero({
  phase,
  onExitEnd,
  children,
}: {
  phase: HeroPhase;
  onExitEnd: () => void;
  children: ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [unsupported, setUnsupported] = useState(false);
  const onUnsupported = useCallback(() => setUnsupported(true), []);
  const slotRef = useRef<HTMLDivElement>(null);
  const exiting = phase === "exiting";
  const spinning = phase !== "idle" && !reducedMotion;
  const duration = reducedMotion ? 160 : EXIT_MS;

  // Pin the hero exactly where it sat in the page, just under the header (set before paint).
  const sectionRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    el.style.top = exiting ? `${document.querySelector("header")?.getBoundingClientRect().bottom ?? 0}px` : "";
  }, [exiting]);

  // Start the fade a couple of frames after pinning, once the results underneath have painted.
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!exiting) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setFading(true));
    });
    const timer = window.setTimeout(onExitEnd, duration + 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [exiting, duration, onExitEnd]);

  return (
    <section
      ref={sectionRef}
      aria-label="Search Prism"
      // The hero is always dark (it's space), whatever the site theme.
      className={cn(
        "dark flex flex-col overflow-hidden bg-[#04050a] text-foreground",
        exiting ? "fixed inset-x-0 bottom-0 z-30" : "relative min-h-[calc(100svh-6rem)] md:min-h-[calc(100svh-3.5rem)]",
      )}
      style={{
        backgroundImage: STARFIELD,
        opacity: fading ? 0 : 1,
        transition: exiting ? `opacity ${duration}ms ease-out` : undefined,
      }}
    >
      {!unsupported && <EarthScene spinning={spinning} slotRef={slotRef} onUnsupported={onUnsupported} />}

      <div
        inert={exiting}
        className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:py-12"
      >
        <div className="text-center lg:text-left">
          <h1 className="font-serif text-[2.25rem] leading-[1.08] font-semibold tracking-tight text-white sm:text-5xl xl:text-6xl">
            Research has no single language.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/70 sm:text-lg">
            Discover relevant scientific papers across languages with multilingual search and semantic relevance ranking.
          </p>
          <div className="mt-8 space-y-3 text-left">{children}</div>
        </div>

        {/* The globe is framed inside this box (the WebGL canvas itself spans the whole section). */}
        <div
          ref={slotRef}
          className="relative mx-auto aspect-square w-full max-w-[22rem] sm:max-w-md lg:max-w-[min(100%,calc(100svh-9rem))]"
        >
          {unsupported && <FallbackGlobe spinning={spinning} />}
        </div>
      </div>
    </section>
  );
}
