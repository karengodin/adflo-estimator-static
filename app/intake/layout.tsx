// Standalone public page — no sidebar.
// The root layout suppresses the sidebar for /intake via its isPublicPage check.
export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
