// Synthetic OpenAlex-shaped records for tests only. These are NOT real publications.
import type { OpenAlexListResponse, OpenAlexWork } from "@/lib/openalex";

export function work(overrides: Partial<OpenAlexWork> & { n: number }): OpenAlexWork {
  const { n, ...rest } = overrides;
  return {
    id: `https://openalex.org/W90000000${n}`,
    doi: `https://doi.org/10.1234/TEST.${n}`,
    title: `Synthetic test paper ${n} on drought stress in rice`,
    display_name: null,
    authorships: [{ author: { display_name: "Test Author A" } }, { author: { display_name: "Test Author B" } }],
    publication_year: 2020,
    primary_location: { landing_page_url: `https://example.org/paper/${n}`, source: { display_name: "Test Journal" } },
    best_oa_location: null,
    open_access: { is_oa: false, oa_url: null },
    abstract_inverted_index: { Drought: [0], reduces: [1], rice: [2], yield: [3] },
    language: "en",
    cited_by_count: 3,
    type: "article",
    ...rest,
  };
}

export function listResponse(works: OpenAlexWork[], count = works.length): OpenAlexListResponse {
  return { meta: { count }, results: works };
}
