/** Babel Scholar mark: three offset script tiles (Latin, Han, Kana) stacked like a tower. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="2" y="15" width="16" height="15" rx="2.5" fill="var(--accent-blue)" />
      <rect x="9" y="8.5" width="15" height="14" rx="2.5" fill="var(--surface)" stroke="var(--foreground)" strokeWidth="1.6" />
      <rect x="15" y="2" width="15" height="14" rx="2.5" fill="var(--foreground)" />
      <text x="10" y="27" fontSize="9" fontWeight="700" fill="white" textAnchor="middle" fontFamily="Georgia, serif">
        A
      </text>
      <text x="16.5" y="19.5" fontSize="8.5" fontWeight="600" fill="var(--foreground)" textAnchor="middle">
        文
      </text>
      <text x="22.5" y="12.5" fontSize="8" fontWeight="600" fill="white" textAnchor="middle">
        あ
      </text>
    </svg>
  );
}
