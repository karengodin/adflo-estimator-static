import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { decryptText } from "../../../../lib/crypto";

const COMMON_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    instanceId: string;
    taskFormId: string;
    newParentFormId: string | null;
    newParentFormName: string | null;
    parentEntityType: string | null;
  };

  const { instanceId, taskFormId, newParentFormId, newParentFormName, parentEntityType } = body;

  console.log("[assign-parent] Received body:", JSON.stringify({
    instanceId: instanceId ?? null,
    taskFormId: taskFormId ?? null,
    newParentFormId: newParentFormId ?? null,
    newParentFormName: newParentFormName ?? null,
    parentEntityType: parentEntityType ?? null,
  }));

  if (!instanceId || !taskFormId) {
    console.error("[assign-parent] Validation failed — instanceId:", instanceId, "taskFormId:", taskFormId);
    return NextResponse.json({
      error: `Missing required fields: instanceId=${instanceId ?? "null"}, taskFormId=${taskFormId ?? "null"}`,
    }, { status: 400 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const { data: instance, error: instanceErr } = await supabaseServer
    .from("instances")
    .select("id, name, base_url, session_cookie")
    .eq("id", instanceId)
    .single();

  if (instanceErr || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (!instance.session_cookie) {
    return NextResponse.json({ error: "No session cookie stored. Refresh it on the Instances page." }, { status: 400 });
  }

  let cookie: string;
  try { cookie = decryptText(instance.session_cookie); }
  catch { return NextResponse.json({ error: "Failed to decrypt session cookie." }, { status: 500 }); }

  const base = (instance.base_url.startsWith("http") ? instance.base_url : "https://" + instance.base_url).replace(/\/+$/, "");

  const getHeaders: Record<string, string> = {
    ...COMMON_HEADERS,
    Cookie: cookie,
  };

  const ranAt = new Date().toISOString();

  // ── 1. GET current form model ─────────────────────────────────────────────

  const getUrl = `${base}/server/api/entityforms/task/${encodeURIComponent(taskFormId)}?all=true&entities_in_use=min`;
  console.log(`[assign-parent] GET ${getUrl}`);

  let formModel: Record<string, unknown>;
  try {
    const getRes = await fetch(getUrl, { headers: getHeaders });
    if (!getRes.ok) {
      const text = await getRes.text();
      console.error(`[assign-parent] GET failed HTTP ${getRes.status}:`, text.slice(0, 300));
      return NextResponse.json({ error: `Failed to fetch task form: HTTP ${getRes.status}`, snippet: text.slice(0, 300) }, { status: 502 });
    }
    const raw = await getRes.json();
    if (raw?.state === "login") {
      return NextResponse.json({ error: "Session expired. Refresh the cookie on the Instances page." }, { status: 401 });
    }
    // Response may be the form object directly or wrapped in { data: ... }
    formModel = (raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data))
      ? (raw.data as Record<string, unknown>)
      : (raw as Record<string, unknown>);
    console.log(`[assign-parent] Fetched form "${formModel.name}" (id=${formModel.id}), current parent_form_id=${JSON.stringify(formModel.parent_form_id)}`);
  } catch (e) {
    console.error("[assign-parent] GET threw:", e);
    return NextResponse.json({ error: `Network error fetching task form: ${String(e).slice(0, 200)}` }, { status: 502 });
  }

  const taskFormName    = String(formModel.name ?? formModel.label ?? taskFormId);
  const previousParentId   = formModel.parent_form_id ? String((formModel.parent_form_id as Record<string, unknown>)?.id ?? formModel.parent_form_id) : null;
  const previousParentName = formModel.parent_form_name ? String((formModel.parent_form_name as Record<string, unknown>)?.name ?? formModel.parent_form_name) : null;

  // ── 2. Mutate model ───────────────────────────────────────────────────────

  const updatedModel = { ...formModel };
  updatedModel.parent_form_id = newParentFormId ?? null;
  if (newParentFormName) {
    updatedModel.parent_form_name = {
      id:             newParentFormId,
      name:           newParentFormName,
      entity_type:    parentEntityType ?? "order",
      parent_form_id: null,
    };
  } else {
    updatedModel.parent_form_name = null;
  }

  // ── 3. 200ms delay (matches AppScript behaviour) ──────────────────────────

  await sleep(200);

  // ── 4. POST updated model as form-encoded body ────────────────────────────

  const postUrl = `${base}/server/api/entityforms/task/${encodeURIComponent(taskFormId)}`;
  const postHeaders: Record<string, string> = {
    ...COMMON_HEADERS,
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const formBody = new URLSearchParams({ model: JSON.stringify(updatedModel) });

  console.log(`[assign-parent] POST ${postUrl} — form-encoded, parent_form_id=${newParentFormId}`);
  console.log(`[assign-parent] model.parent_form_id=${updatedModel.parent_form_id}, model.parent_form_name=${JSON.stringify(updatedModel.parent_form_name)}`);

  let saveHttpCode: number;
  let saveSnippet: string;

  try {
    const postRes = await fetch(postUrl, {
      method: "POST",
      headers: postHeaders,
      body: formBody.toString(),
    });
    saveHttpCode = postRes.status;
    const postText = await postRes.text();
    saveSnippet = postText.slice(0, 500);
    console.log(`[assign-parent] POST → HTTP ${saveHttpCode}:`, saveSnippet.slice(0, 300));

    if (!postRes.ok) {
      await persistResult(instanceId, taskFormId, taskFormName, "error", saveHttpCode, saveSnippet, ranAt);
      return NextResponse.json({
        success: false,
        taskFormId,
        taskFormName,
        previousParentId,
        previousParentName,
        newParentFormId,
        newParentFormName,
        snippet: saveSnippet,
        error: `Save returned HTTP ${saveHttpCode}`,
      }, { status: 502 });
    }

    let parsed: unknown;
    try { parsed = JSON.parse(postText); } catch { parsed = null; }
    if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).state === "login") {
      return NextResponse.json({ error: "Session expired during save. Refresh the cookie." }, { status: 401 });
    }
  } catch (e) {
    console.error("[assign-parent] POST threw:", e);
    await persistResult(instanceId, taskFormId, taskFormName, "error", 0, String(e).slice(0, 300), ranAt);
    return NextResponse.json({ error: `Network error saving task form: ${String(e).slice(0, 200)}` }, { status: 502 });
  }

  // ── 5. 200ms delay then GET to verify ────────────────────────────────────

  await sleep(200);

  let verifiedParentId: string | null = null;
  let verifiedParentName: string | null = null;
  try {
    const verifyRes = await fetch(getUrl, { headers: getHeaders });
    if (verifyRes.ok) {
      const raw = await verifyRes.json();
      const verified = (raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data))
        ? (raw.data as Record<string, unknown>)
        : (raw as Record<string, unknown>);
      const vParent = verified.parent_form_id;
      verifiedParentId   = vParent ? String((vParent as Record<string, unknown>)?.id ?? vParent) : null;
      const vName = verified.parent_form_name;
      verifiedParentName = vName ? String((vName as Record<string, unknown>)?.name ?? vName) : null;
      console.log(`[assign-parent] Verified: parent_form_id=${verifiedParentId} parent_form_name=${verifiedParentName}`);
    }
  } catch {
    console.warn("[assign-parent] Verification GET failed (non-fatal)");
  }

  const success = verifiedParentId === String(newParentFormId) || saveHttpCode < 300;
  const status  = success ? "success" : "error";
  const snippet = success
    ? `Parent set to "${newParentFormName ?? newParentFormId}" (verified: "${verifiedParentName ?? verifiedParentId}")`
    : `Save appeared to succeed (HTTP ${saveHttpCode}) but verification shows parent_form_id=${verifiedParentId}`;

  // ── 6. Persist to migration_runs ──────────────────────────────────────────

  await persistResult(instanceId, taskFormId, taskFormName, status, saveHttpCode, snippet, ranAt);

  return NextResponse.json({
    success,
    taskFormId,
    taskFormName,
    previousParentId,
    previousParentName,
    newParentFormId,
    newParentFormName,
    verifiedParentId,
    verifiedParentName,
    snippet,
  });
}

async function persistResult(
  instanceId: string,
  itemId: string,
  itemName: string,
  status: string,
  httpCode: number,
  snippet: string,
  ranAt: string,
) {
  const { error } = await supabaseServer.from("migration_runs").insert({
    instance_id:  instanceId,
    entity_type:  "task_form_parent",
    item_id:      itemId,
    item_name:    itemName,
    status,
    http_code:    httpCode,
    snippet:      snippet.slice(0, 500),
    request_url:  "",
    run_at:       ranAt,
    is_retry:     false,
  });
  if (error) console.error("[assign-parent] persistResult failed:", error.message);
}
