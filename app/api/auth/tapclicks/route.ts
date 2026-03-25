import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { instanceId } = await req.json();

  if (!instanceId) {
    return NextResponse.json({ error: "Missing instanceId." }, { status: 400 });
  }

  const prefix = instanceId.toUpperCase();
  const instanceUrl = process.env[`TAPCLICKS_${prefix}_URL`];
  const email = process.env[`TAPCLICKS_${prefix}_EMAIL`];
  const password = process.env[`TAPCLICKS_${prefix}_PASSWORD`];

  if (!instanceUrl || !email || !password) {
    return NextResponse.json(
      { error: `No credentials configured for instance "${instanceId}". Check your .env.local.` },
      { status: 500 }
    );
  }

  const loginUrl = `${instanceUrl.replace(/\/+$/, "")}/app/dash/session/login`;

  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        recaptcha: "",
        hipaa_acknowledgement: "no",
      }),
      redirect: "manual",
    });

    // Accept 200 or 3xx redirects — TapClicks may redirect after login
    const setCookie = response.headers.get("set-cookie");

    if (!setCookie) {
      const body = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Login to ${instanceId} failed — no Set-Cookie returned. HTTP ${response.status}.`,
          detail: body.slice(0, 300),
        },
        { status: 401 }
      );
    }

    // Extract just the cookie values (strip attributes like Path, HttpOnly, etc.)
    const cookieValue = setCookie
      .split(",")
      .map((part) => part.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    return NextResponse.json({ cookie: cookieValue, instanceUrl: instanceUrl.replace(/\/+$/, "") });
  } catch (err) {
    return NextResponse.json(
      { error: `Network error logging into ${instanceId}: ${String(err)}` },
      { status: 500 }
    );
  }
}
