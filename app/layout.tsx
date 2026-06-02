"use client";

import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "../lib/hooks/useRole";
import { supabase } from "../lib/supabase";

export default function RootLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { role, isAdmin, isSales, userEmail, displayName, mustChangePassword, userId } = useRole();
  console.log("[layout] role:", role, "isAdmin:", isAdmin);

  const isPublicPage =
    pathname?.startsWith("/q") ||
    pathname?.startsWith("/intake") ||
    pathname?.startsWith("/interview") ||
    pathname?.startsWith("/login");

  async function signOut() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      await fetch("/api/audit/event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ eventType: "logout" }),
      }).catch(() => {});
    }
    await supabase.auth.signOut();
    document.cookie = "adfl-session=; path=/; max-age=0; SameSite=Lax";
    router.push("/login");
  }

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
        {isPublicPage ? children : (
        <div style={{ display: "flex", minHeight: "100vh", background: "#f0f4f9" }}>

          {/* Sidebar */}
          <aside
            style={{
              width: collapsed ? 68 : 240,
              minWidth: collapsed ? 68 : 240,
              transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)",
              background: "#0f1623",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "2px 0 12px rgba(0,0,0,0.18)",
              zIndex: 10,
            }}
          >
            {/* Logo / Wordmark */}
            <div
              style={{
                height: 60,
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "space-between",
                padding: collapsed ? "0 16px" : "0 20px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0,
              }}
            >
              {!collapsed && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#fff",
                      letterSpacing: "-0.04em",
                      flexShrink: 0,
                    }}
                  >
                    af
                  </div>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#ffffff",
                      letterSpacing: "-0.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    AdFlo Tools
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#8a9bb0",
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              >
                {collapsed ? "→" : "←"}
              </button>
            </div>

            {/* Nav */}
<nav
  style={{
    flex: 1,
    padding: "12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  }}
>
  <NavSection label="Main" collapsed={collapsed} />
  <NavItem href="/" label="Home" collapsed={collapsed} icon="🏠" pathname={pathname} exact />
  <NavSection label="Tools" collapsed={collapsed} />
  <NavItem href="/estimator" label="adfloEstimate" collapsed={collapsed} icon="📋" pathname={pathname} exact />
  {!isSales && <NavItem href="/adfloxtract" label="adfloXtract" collapsed={collapsed} icon="🔁" pathname={pathname} />}
  {!isSales && <NavItem href="/migration" label="adfloMigrate" collapsed={collapsed} icon="↔️" pathname={pathname} />}
  <NavItem href="/interview" label="adfloInterview" collapsed={collapsed} icon="💬" pathname={pathname} />
  <NavSection label="Settings" collapsed={collapsed} />
  {isAdmin && <NavItem href="/admin" label="Admin" collapsed={collapsed} icon="⚙️" pathname={pathname} />}
  {!isSales && <NavItem href="/instances" label="Instances" collapsed={collapsed} icon="🖥️" pathname={pathname} />}
</nav>
            {/* Footer / Sign out */}
            <div
              style={{
                padding: collapsed ? "12px 10px" : "12px 14px",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0,
              }}
            >
              {collapsed ? (
                <button
                  type="button"
                  onClick={signOut}
                  title="Sign out"
                  style={{
                    width: "100%",
                    padding: "8px 0",
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "rgba(255,255,255,0.4)",
                    cursor: "pointer",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ↩
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(displayName || userEmail) && (
                    <Link
                      href="/admin"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        textDecoration: "none",
                        padding: "6px 8px",
                        borderRadius: 8,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {displayName && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayName}
                        </span>
                      )}
                      {userEmail && (
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {userEmail}
                        </span>
                      )}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={signOut}
                    style={{
                      padding: "7px 12px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      color: "rgba(255,255,255,0.5)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  >
                    ↩ Sign out
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* Main content */}
          <main
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background:
                "radial-gradient(circle at top right, rgba(47,111,237,0.05), transparent 30%), linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%)",
              minHeight: "100vh",
            }}
          >
            {/* Top bar */}
            <div
              style={{
                height: 60,
                borderBottom: "1px solid #dde5ef",
                display: "flex",
                alignItems: "center",
                padding: "0 28px",
                background: "rgba(255,255,255,0.75)",
                backdropFilter: "blur(8px)",
                flexShrink: 0,
              }}
            >
              <Breadcrumb pathname={pathname} />
            </div>

            {mustChangePassword && (
              <div
                style={{
                  background: "#fffbeb",
                  borderBottom: "1px solid #fcd34d",
                  padding: "10px 28px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: "#92400e",
                  flexShrink: 0,
                }}
              >
                <span>⚠️ You are using a temporary password.</span>
                <Link
                  href={`/admin?user=${userId}`}
                  style={{ color: "#b45309", fontWeight: 600, textDecoration: "underline" }}
                >
                  Change it now
                </Link>
              </div>
            )}
            <div style={{ flex: 1, padding: "28px 28px" }}>
              {children}
            </div>
          </main>
        </div>
        )}
      </body>
    </html>
  );
}

function NavSection({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.07)",
          margin: "8px 4px",
        }}
      />
    );
  }
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.25)",
        padding: "10px 10px 4px",
      }}
    >
      {label}
    </div>
  );
}

function NavItem({
  href,
  label,
  collapsed,
  icon,
  pathname,
  exact = false,
}: {
  href: string;
  label: string;
  collapsed: boolean;
  icon: string;
  pathname: string | null;
  exact?: boolean;
}) {
  const isActive = exact
    ? pathname === href
    : pathname?.startsWith(href) && href !== "/";

  return (
    <Link
      href={href as any}
      title={collapsed ? label : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 10,
        padding: collapsed ? "10px 0" : "9px 12px",
        borderRadius: 10,
        color: isActive ? "#ffffff" : "rgba(255,255,255,0.5)",
        textDecoration: "none",
        background: isActive
          ? "linear-gradient(90deg, rgba(47,111,237,0.25), rgba(47,111,237,0.1))"
          : "transparent",
        borderLeft: isActive ? "2px solid #2f6fed" : "2px solid transparent",
        fontSize: 13.5,
        fontWeight: isActive ? 600 : 400,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
    </Link>
  );
}

function Breadcrumb({ pathname }: { pathname: string | null }) {
  if (!pathname) return null;

  const segments = pathname.split("/").filter(Boolean);

  const labels: Record<string, string> = {
    estimator: "adfloEstimate",
    sessions: "Sessions",
    adfloxtract: "adfloXtract",
    migration: "adfloMigrate",
    instances: "Instances",
    admin: "Admin",
    edit: "Edit",
  };

  if (segments.length === 0) {
    return <span style={{ fontSize: 13, color: "#8a9bb0", fontWeight: 500 }}>Home</span>;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Link href="/" style={{ fontSize: 13, color: "#8a9bb0", textDecoration: "none" }}>
        Home
      </Link>
      {segments.map((seg, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        const label = labels[seg] || (seg.length > 12 ? seg.slice(0, 8) + "…" : seg);

        return (
          <span key={href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#c8d4e0", fontSize: 12 }}>›</span>
            {isLast ? (
              <span style={{ fontSize: 13, color: "#2f6fed", fontWeight: 600 }}>{label}</span>
            ) : (
              <Link href={href as any} style={{ fontSize: 13, color: "#8a9bb0", textDecoration: "none" }}>
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}
