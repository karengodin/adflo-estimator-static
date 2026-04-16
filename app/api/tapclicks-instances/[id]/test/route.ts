import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabaseServer";
import { decryptText, encryptText } from "../../../../../lib/crypto";

function extractFormKey(html: string): string | null {
  const match = html.match(/name=["']form_key["']\s+value=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractSetCookie(headers: Headers): string[] {
  const possible =
    (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ||
    [];

  if (possible.length > 0) return possible;

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function collapseCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data: instance, error: fetchError } = await supabaseServer
    .from("instances")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  try {
    const password = decryptText(instance.encrypted_password);

    // STEP 1: GET the login page first
    const loginPageUrl = instance.base_url;

    const loginPageResponse = await fetch(loginPageUrl, {
      method: "GET",
      redirect: "manual",
    });

    const loginPageHtml = await loginPageResponse.text();
    const formKey = extractFormKey(loginPageHtml);
    const initialSetCookies = extractSetCookie(loginPageResponse.headers);
    const initialCookieHeader = collapseCookies(initialSetCookies);

    if (!formKey) {
      const snippet = loginPageHtml.slice(0, 2000);

      await supabaseServer
        .from("instances")
        .update({
          last_connected_at: new Date().toISOString(),
          last_login_status: "failed",
          last_error: "Could not find form_key on login page",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return NextResponse.json(
        {
          error: "Could not find form_key on login page",
          debug: { loginPageUrl, snippet },
        },
        { status: 400 }
      );
    }

    // STEP 2: POST credentials + form_key + initial cookies
    const body = new URLSearchParams();
    body.set("form_key", formKey);
    body.set("login[username]", instance.login_email);
    body.set("login[password]", password);

    const loginPostResponse = await fetch(loginPageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(initialCookieHeader ? { Cookie: initialCookieHeader } : {}),
      },
      body: body.toString(),
      redirect: "manual",
    });

    const loginSetCookies = extractSetCookie(loginPostResponse.headers);
    const loginCookieHeader = collapseCookies(loginSetCookies);

    const location = loginPostResponse.headers.get("location");
    const status = loginPostResponse.status;

    const success =
      !!loginCookieHeader ||
      status === 302 ||
      status === 301 ||
      (location && !location.toLowerCase().includes("login"));

    if (!success) {
      const responseText = await loginPostResponse.text();

      await supabaseServer
        .from("instances")
        .update({
          last_connected_at: new Date().toISOString(),
          last_login_status: "failed",
          last_error: `Login did not succeed. Status: ${status}. Location: ${
            location || "none"
          }.`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return NextResponse.json(
        {
          error: "Login failed",
          debug: {
            status,
            location,
            hasCookie: !!loginCookieHeader,
            responseSnippet: responseText.slice(0, 500),
          },
        },
        { status: 400 }
      );
    }

    const cookieToStore = loginCookieHeader || initialCookieHeader;

    await supabaseServer
      .from("instances")
      .update({
        session_cookie: encryptText(cookieToStore),
        last_connected_at: new Date().toISOString(),
        last_login_status: "success",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      debug: { status, location, usedCookie: !!cookieToStore },
    });
  } catch (error) {
    await supabaseServer
      .from("instances")
      .update({
        last_connected_at: new Date().toISOString(),
        last_login_status: "failed",
        last_error:
          error instanceof Error ? error.message : "Unknown login error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown login error",
      },
      { status: 500 }
    );
  }
}
