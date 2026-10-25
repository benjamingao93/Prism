import type { Metadata } from "next";
import { PublicationMap } from "@/components/PublicationMap";

export const metadata: Metadata = { title: "Map — Prism" };

export default function MapPage() {
  return <PublicationMap />;
}
