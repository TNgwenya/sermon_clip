import type { Metadata, Viewport } from "next";

import { AppNavigation } from "@/app/app-navigation";

import "./globals.css";
import "./styles/premium-foundation.css";
import "./styles/premium-workflows.css";
import "./styles/premium-review-ready.css";
import "./styles/premium-studio.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"),
  title: {
    default: "Sermon Clip — Church Content Studio",
    template: "%s | Sermon Clip",
  },
  description: "One sermon. A week of faithful content. Find, review, edit, and prepare ministry-safe social clips with your church team.",
  applicationName: "Sermon Clip",
  category: "creative studio",
  icons: {
    icon: "/sermon-clip-1024.png",
    apple: "/sermon-clip-1024.png",
  },
  openGraph: {
    title: "Sermon Clip — Church Content Studio",
    description: "One sermon. A week of faithful content. Find, review, edit, and prepare ministry-safe social clips with your church team.",
    siteName: "Sermon Clip",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1733,
        height: 908,
        alt: "Sermon Clip church content studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sermon Clip — Church Content Studio",
    description: "One sermon. A week of faithful content. Find, review, edit, and prepare ministry-safe social clips with your church team.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b0d0b",
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
