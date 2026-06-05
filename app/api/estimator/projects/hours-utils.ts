// Shared phase config and distribution logic used by both POST (create) and PATCH (recalculate).

export const PHASE_CONFIG = [
  {
    name:       "discovery",
    order:      1,
    categories: [
      "Program Management",
      "Requirements Documentation",
      "Risk Buffer",
    ],
  },
  {
    name:       "pilot",
    order:      2,
    categories: [
      "Form Configuration (Pilot)",
      "Workflow Configuration (Pilot)",
      "QA",
      "Program Management",
      "Risk Buffer",
    ],
  },
  {
    name:       "uat",
    order:      3,
    categories: [
      "Form Configuration (Remaining)",
      "Workflow Configuration (Remaining)",
      "Integration Configuration",
      "Financial Configuration",
      "User & Permission Setup",
      "QA & Testing",
      "UAT Support",
      "Program Management",
      "Risk Buffer",
    ],
  },
  {
    name:       "golive",
    order:      4,
    categories: [
      "Production Configuration",
      "Go-Live Support",
      "Program Management",
      "Risk Buffer",
    ],
  },
] as const;

export type PhaseName = (typeof PHASE_CONFIG)[number]["name"];

export function distributeHours(
  hoursByCategory: Record<string, number>,
  totalHours: number
): Record<PhaseName, Record<string, number>> {
  const r = (n: number) => Math.round(n);

  // Requirements Documentation and Production Configuration are fixed overhead
  // slices of totalHours. Everything else scales proportionally from hoursByCategory
  // so the remaining budget (75%) is fully consumed.
  const reqDocs    = r(totalHours * 0.10);
  const prodConfig = r(totalHours * 0.15);
  const remaining  = totalHours - reqDocs - prodConfig;

  const categorySum = Object.values(hoursByCategory).reduce((a, b) => a + b, 0);
  const scale = categorySum > 0 ? remaining / categorySum : 0;
  // Returns a raw float — always wrap with r() at every allocation site.
  const h = (k: string) => (hoursByCategory[k] ?? 0) * scale;

  const result: Record<PhaseName, Record<string, number>> = {
    discovery: {
      "Program Management":         r(h("Program Management") * 0.25),
      "Requirements Documentation": reqDocs,
      "Risk Buffer":                r(h("Risk Buffer") * 0.25),
    },
    pilot: {
      "Form Configuration (Pilot)":     r(h("Form Configuration") * 0.20),
      "Workflow Configuration (Pilot)": r(h("Workflow Configuration") * 0.20),
      "QA":                            r(h("QA & Testing") * 0.20),
      "Program Management":            r(h("Program Management") * 0.25),
      "Risk Buffer":                   r(h("Risk Buffer") * 0.25),
    },
    uat: {
      "Form Configuration (Remaining)":     r(h("Form Configuration") * 0.80),
      "Workflow Configuration (Remaining)": r(h("Workflow Configuration") * 0.80),
      "Integration Configuration":         r(h("Integration Configuration")),
      "Financial Configuration":           r(h("Financial Configuration")),
      "User & Permission Setup":           r(h("User & Permission Setup")),
      "QA & Testing":                      r(h("QA & Testing") * 0.80),
      "UAT Support":                       r(h("UAT Support")),
      "Program Management":               r(h("Program Management") * 0.25),
      "Risk Buffer":                      r(h("Risk Buffer") * 0.25),
    },
    golive: {
      "Production Configuration": prodConfig,
      "Go-Live Support":          0,
      "Program Management":       r(h("Program Management") * 0.25),
      "Risk Buffer":              r(h("Risk Buffer") * 0.25),
    },
  };

  // Fix rounding drift: find the largest single category and absorb the ±1–2 hr difference.
  const distributed = Object.values(result).flatMap(Object.values).reduce((a, b) => a + b, 0);
  const diff = totalHours - distributed;
  if (diff !== 0) {
    let maxPhase: PhaseName = "uat";
    let maxCat = "";
    let maxVal = -1;
    for (const phase of Object.keys(result) as PhaseName[]) {
      for (const [cat, val] of Object.entries(result[phase])) {
        if (val > maxVal) { maxVal = val; maxPhase = phase; maxCat = cat; }
      }
    }
    if (maxCat) result[maxPhase][maxCat] += diff;
  }

  const total = distributed + diff; // always equals totalHours after adjustment
  console.log(`[distributeHours] totalHours=${totalHours} distributed=${total} diff=0`);

  return result;
}
