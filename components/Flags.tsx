import { countryName } from "@/lib/countries";
import { languageName } from "@/lib/languages";
import { cn } from "@/lib/utils";

/**
 * A country flag (SVG from country-flag-icons, copied to /public/flags at dev/build time).
 * Images rather than emoji because Windows doesn't render flag emoji.
 */
export function Flag({
  code,
  className,
  title,
  style,
}: {
  code: string;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; next/image adds nothing here
    <img
      src={`/flags/${code}.svg`}
      alt=""
      title={title}
      style={style}
      loading="lazy"
      decoding="async"
      className={cn(
        "aspect-[3/2] rounded-[5px] object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/15",
        className,
      )}
    />
  );
}

/**
 * Countries where Prism's 15 search languages are widely spoken, ordered so neighbouring flags
 * contrast. Decorative: one flag per country, several countries for the largest languages.
 */
const COLLAGE: [country: string, language: string][] = [
  ["JP", "ja"],
  ["BR", "pt"],
  ["DE", "de"],
  ["KR", "ko"],
  ["MX", "es"],
  ["FR", "fr"],
  ["CN", "zh"],
  ["IT", "it"],
  ["SA", "ar"],
  ["UA", "uk"],
  ["GB", "en"],
  ["TR", "tr"],
  ["ID", "id"],
  ["ES", "es"],
  ["PL", "pl"],
  ["RU", "ru"],
  ["US", "en"],
  ["PT", "pt"],
  ["EG", "ar"],
  ["AR", "es"],
  ["AT", "de"],
  ["SG", "zh"],
  ["MA", "ar"],
  ["CO", "es"],
  ["BE", "fr"],
  ["AU", "en"],
  ["CH", "de"],
  ["AO", "pt"],
  ["AE", "ar"],
  ["SN", "fr"],
  ["CL", "es"],
  ["IE", "en"],
  ["CA", "fr"],
];

/** Tall, colourful collage of flags for the landing page's left margin. */
export function FlagCollage({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Prism searches research in 15 languages"
      className={cn(
        "flex flex-col overflow-hidden rounded-3xl border bg-surface p-4",
        className,
      )}
    >
      <div className="mb-5 grid grid-cols-3 gap-x-2.5 gap-y-3">
        {COLLAGE.map(([country, lang]) => (
          <Flag
            key={country}
            code={country}
            title={`${languageName(lang)} · ${countryName(country)}`}
            className="relative w-full transition-transform duration-200 hover:z-10 hover:scale-110"
          />
        ))}
      </div>
      <p className="mt-auto border-t pt-4 text-center text-xs leading-snug text-muted-foreground">
        <span className="block font-serif text-lg font-semibold text-foreground">15 languages</span>
        one question, every language
      </p>
    </aside>
  );
}
