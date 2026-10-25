import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AppStateProvider } from "@/components/AppState";
import { LogoMark, PRISM_TAGLINE } from "@/components/Logo";
import { SiteHeader } from "@/components/SiteHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});
const serif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Prism — One question. Every language.",
  description:
    "Prism finds relevant scientific papers across 18 languages with multilingual search and semantic relevance ranking.",
  applicationName: "Prism",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // next-themes sets the theme class on <html> before hydration, so React must not warn about it.
    <html
      lang="en"
      className={`${inter.variable} ${serif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="prism:theme"
          disableTransitionOnChange
        >
          <AppStateProvider>
            <TooltipProvider delayDuration={200}>
              <SiteHeader />
              <main className="flex-1">{children}</main>
              <footer className="border-t py-6 text-xs text-muted-foreground">
                <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 sm:flex-row sm:justify-between sm:px-6">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <LogoMark className="h-4 w-auto text-[var(--brand-ink)]" />
                    <span className="font-semibold tracking-[-0.02em]">
                      prism
                    </span>
                    <span className="text-muted-foreground">
                      · {PRISM_TAGLINE}
                    </span>
                  </span>
                  <span>
                    Metadata from{" "}
                    <a
                      href="https://openalex.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      OpenAlex
                    </a>{" "}
                    (CC0). Not an exhaustive index of scientific literature.
                  </span>
                  <span>
                    Machine translations and summaries are labeled and may
                    contain errors.
                  </span>
                </div>
              </footer>
            </TooltipProvider>
          </AppStateProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
