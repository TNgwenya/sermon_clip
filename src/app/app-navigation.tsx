"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

type NavigationIconName =
  | "home"
  | "create"
  | "library"
  | "publish"
  | "plan"
  | "growth"
  | "ideas"
  | "insights"
  | "brand"
  | "channels"
  | "more";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: NavigationIconName;
  isActive: (pathname: string) => boolean;
  emphasis?: boolean;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const primaryItems: NavigationItem[] = [
  {
    href: "/",
    label: "Studio home",
    shortLabel: "Home",
    icon: "home",
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/sermons/new",
    label: "New sermon",
    shortLabel: "Create",
    icon: "create",
    isActive: (pathname) => pathname === "/sermons/new" || pathname === "/create",
    emphasis: true,
  },
  {
    href: "/sermons",
    label: "Sermon library",
    shortLabel: "Library",
    icon: "library",
    isActive: (pathname) => pathname === "/sermons" || (pathname.startsWith("/sermons/") && !pathname.startsWith("/sermons/new")),
  },
  {
    href: "/ready-to-post",
    label: "Ready to post",
    shortLabel: "Publish",
    icon: "publish",
    isActive: (pathname) => pathname.startsWith("/ready-to-post"),
  },
];

const navigationGroups: NavigationGroup[] = [
  { label: "Studio", items: primaryItems },
  {
    label: "Plan and learn",
    items: [
      {
        href: "/weekly-plan",
        label: "Weekly planner",
        icon: "plan",
        isActive: (pathname) => pathname.startsWith("/weekly-plan"),
      },
      {
        href: "/growth",
        label: "Growth",
        icon: "growth",
        isActive: (pathname) => pathname.startsWith("/growth"),
      },
      {
        href: "/opportunities",
        label: "Content ideas",
        icon: "ideas",
        isActive: (pathname) => pathname.startsWith("/opportunities"),
      },
      {
        href: "/intelligence-dashboard",
        label: "Sermon insights",
        icon: "insights",
        isActive: (pathname) => pathname.startsWith("/intelligence-dashboard") || pathname.startsWith("/knowledge-base"),
      },
    ],
  },
  {
    label: "Church setup",
    items: [
      {
        href: "/settings/branding",
        label: "Brand kit",
        icon: "brand",
        isActive: (pathname) => pathname.startsWith("/settings/branding"),
      },
      {
        href: "/settings/social",
        label: "Social channels",
        icon: "channels",
        isActive: (pathname) => pathname.startsWith("/settings/social"),
      },
    ],
  },
];

const secondaryItems = navigationGroups.slice(1).flatMap((group) => group.items);

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const glyphs: Record<NavigationIconName, string> = {
    home: "⌂",
    create: "+",
    library: "□",
    publish: "↑",
    plan: "▦",
    growth: "↗",
    ideas: "✦",
    insights: "∴",
    brand: "◇",
    channels: "◉",
    more: "•••",
  };

  return (
    <span className={`rail-item-icon rail-item-icon-${name}`} aria-hidden="true">{glyphs[name]}</span>
  );
}

function NavigationLink({ item, pathname, mobile = false, onNavigate }: {
  item: NavigationItem;
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const active = item.isActive(pathname);

  return (
    <Link
      href={item.href}
      className={`rail-item${active ? " active" : ""}${item.emphasis ? " rail-item-emphasis" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <NavigationIcon name={item.icon} />
      <span>{mobile ? item.shortLabel ?? item.label : item.label}</span>
    </Link>
  );
}

export function AppNavigation() {
  const pathname = usePathname();
  const mobileMoreRef = useRef<HTMLDetailsElement>(null);
  const secondaryIsActive = secondaryItems.some((item) => item.isActive(pathname));

  function closeMobileMore() {
    mobileMoreRef.current?.removeAttribute("open");
  }

  return (
    <aside className="app-rail" aria-label="Sermon Clip navigation">
      <div className="rail-desktop-navigation">
        <Link href="/" className="rail-brand" aria-label="Sermon Clip studio home">
          <span className="rail-mark" aria-hidden="true">
            <Image src="/sermon-clip-1024.png" alt="" width={44} height={44} priority />
          </span>
          <span className="rail-brand-copy">
            <strong>Sermon Clip</strong>
            <small>Content studio</small>
          </span>
        </Link>

        <nav className="rail-nav" aria-label="Primary navigation">
          {navigationGroups.map((group) => (
            <div className="rail-nav-group" key={group.label}>
              <p className="rail-nav-label">{group.label}</p>
              <div className="rail-nav-items">
                {group.items.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
              </div>
            </div>
          ))}
        </nav>

        <div className="rail-footer">
          <span className="rail-credit" aria-hidden="true">SC</span>
          <span>
            <strong>Ministry-first AI</strong>
            <small>Every clip stays in your hands.</small>
          </span>
        </div>
      </div>

      <nav className="rail-mobile-navigation" aria-label="Mobile navigation">
        {primaryItems.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} mobile />)}
        <details ref={mobileMoreRef} className={`rail-mobile-more${secondaryIsActive ? " is-active" : ""}`}>
          <summary aria-label="More navigation options">
            <NavigationIcon name="more" />
            <span>More</span>
          </summary>
          <div className="rail-mobile-more-panel">
            <p className="rail-nav-label">More from Sermon Clip</p>
            {secondaryItems.map((item) => (
              <NavigationLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileMore} />
            ))}
          </div>
        </details>
      </nav>
    </aside>
  );
}
