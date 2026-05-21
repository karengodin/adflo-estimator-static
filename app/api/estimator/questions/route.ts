import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

type ConditionalLogic = {
  type: "any_answered_yes_or_nonzero" | "greater_than";
  sort_orders?: number[];
  sort_order?: number;
  value?: number;
} | null;

type DbQuestion = {
  id: number;
  cat: string;
  impl_category: string | null;
  q: string;
  trigger: string;
  weight: number;
  can_remove: boolean;
  lever_name: string | null;
  lever_desc: string | null;
  sort_order: number;
  active: boolean;
  blocker: boolean | null;
  sow: boolean | null;
  question_type: string | null;
  conditional_logic: ConditionalLogic;
  is_risk_multiplier: boolean | null;
  risk_multiplier_value: number | null;
  risk_direction: string | null;
};

function toUi(row: DbQuestion) {
  return {
    id:                   row.id,
    category:             row.cat,
    impl_category:        row.impl_category ?? null,
    question:             row.q,
    trigger:              row.trigger,
    weight:               row.weight,
    can_remove:           row.can_remove,
    lever_name:           row.lever_name ?? null,
    lever_desc:           row.lever_desc ?? null,
    display_order:        row.sort_order,
    is_active:            row.active,
    blocker:              row.blocker ?? false,
    sow:                  row.sow ?? false,
    question_type:        (row.question_type ?? "yesno") as "yesno" | "number" | "date",
    conditional_logic:    row.conditional_logic ?? null,
    is_risk_multiplier:   row.is_risk_multiplier ?? false,
    risk_multiplier_value: row.risk_multiplier_value ?? null,
    risk_direction:       row.risk_direction ?? null,
  };
}

function toDb(q: ReturnType<typeof toUi>, index: number) {
  return {
    id:                   q.id,
    cat:                  q.category,
    impl_category:        q.impl_category ?? null,
    q:                    q.question,
    trigger:              q.trigger,
    weight:               q.weight,
    can_remove:           q.can_remove,
    lever_name:           q.lever_name ?? null,
    lever_desc:           q.lever_desc ?? null,
    sort_order:           index + 1,
    active:               q.is_active,
    blocker:              q.blocker ?? false,
    sow:                  q.sow ?? false,
    question_type:        q.question_type ?? "yesno",
    conditional_logic:    q.conditional_logic ?? null,
    is_risk_multiplier:   q.is_risk_multiplier ?? false,
    risk_multiplier_value: q.risk_multiplier_value ?? null,
    risk_direction:       q.risk_direction ?? null,
  };
}

const SELECT =
  "id, cat, impl_category, q, trigger, weight, can_remove, lever_name, lever_desc, sort_order, active, blocker, sow, question_type, conditional_logic, is_risk_multiplier, risk_multiplier_value, risk_direction";

// GET — return all active questions ordered by sort_order
export async function GET() {
  const { data, error } = await supabaseServer
    .from("questions")
    .select(SELECT)
    .eq("active", true)
    .order("sort_order");

  if (error) {
    console.error("[estimator/questions] GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map((r) => toUi(r as DbQuestion)));
}

// PUT — bulk reconcile: delete removed IDs then upsert full list
export async function PUT(req: NextRequest) {
  const body = await req.json() as {
    questions: ReturnType<typeof toUi>[];
    deleteIds: number[];
  };

  const { questions, deleteIds } = body;

  if (deleteIds?.length) {
    const { error } = await supabaseServer
      .from("questions")
      .delete()
      .in("id", deleteIds);
    if (error) {
      console.error("[estimator/questions] DELETE error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (questions?.length) {
    const payload = questions.map((q, i) => toDb(q, i));
    const { error } = await supabaseServer
      .from("questions")
      .upsert(payload, { onConflict: "id" });
    if (error) {
      console.error("[estimator/questions] UPSERT error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
