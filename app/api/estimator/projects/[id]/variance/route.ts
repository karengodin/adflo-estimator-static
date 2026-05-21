import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../lib/supabaseServer";

export type VarianceRow = {
  category: string;
  estimated_hours: number;
  actual_hours: number;
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data, error } = await supabaseServer
    .from("hours_summary")
    .select("category, estimated_hours, actual_hours")
    .eq("project_id", id)
    .order("category");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // GROUP BY category — sum estimated and actual across all phases
  const grouped: Record<string, VarianceRow> = {};
  for (const row of data ?? []) {
    if (!grouped[row.category]) {
      grouped[row.category] = { category: row.category, estimated_hours: 0, actual_hours: 0 };
    }
    grouped[row.category].estimated_hours += row.estimated_hours ?? 0;
    grouped[row.category].actual_hours    += row.actual_hours    ?? 0;
  }

  const result: VarianceRow[] = Object.values(grouped).sort((a, b) =>
    a.category.localeCompare(b.category)
  );

  return NextResponse.json(result);
}
