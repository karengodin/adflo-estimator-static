import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const ENTITY_ENDPOINTS: { key: string; path: string }[] = [
  { key: "order",     path: "/server/api/entityforms/order?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2" },
  { key: "client",    path: "/server/api/entityforms/client?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2" },
  { key: "flight",    path: "/server/api/entityforms/flight?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2" },
  { key: "line_item", path: "/server/api/entityforms/line_item?all=true&datatable=true&summary=true&page=0,1000&is_template=false&sql=2" },
];

function extractForms(parsed: unknown, entityType: string): { id: string; name: string; entityType: string }[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  let arr: unknown[] = [];
  const dataObj = obj.data;
  if (dataObj && typeof dataObj === "object" && !Array.isArray(dataObj)) {
    const aaData = (dataObj as Record<string, unknown>).aaData;
    if (Array.isArray(aaData)) arr = aaData;
  }
  if (!arr.length && Array.isArray(obj.data)) arr = obj.data as unknown[];
  return arr
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      return {
        id:         String(f.id ?? "").trim(),
        name:       String(f.name ?? f.description ?? f.form_name ?? "").trim(),
        entityType,
      };
    })
    .filter((f) => f.id !== "" && f.name !== "");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const instanceId = searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });

  const { data: instance, error } = await supabaseServer
    .from("instances")
    .select("id, base_url, session_cookie")
    .eq("id", instanceId)
    .single();

  if (error || !instance) return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  if (!instance.session_cookie) return NextResponse.json({ error: "No session cookie" }, { status: 400 });

  let baseUrl = instance.base_url as string;
  if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl;
  baseUrl = baseUrl.replace(/\/+$/, "");

  let cookie: string;
  try { cookie = decryptText(instance.session_cookie as string); }
  catch { return NextResponse.json({ error: "Failed to decrypt session cookie" }, { status: 500 }); }

  const forms: { id: string; name: string; entityType: string }[] = [];

  for (const { key, path } of ENTITY_ENDPOINTS) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: { ...REQUEST_HEADERS, Cookie: cookie },
      });
      if (!res.ok) continue;
      const parsed = await res.json();
      forms.push(...extractForms(parsed, key));
    } catch {
      // skip on error, return whatever we collected
    }
  }

  return NextResponse.json({ forms });
}
