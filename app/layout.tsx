"use client";

import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <aside
            style={{
              width: collapsed ? "72px" : "250px",
              transition: "width 0.2s ease",
              padding: "20px 12px",
              background: "#111",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "space-between",
                gap: "8px",
              }}
            >
              {!collapsed && <h2 style={{ margin: 0, fontSize: "18px" }}>AdFlo Tools</h2>}

              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                style={{
                  border: "1px solid #333",
                  background: "#1b1b1b",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                {collapsed ? "→" : "←"}
              </button>
            </div>

            <nav
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              <NavItem href="/" label="Home" collapsed={collapsed} icon="🏠" />
              <NavItem href="/estimator" label="Estimator" collapsed={collapsed} icon="📋" />
              <NavItem
                href="/estimator/sessions"
                label="Sessions"
                collapsed={collapsed}
                icon="🗂️"
              />
              <NavItem
                href="/adfloxtract"
                label="AdfloXtract"
                collapsed={collapsed}
                icon="🔀"
              />
              <NavItem
                href="/migration"
                label="Migration Tool"
                collapsed={collapsed}
                icon="🔄"
              />
              <NavItem href="/admin" label="Admin" collapsed={collapsed} icon="⚙️" />
            </nav>
          </aside>

          <main
            style={{
              flex: 1,
              padding: "20px",
              transition: "all 0.2s ease",
            }}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

function NavItem({
  href,
  label,
  collapsed,
  icon,
}: {
  href: string;
  label: string;
  collapsed: boolean;
  icon: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "10px",
        color: "#fff",
        textDecoration: "none",
        background: "transparent",
      }}
    >
      <span style={{ fontSize: "18px", lineHeight: 1 }}>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}