import type { Metadata, Viewport } from "next";

import { AppNavigation } from "@/app/app-navigation";

import "./globals.css";
import "./styles/premium-foundation.css";
import "./styles/premium-workflows.css";
import "./styles/premium-review-ready.css";
import "./styles/premium-studio.css";

export const metadata: Metadata = {
  title: {
    default: "Sermon Clip — Sermon Content Studio",
    template: "%s | Sermon Clip",
  },
  description: "Turn full sermons into beautifully edited, branded, ready-to-post social clips.",
  applicationName: "Sermon Clip",
  category: "creative studio",
  icons: {
    icon: "/sermon-clip-1024.png",
    apple: "/sermon-clip-1024.png",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090b0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="premium-app">
        <a className="skip-link" href="#workspace-content">Skip to main content</a>
        <div className="app-shell">
          <AppNavigation />
          <div className="app-content" id="workspace-content" tabIndex={-1}>{children}</div>
        </div>
      </body>
    </html>
  );
}
