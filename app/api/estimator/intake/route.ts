import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { Resend } from "resend";
import { supabaseServer } from "../../../../lib/supabaseServer";

type DbQuestion = {
  id: number;
  cat: string;
  q: string;
  trigger: string;
  weight: number;
  question_type: string;
};

const tiers = [
  { name: "Enterprise", min: 201 },
  { name: "Gold",       min: 121 },
  { name: "Silver",     min:  61 },
  { name: "Bronze",     min:   0 },
];

const tierColor: Record<string, string> = {
  Enterprise: "#2f6fed", Gold: "#9a6b00", Silver: "#475569", Bronze: "#a8611a",
};
const tierBg: Record<string, string> = {
  Enterprise: "#eaf1ff", Gold: "#fff7db", Silver: "#f1f5f9", Bronze: "#fdf1e5",
};

// ── Email builder ─────────────────────────────────────────────────────────────

function buildEmailHtml(p: {
  companyName: string;
  contactName: string;
  tier: string;
  estimatedHours: number;
  currentProcess: string;
  painPoints: string;
  additionalContext: string;
  yesAnswersByCategory: Record<string, string[]>;
  shareUrl: string;
}): string {
  const tc = tierColor[p.tier] ?? "#2f6fed";
  const tb = tierBg[p.tier]    ?? "#eaf1ff";

  const freeTextRows = [
    p.currentProcess    && { label: "Current Process",          body: p.currentProcess },
    p.painPoints        && { label: "Pain Points & Challenges", body: p.painPoints },
    p.additionalContext && { label: "Additional Context",       body: p.additionalContext },
  ].filter(Boolean) as { label: string; body: string }[];

  const freeTextHtml = freeTextRows.map(({ label, body }) => `
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8a9bb0;margin-bottom:8px;">${label}</div>
      <div style="padding:12px 16px;background:#f8fafc;border:1px solid #e8edf5;border-radius:8px;font-size:14px;color:#455468;line-height:1.65;">${body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g,"<br>")}</div>
    </div>`).join("");

  const categoryEntries = Object.entries(p.yesAnswersByCategory).filter(([, qs]) => qs.length > 0);
  const scopeHtml = categoryEntries.map(([cat, qs]) => `
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8a9bb0;margin-bottom:8px;">${cat}</div>
      ${qs.map(q => `<div style="padding:9px 13px;background:#f8fafc;border:1px solid #e8edf5;border-left:3px solid #4fbf9f;border-radius:0 8px 8px 0;margin-bottom:6px;font-size:13.5px;color:#18212b;line-height:1.5;">✓ ${q.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div>`).join("")}
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AdFlo Implementation Assessment — ${p.companyName}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f9;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#0f1623;border-radius:14px 14px 0 0;padding:28px 32px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:11px;vertical-align:middle;">
            <div style="width:38px;height:38px;background:linear-gradient(135deg,#2f6fed,#4fbf9f);border-radius:10px;text-align:center;line-height:38px;font-weight:800;color:#fff;font-size:15px;">af</div>
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:-0.02em;">AdFlo</span>
          </td>
        </tr></table>
        <div style="margin-top:18px;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">Assessment Received</div>
        <div style="margin-top:5px;font-size:13.5px;color:rgba(255,255,255,0.5);">${p.companyName} &middot; Implementation Assessment</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#fff;padding:32px;">

        <p style="margin:0 0 24px;font-size:15px;color:#455468;line-height:1.75;">
          Hi ${p.contactName},<br><br>
          Thank you for completing your AdFlo Implementation Assessment. We&rsquo;ve received your submission and your AdFlo implementation team will review your answers and be in touch within <strong style="color:#0f1623;">2 business days</strong>.
        </p>

        <!-- Estimate -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr><td style="background:${tb};border:1px solid ${tc}33;border-radius:12px;padding:18px 22px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${tc};margin-bottom:12px;">Preliminary Estimate</div>
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:32px;vertical-align:top;">
                <div style="font-size:34px;font-weight:800;color:${tc};letter-spacing:-0.04em;line-height:1;">${p.estimatedHours}</div>
                <div style="font-size:12px;color:#627286;margin-top:4px;">estimated hours</div>
              </td>
              <td style="vertical-align:top;">
                <div style="display:inline-block;padding:5px 14px;background:#fff;border:1px solid ${tc}55;border-radius:999px;font-size:13px;font-weight:700;color:${tc};">&#9679; ${p.tier}</div>
                <div style="font-size:12px;color:#627286;margin-top:6px;">implementation tier</div>
              </td>
            </tr></table>
            <div style="margin-top:12px;font-size:12px;color:#8a9bb0;font-style:italic;">This is a preliminary estimate based on your responses. Your team will finalize scope during discovery.</div>
          </td></tr>
        </table>

        ${freeTextHtml ? `
        <div style="margin-bottom:28px;">
          <div style="font-size:16px;font-weight:700;color:#0f1623;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #edf2f7;">Your Responses</div>
          ${freeTextHtml}
        </div>` : ""}

        ${scopeHtml ? `
        <div style="margin-bottom:28px;">
          <div style="font-size:16px;font-weight:700;color:#0f1623;margin-bottom:4px;">Scope Indicators</div>
          <div style="font-size:13px;color:#8a9bb0;margin-bottom:14px;">Areas where you indicated &ldquo;Yes&rdquo; — these shape your implementation scope.</div>
          ${scopeHtml}
        </div>` : ""}

        <!-- Edit link -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td style="background:#f8fafc;border:1px solid #dde5ef;border-radius:10px;padding:13px 17px;">
            <span style="font-size:13.5px;color:#455468;">Need to update your answers? </span>
            <a href="${p.shareUrl}" style="color:#2f6fed;font-weight:600;text-decoration:none;">Edit your assessment &rarr;</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:13.5px;color:#8a9bb0;line-height:1.7;">
          If you have any questions in the meantime, please reach out to your AdFlo representative directly.
        </p>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f8fafc;border-top:1px solid #e8edf5;border-radius:0 0 14px 14px;padding:18px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <div style="font-size:13px;font-weight:700;color:#0f1623;">AdFlo</div>
            <div style="font-size:12px;color:#8a9bb0;margin-top:2px;">AdFlo Implementation Team</div>
          </td>
          <td align="right">
            <div style="font-size:11px;color:#b0bfcc;text-align:right;">This email was sent because<br>you completed an AdFlo intake assessment.</div>
          </td>
        </tr></table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      company_name: string;
      contact_name: string;
      contact_email: string;
      contact_title?: string;
      current_process?: string;
      pain_points?: string;
      additional_context?: string;
      answers?: Record<string, string>;
    };

    const {
      company_name, contact_name, contact_email, contact_title,
      current_process = "", pain_points = "", additional_context = "",
      answers,
    } = body;

    if (!company_name?.trim() || !contact_name?.trim() || !contact_email?.trim()) {
      return NextResponse.json(
        { error: "company_name, contact_name, and contact_email are required" },
        { status: 400 }
      );
    }

    const safeAnswers = answers && typeof answers === "object" ? answers : {};

    // ── 1. Fetch questions (for estimate + email) ──────────────────────────────
    const { data: questions } = await supabaseServer
      .from("questions")
      .select("id, cat, q, trigger, weight, question_type")
      .eq("active", true)
      .order("sort_order") as { data: DbQuestion[] | null };

    // ── 2. Compute estimate ────────────────────────────────────────────────────
    let estimatedHours = 0;
    if (questions) {
      for (const q of questions) {
        if (q.question_type === "yesno" && safeAnswers[String(q.id)] === "Yes") {
          estimatedHours += q.weight ?? 0;
        }
      }
    }
    const tier = (tiers.find((t) => estimatedHours >= t.min) ?? tiers[tiers.length - 1]).name;

    // ── 3. Create session ──────────────────────────────────────────────────────
    const { data: session, error: sessionError } = await supabaseServer
      .from("sessions")
      .insert({
        client_name:      company_name.trim(),
        primary_contact:  contact_email.trim(),
        rep_name:         contact_name.trim(),
        answers:          safeAnswers,
        activated_levers: [],
        status:           "submitted",
        estimated_hours:  estimatedHours,
        tier,
        intake_notes: {
          current_process,
          pain_points,
          additional_context,
          contact_title: contact_title ?? "",
        },
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      console.error("[estimator/intake] insert error:", sessionError?.message);
      return NextResponse.json({ error: sessionError?.message ?? "Insert failed" }, { status: 500 });
    }

    // ── 4. Create share token ──────────────────────────────────────────────────
    const token     = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days

    await supabaseServer
      .from("share_tokens")
      .insert({ token, session_id: session.id, expires_at: expiresAt });

    const origin   = new URL(request.url).origin;
    const shareUrl = `${origin}/q/${token}`;

    // ── 5. Send confirmation email ─────────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && contact_email) {
      try {
        // Build yes-answers map grouped by category
        const yesAnswersByCategory: Record<string, string[]> = {};
        if (questions) {
          for (const q of questions) {
            if (safeAnswers[String(q.id)] === "Yes") {
              if (!yesAnswersByCategory[q.cat]) yesAnswersByCategory[q.cat] = [];
              yesAnswersByCategory[q.cat].push(q.q);
            }
          }
        }

        const resend = new Resend(resendKey);
        await resend.emails.send({
          from:    "AdFlo <onboarding@tapclicks.com>",
          to:      contact_email.trim(),
          subject: `Your AdFlo Implementation Assessment — ${company_name.trim()}`,
          html: buildEmailHtml({
            companyName:           company_name.trim(),
            contactName:           contact_name.trim(),
            tier,
            estimatedHours,
            currentProcess:        current_process,
            painPoints:            pain_points,
            additionalContext:     additional_context,
            yesAnswersByCategory,
            shareUrl,
          }),
        });
      } catch (emailErr) {
        // Email failure is non-fatal — session was already created
        console.error("[estimator/intake] email error:", emailErr);
      }
    }

    return NextResponse.json({ sessionId: session.id, shareUrl, success: true }, { status: 201 });
  } catch (err: any) {
    console.error("[estimator/intake] error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
