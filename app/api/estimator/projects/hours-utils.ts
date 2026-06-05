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

  // "Requirements Documentation" and "Production Configuration" are fixed overhead
  // slices of totalHours.  Everything else is scaled proportionally from
  // hoursByCategory so the grand total equals totalHours exactly.
  const reqDocs   = r(totalHours * 0.10);
  const prodConfig = r(totalHours * 0.15);
  const remaining  = totalHours - reqDocs - prodConfig;

  const categorySum = Object.values(hoursByCategory).reduce((a, b) => a + b, 0);
  const scale = categorySum > 0 ? remaining / categorySum : 0;
  // Don't round here — let the outer r() at each allocation site do a single round.
  const h = (k: string) => (hoursByCategory[k] ?? 0) * scale;

  const result = {
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
      "Integration Configuration":         h("Integration Configuration"),
      "Financial Configuration":           h("Financial Configuration"),
      "User & Permission Setup":           h("User & Permission Setup"),
      "QA & Testing":                      r(h("QA & Testing") * 0.80),
      "UAT Support":                       h("UAT Support"),
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

  const total = Object.values(result).flatMap(Object.values).reduce((a, b) => a + b, 0);
  console.log(`[distributeHours] totalHours=${totalHours} distributed=${total} diff=${total - totalHours}`);

  return result;
}
