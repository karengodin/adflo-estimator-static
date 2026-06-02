"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { supabase } from "../../lib/supabase";
import { useSearchParams } from "next/navigation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface GenerateResult {
  sessionId: string;
  estimatedHours: number;
  tier: string;
  clientName: string;
  confidence?: {
    score: number;
    answeredCount: number;
    totalQuestions: number;
    level: "high" | "medium" | "low";
  };
}

const TIER_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Bronze:     { bg: "#fdf1e5", color: "#a8611a", border: "#f1d3b2" },
  Silver:     { bg: "#f1f5f9", color: "#475569", border: "#dbe3ec" },
  Gold:       { bg: "#fff7db", color: "#9a6b00", border: "#f1dd8c" },
  Enterprise: { bg: "#f0e6ff", color: "#5b21b6", border: "#d8b4fe" },
};

export default function InterviewPage() {
  return (
    <Suspense fallback={<div style={{ fontFamily: "'DM Sans', sans-serif", padding: 40, color: "#627286" }}>Loading...</div>}>
      <InterviewContent />
    </Suspense>
  );
}

function InterviewContent() {
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session_id");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionContext, setSessionContext] = useState<{
    clientName?: string;
    answers?: Record<string, string>;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasInit = useRef(false);

  // Scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load session context if session_id param provided
  useEffect(() => {
    if (!sessionIdParam || hasInit.current) return;
    hasInit.current = true;
    fetch(`/api/estimator/sessions/${sessionIdParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setSessionContext({ clientName: data.company_name, answers: data.answers });
        }
      })
      .catch(() => {})
      .finally(() => startConversation(sessionIdParam));
  }, [sessionIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start without a session_id
  useEffect(() => {
    if (sessionIdParam || hasInit.current) return;
    hasInit.current = true;
    startConversation(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startConversation = useCallback(async (sid: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [],
          sessionContext: sid ? sessionContext : undefined,
        }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (data.message) {
        setMessages([{ role: "assistant", content: data.message }]);
      } else {
        setError(data.error ?? "Failed to start conversation");
      }
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }, [sessionContext]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || generating) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          sessionContext: sessionContext ?? undefined,
        }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (data.message) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.message! }]);
      } else {
        setError(data.error ?? "No response received");
      }
    } catch {
      setError("Failed to get response");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const res = await fetch("/api/interview/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          sessionId: sessionIdParam ?? undefined,
        }),
      });
      const data = await res.json() as GenerateResult & { error?: string };
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch {
      setError("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const copyShareLink = async () => {
    if (!result?.sessionId) return;
    try {
      const res = await fetch("/api/estimator/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      const data = await res.json() as { url?: string };
      if (data.url) {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback: copy current URL
      await navigator.clipboard.writeText(window.location.origin + `/estimator?session_id=${result.sessionId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const showFinishButton = userMessageCount >= 4 && !result;
  const tierStyle = result ? (TIER_COLORS[result.tier] ?? TIER_COLORS.Bronze) : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          height: 60,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #dde5ef",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: "-0.04em",
            }}
          >
            af
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f1623", lineHeight: 1.2 }}>
              AdFlo
            </div>
            <div style={{ fontSize: 11, color: "#8a9bb0", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Implementation Discovery
            </div>
          </div>
        </div>
        {showFinishButton && !generating && (
          <button
            onClick={handleGenerate}
            style={{
              background: "linear-gradient(135deg, #2f6fed, #1a56d4)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "9px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            Finish & Generate
          </button>
        )}
        {generating && (
          <div style={{ fontSize: 13, color: "#2f6fed", fontWeight: 500 }}>
            Analyzing conversation…
          </div>
        )}
      </div>

      {/* Results panel */}
      {result && (
        <div
          style={{
            flexShrink: 0,
            background: "#fff",
            borderBottom: "1px solid #dde5ef",
            padding: "20px 24px",
          }}
        >
          <div
            style={{
              maxWidth: 680,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, color: "#627286", marginBottom: 4 }}>Your estimate</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: "#0f1623" }}>
                  {result.estimatedHours} hrs
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: tierStyle!.bg,
                    color: tierStyle!.color,
                    border: `1px solid ${tierStyle!.border}`,
                  }}
                >
                  {result.tier} Tier
                </span>
              </div>
              {result.confidence && (
                <div style={{
                  marginTop: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: "6px 10px",
                  borderRadius: 8,
                  ...(result.confidence.level === "high"
                    ? { background: "#edf8f2", color: "#1a7a45", border: "1px solid #c0e8d0" }
                    : result.confidence.level === "medium"
                    ? { background: "#fff8e8", color: "#8a6417", border: "1px solid #f3e0a3" }
                    : { background: "#fff0f0", color: "#c94b4b", border: "1px solid #f9c0c0" }),
                }}>
                  {result.confidence.level === "high" && (
                    <strong>Estimate confidence: High</strong>
                  )}
                  {result.confidence.level === "medium" && (
                    <><strong>Estimate confidence: Medium</strong> — your IM may adjust after reviewing the full questionnaire</>
                  )}
                  {result.confidence.level === "low" && (
                    <><strong>Estimate confidence: Low</strong> — this conversation didn&apos;t cover enough ground for a reliable estimate. Your IM will complete the questionnaire before finalizing.</>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a
                href="/estimator"
                style={{
                  background: "#f0f4f9",
                  color: "#2f6fed",
                  border: "1px solid #dde5ef",
                  borderRadius: 9,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                View Full Estimate →
              </a>
              <button
                onClick={copyShareLink}
                style={{
                  background: copied ? "#e8f5e9" : "#f0f4f9",
                  color: copied ? "#2e7d32" : "#627286",
                  border: `1px solid ${copied ? "#c8e6c9" : "#dde5ef"}`,
                  borderRadius: 9,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {copied ? "✓ Copied!" : "Share Estimate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 24px 8px",
        }}
      >
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                gap: 10,
                alignItems: "flex-end",
              }}
            >
              {msg.role === "assistant" && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  af
                </div>
              )}
              <div
                style={{
                  maxWidth: "75%",
                  background: msg.role === "user" ? "#2f6fed" : "#fff",
                  color: msg.role === "user" ? "#fff" : "#1a2332",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  padding: "12px 16px",
                  fontSize: 14,
                  lineHeight: 1.6,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                  whiteSpace: "pre-wrap",
                  border: msg.role === "assistant" ? "1px solid #edf2f7" : "none",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#fff",
                }}
              >
                af
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #edf2f7",
                  borderRadius: "16px 16px 16px 4px",
                  padding: "14px 18px",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                  display: "flex",
                  gap: 5,
                  alignItems: "center",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#c0cdd8",
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Generate loading state */}
          {generating && (
            <div
              style={{
                textAlign: "center",
                padding: "20px",
                color: "#627286",
                fontSize: 13,
              }}
            >
              Analyzing your conversation and building your workbook…
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            flexShrink: 0,
            background: "#fef2f2",
            borderTop: "1px solid #fecaca",
            padding: "10px 24px",
            fontSize: 13,
            color: "#dc2626",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Input area */}
      {!result && (
        <div
          style={{
            flexShrink: 0,
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid #dde5ef",
            padding: "16px 24px 20px",
          }}
        >
          <div
            style={{
              maxWidth: 680,
              margin: "0 auto",
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message… (Enter to send, Shift+Enter for new line)"
              disabled={loading || generating}
              rows={1}
              style={{
                flex: 1,
                border: "1.5px solid #dde5ef",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 14,
                fontFamily: "'DM Sans', sans-serif",
                resize: "none",
                outline: "none",
                background: "#fff",
                color: "#0f1623",
                lineHeight: 1.5,
                maxHeight: 120,
                overflowY: "auto",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#2f6fed")}
              onBlur={(e) => (e.target.style.borderColor = "#dde5ef")}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading || generating}
              style={{
                background: !input.trim() || loading || generating ? "#e2e8f0" : "#2f6fed",
                color: !input.trim() || loading || generating ? "#94a3b8" : "#fff",
                border: "none",
                borderRadius: 12,
                width: 44,
                height: 44,
                cursor: !input.trim() || loading || generating ? "default" : "pointer",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
            >
              ↑
            </button>
          </div>
          {showFinishButton && (
            <div
              style={{
                maxWidth: 680,
                margin: "10px auto 0",
                textAlign: "center",
              }}
            >
              <button
                onClick={handleGenerate}
                disabled={generating}
                style={{
                  background: "linear-gradient(135deg, #2f6fed, #1a56d4)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 28px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Finish & Generate Workbook + Estimate →
              </button>
              <div style={{ fontSize: 11, color: "#8a9bb0", marginTop: 6 }}>
                Ready when you are — more context gives a more accurate estimate
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bounce animation */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
