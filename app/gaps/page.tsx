import type { Metadata } from "next";
import { LanguageGaps } from "@/components/LanguageGaps";

export const metadata: Metadata = { title: "Language gaps — Prism" };

export default function GapsPage() {
  return <LanguageGaps />;
}
