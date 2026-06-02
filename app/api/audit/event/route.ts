import { NextRequest, NextResponse } from "next/server";
import { logEvent, tryGetActor } from "../../../../lib/audit";

export async function POST(req: NextRequest) {
  const body = await req.json() as { eventType?: string; metadata?: Record<string, unknown> };
  const eventType = body.eventType;
  if (!eventType) {
    return NextResponse.json({ error: "eventType required" }, { status: 400 });
  }

  const actor = await tryGetActor(req);
  await logEvent({
    ...actor,
    eventType,
    metadata: body.metadata ?? {},
  });

  return NextResponse.json({ ok: true });
}
