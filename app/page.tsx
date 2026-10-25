import { Suspense } from "react";
import { SearchExperience } from "@/components/SearchExperience";

export default function Home() {
  // SearchExperience reads the URL (useSearchParams), which requires a Suspense boundary.
  return (
    <Suspense>
      <SearchExperience />
    </Suspense>
  );
}
