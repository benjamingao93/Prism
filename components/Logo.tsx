/** Spectrum colors of the Prism mark, top ray to bottom. */
const RAYS = ["#E5484D", "#F76B15", "#FFC53D", "#30A46C", "#0090FF", "#8E4EC6"];

/**
 * Prism mark: a triangular prism splitting one beam into a spectrum — one question, every
 * language. The outline and incoming beam use `currentColor`, so the mark works on light and dark.
 */
export function LogoMark({ className }: { className?: string }) {
  // Triangle apex (50,8), base corners (7,86) and (93,86). Rays fan from where the beam meets
  // the prism to points just inside the right edge.
  const origin = { x: 35, y: 56 };
  const rightEdgeX = (y: number) => 50 + ((y - 8) * 43) / 78 - 3.2;
  return (
    <svg viewBox="0 0 100 94" className={className} role="img" aria-label="Prism logo">
      <path d="M50 8 L93 86 L7 86 Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" />
      <line x1="23.5" y1={origin.y} x2={origin.x} y2={origin.y} stroke="currentColor" strokeWidth="3.6" />
      {RAYS.map((color, i) => {
        const y = 31 + i * 9.4;
        return (
          <line
            key={color}
            x1={origin.x}
            y1={origin.y}
            x2={rightEdgeX(y)}
            y2={y}
            stroke={color}
            strokeWidth="3.2"
            strokeLinecap="butt"
          />
        );
      })}
    </svg>
  );
}

export const PRISM_TAGLINE = "One question. Every language.";

/** Mark + lowercase wordmark, matching the brand lockup. */
export function PrismLockup({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="h-8 w-auto text-[var(--brand-ink)]" />
      <span className="flex flex-col leading-none">
        <span className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--brand-ink)]">prism</span>
        {showTagline && <span className="mt-1 text-xs text-muted-foreground">{PRISM_TAGLINE}</span>}
      </span>
    </span>
  );
}
