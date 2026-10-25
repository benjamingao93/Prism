"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Languages } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QUERY_LANGUAGE_OPTIONS } from "@/lib/languages";
import type { QueryLanguage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppState } from "./AppState";
import { PrismLockup } from "./Logo";
import { ReadingList } from "./ReadingList";

const NAV = [
  { href: "/", label: "Search" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { queryLanguage, setQueryLanguage } = useAppState();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Prism home" className="flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <PrismLockup />
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                pathname === item.href && "text-foreground font-medium",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Select value={queryLanguage} onValueChange={(v) => setQueryLanguage(v as QueryLanguage)}>
            <SelectTrigger size="sm" aria-label="Query language" className="h-8 gap-1.5 bg-surface text-sm">
              <Languages className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">Query in</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {QUERY_LANGUAGE_OPTIONS.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label}
                  {l.native !== l.label && <span className="text-muted-foreground"> · {l.native}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ReadingList />
        </div>
      </div>
      <nav aria-label="Main mobile" className="flex gap-1 border-t px-4 py-1.5 md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-[13px] text-muted-foreground",
              pathname === item.href && "bg-secondary font-medium text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
