import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sermon Clip Agent",
  description: "Turn sermons into ready-to-post clips for your church.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="app-rail" aria-label="Main navigation">
            <Link href="/" className="rail-mark" aria-label="Sermon Clip dashboard">
              SC
            </Link>
            <nav className="rail-nav">
              <Link href="/" className="rail-item">Home</Link>
              <Link href="/sermons/new" className="rail-item">Create</Link>
              <Link href="/sermons" className="rail-item">Library</Link>
              <Link href="/ready-to-post" className="rail-item">Post</Link>
              <Link href="/growth" className="rail-item">Growth</Link>
              <Link href="/settings/social" className="rail-item">Social</Link>
              <Link href="/settings/branding" className="rail-item">Brand</Link>
              <Link href="/opportunities" className="rail-item">Ideas</Link>
            </nav>
            <div className="rail-footer">
              <span className="rail-credit">AI</span>
              <span className="small muted">Sermon-aware clips</span>
            </div>
          </aside>
          <div className="app-content">{children}</div>
        </div>
      </body>
    </html>
  );
}
