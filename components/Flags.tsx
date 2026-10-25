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
