// Standalone public page — no sidebar.
// The root layout suppresses the sidebar for /q/* via its isPublicPage check.
export default function QLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
