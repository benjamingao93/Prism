"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EARTH_TEXTURE } from "./earth-texture";
import { LAUNCH_MS } from "./launch";

// three.js only loads on the landing page, in the browser.
const EarthScene = dynamic(() => import("./EarthScene").then((m) => m.EarthScene), { ssr: false });

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

/** Flat, slowly turning globe for browsers without WebGL. */
function FallbackGlobe({ launching }: { launching: boolean }) {
  return (
    <div className="absolute inset-0 flex items-end justify-center pb-[8%]" aria-hidden="true">
      <div
        className="aspect-square w-[min(58vh,78vw)] rounded-full ease-in"
        style={{
          backgroundImage: `url(${EARTH_TEXTURE})`,
          backgroundSize: "200% 100%",
          animation: "prism-globe-spin 120s linear infinite",
          boxShadow: "inset -40px -20px 80px #000c, 0 0 60px #4f8fd655",
          transform: launching ? "scale(6)" : "scale(1)",
          transition: `transform ${LAUNCH_MS}ms cubic-bezier(0.5, 0, 0.9, 0.4)`,
        }}
      />
    </div>
  );
}

/**
 * Full-screen space landing: a 3D Earth behind the headline and search. When `launching`, the
 * section pins itself over the page, the globe rushes toward the viewer, and the whole overlay
 * dissolves to reveal the results interface beneath, all within LAUNCH_MS.
 */
export function SpaceHero({
  launching,
  onLaunchEnd,
  side,
  children,
}: {
  launching: boolean;
  onLaunchEnd: () => void;
  /** Shown full height in the left margin on wide screens. */
  side?: ReactNode;
  children: ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [unsupported, setUnsupported] = useState(false);
  const onUnsupported = useCallback(() => setUnsupported(true), []);
  const duration = reducedMotion ? 160 : LAUNCH_MS;

  // Pin the hero exactly where it sat in the page, just under the header (set before paint).
  const sectionRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    el.style.top = launching ? `${document.querySelector("header")?.getBoundingClientRect().bottom ?? 0}px` : "";
  }, [launching]);

  useEffect(() => {
    if (!launching) return;
    const timer = window.setTimeout(onLaunchEnd, duration);
    return () => window.clearTimeout(timer);
  }, [launching, duration, onLaunchEnd]);

  return (
    <section
      ref={sectionRef}
      aria-label="Search Prism"
      // The hero is always dark (it's space), whatever the site theme.
      className={cn(
        "dark overflow-hidden bg-[#04050a] text-foreground",
        launching
          ? "fixed inset-x-0 bottom-0 z-30"
          : "relative h-[calc(100svh-6rem)] min-h-[620px] md:h-[calc(100svh-3.5rem)]",
      )}
      style={{
        backgroundImage: STARFIELD,
        opacity: launching ? 0 : 1,
        // Hold the scene while the globe rushes in, then dissolve into the results.
        transition: launching
          ? `opacity ${Math.round(duration * 0.5)}ms ease-in ${Math.round(duration * 0.5)}ms`
          : undefined,
      }}
    >
      {unsupported ? (
        <FallbackGlobe launching={launching && !reducedMotion} />
      ) : (
        <EarthScene launching={launching && !reducedMotion} onUnsupported={onUnsupported} />
      )}

      {/* Keep the text legible over the globe. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_8%,#04050acc_0%,#04050a66_38%,transparent_62%)]"
      />

      {side && (
        <div
          inert={launching}
          className={cn(
            "absolute top-[6vh] bottom-[6vh] left-6 z-10 hidden w-48 transition-opacity duration-150 xl:block 2xl:left-12",
            launching && "opacity-0",
          )}
        >
          {side}
        </div>
      )}

      <div
        inert={launching}
        className={cn(
          "relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center px-4 pt-[9vh] text-center sm:px-6",
          "transition-[opacity,transform,filter] duration-150 ease-out",
          launching && "scale-[0.97] opacity-0 blur-[2px]",
        )}
      >
        <h1 className="font-serif text-[2.25rem] leading-[1.08] font-semibold tracking-tight text-white sm:text-6xl">
          Research has no single language.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
          Discover relevant scientific papers across languages with multilingual search and semantic relevance ranking.
        </p>
        <div className="mt-8 w-full max-w-2xl space-y-3 text-left">{children}</div>
      </div>
    </section>
  );
}
