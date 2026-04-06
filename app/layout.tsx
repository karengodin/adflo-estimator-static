"use client";

import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type NavItemConfig = {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
};

type NavSectionConfig = {
  label: string;
  items: NavItemConfig[];
};

const NAV_SECTIONS: NavSectionConfig[] = [
  {
    label: "Main",
    items: [
      { href: "/", label: "Home", icon: "🏠", exact: true },      
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/adfloxtract", label: "adfloXtract", icon: "🔀" },
      { href: "/migration", label: "adfloMigrate", icon: "🔄" },
      { href: "/estimator", label: "adfloEstimate", icon: "#️⃣", exact: true },
    ],
  },
  {
    label: "Settings",
    items: [
    { href: "/admin", label: "Admin", icon: "⚙️" },
    { href: "/estimator/sessions", label: "Sessions", icon: "🗂️" },
    { href: "/instances", label: "Instances", icon: "🖥️" },
    ],
  },
];

const BREADCRUMB_LABELS: Record<string, string> = {
  estimator: "adfloEstimate",
  sessions: "Sessions",
  adfloxtract: "adfloXtract",
  migration: "adfloMigrate",
  instances: "Instances",
  admin: "Admin",
  edit: "Edit",
};

const SIDEBAR_STORAGE_KEY = "adflo-tools-sidebar-collapsed";

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) {
      setCollapsed(saved === "true");
    }
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  }, [collapsed, hasHydrated]);

  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);

  return (
    <html lang="en">
    <head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</head>
      <body
  style={{
    margin: 0,
    background: "#eef3f8",
    color: "#0f172a",
  }}
>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            background:
              "radial-gradient(circle at top right, rgba(47,111,237,0.06), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #eef3f8 100%)",
          }}
        >
          <aside
            aria-label="Primary"
            style={{
              width: collapsed ? 72 : 248,
              minWidth: collapsed ? 72 : 248,
              transition:
                "width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
              background: "#0f172a",
              color: "#ffffff",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "2px 0 16px rgba(15, 23, 42, 0.18)",
              zIndex: 20,
            }}
          >
            <div
              style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "space-between",
                padding: collapsed ? "0 14px" : "0 18px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
              }}
            >
              {!collapsed && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: "linear-gradient(135deg, #2f6fed, #4fbf9f)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 13,
                      color: "#fff",
                      letterSpacing: "-0.04em",
                      flexShrink: 0,
                    }}
                  >
                    af
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#fff",
                        letterSpacing: "-0.02em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      AdFlo Tools
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.45)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Internal workspace
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-pressed={collapsed}
                onClick={() => setCollapsed((prev) => !prev)}
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#cbd5e1",
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {collapsed ? "→" : "←"}
              </button>
            </div>

            <nav
              style={{
                flex: 1,
                padding: "12px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {NAV_SECTIONS.map((section) => (
                <div key={section.label}>
                  <NavSection label={section.label} collapsed={collapsed} />
                  {section.items.map((item) => (
                    <NavItem
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      collapsed={collapsed}
                      pathname={pathname}
                      exact={item.exact}
                    />
                  ))}
                </div>
              ))}
            </nav>

            {!collapsed && (
              <div
                style={{
                  padding: "14px 18px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.28)",
                  letterSpacing: "0.03em",
                }}
              >
                AdFlo Tools · Internal
              </div>
            )}
          </aside>

          <main
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              minHeight: "100vh",
            }}
          >
            <header
              style={{
                height: 64,
                borderBottom: "1px solid #dbe3ee",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 24px",
                background: "rgba(255,255,255,0.82)",
                backdropFilter: "blur(8px)",
                position: "sticky",
                top: 0,
                zIndex: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Breadcrumb pathname={pathname} />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginLeft: 16,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#2f6fed",
                    background: "rgba(47,111,237,0.08)",
                    border: "1px solid rgba(47,111,237,0.14)",
                    padding: "6px 10px",
                    borderRadius: 999,
                  }}
                >
                  {pageTitle}
                </div>
              </div>
            </header>

            <div
              style={{
                flex: 1,
                padding: "28px 24px",
              }}
            >
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

function NavSection({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div
        aria-hidden="true"
        style={{
          height: 1,
          background: "rgba(255,255,255,0.08)",
          margin: "10px 6px",
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
        color: "rgba(255,255,255,0.28)",
        padding: "10px 10px 6px",
      }}
    >
      {label}
    </div>
  );
}

function NavItem({
  href,
  label,
  icon,
  collapsed,
  pathname,
  exact = false,
}: {
  href: string;
  label: string;
  icon: string;
  collapsed: boolean;
  pathname: string | null;
  exact?: boolean;
}) {
  const isActive = exact
    ? pathname === href
    : href === "/"
      ? pathname === "/"
      : pathname?.startsWith(href);

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 10,
        padding: collapsed ? "11px 0" : "10px 12px",
        margin: "1px 0",
        borderRadius: 10,
        color: isActive ? "#ffffff" : "rgba(255,255,255,0.68)",
        textDecoration: "none",
        background: isActive
          ? "linear-gradient(90deg, rgba(47,111,237,0.24), rgba(47,111,237,0.08))"
          : "transparent",
        borderLeft: isActive ? "2px solid #2f6fed" : "2px solid transparent",
        fontSize: 13.5,
        fontWeight: isActive ? 600 : 500,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      {!collapsed && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      )}
    </Link>
  );
}

function Breadcrumb({ pathname }: { pathname: string | null }) {
  if (!pathname) return null;

  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Home</span>;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 13,
          color: "#64748b",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        Home
      </Link>

      {segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const label =
          BREADCRUMB_LABELS[segment] ||
          (segment.length > 16 ? `${segment.slice(0, 13)}…` : segment);

        return (
          <span key={href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>›</span>
            {isLast ? (
              <span style={{ fontSize: 13, color: "#2f6fed", fontWeight: 700 }}>{label}</span>
            ) : (
              <Link
                href={href}
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

function getPageTitle(pathname: string | null): string {
  if (!pathname || pathname === "/") return "Home";

  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  return BREADCRUMB_LABELS[lastSegment] || humanizeSegment(lastSegment);
}

function humanizeSegment(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}