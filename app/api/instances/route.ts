import { NextResponse } from "next/server";

export interface TapClicksInstance {
  id: string;
  label: string;
  url: string;
}

export async function GET() {
  const raw = process.env.TAPCLICKS_INSTANCES ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No instances configured. Set TAPCLICKS_INSTANCES in your .env.local." },
      { status: 500 }
    );
  }

  const instances: TapClicksInstance[] = ids.map((id) => ({
    id,
    label: process.env[`TAPCLICKS_${id}_LABEL`] ?? id,
    url: process.env[`TAPCLICKS_${id}_URL`] ?? "",
  }));

  return NextResponse.json({ instances });
}
