import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { AppStateProvider } from "@/components/AppState";
import { SiteHeader } from "@/components/SiteHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Babel Scholar — multilingual research search",
  description:
    "Discover relevant scientific papers across languages with multilingual search and semantic relevance ranking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppStateProvider>
          <TooltipProvider delayDuration={200}>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <footer className="border-t py-6 text-xs text-muted-foreground">
              <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 sm:flex-row sm:justify-between sm:px-6">
                <span>
                  Metadata from{" "}
                  <a href="https://openalex.org" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    OpenAlex
                  </a>{" "}
                  (CC0). Not an exhaustive index of scientific literature.
                </span>
                <span>Machine translations and summaries are labeled and may contain errors.</span>
              </div>
            </footer>
          </TooltipProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
