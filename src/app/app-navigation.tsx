"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

type NavigationIconName =
  | "home"
  | "create"
  | "review"
  | "publish"
  | "plan"
  | "growth"
  | "ideas"
  | "insights"
  | "brand"
  | "channels"
  | "settings"
  | "more";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: NavigationIconName;
  isActive: (pathname: string) => boolean;
  emphasis?: boolean;
};

type NavigationMenu = {
  label: string;
  icon: NavigationIconName;
  items: NavigationItem[];
};

const primaryItems: NavigationItem[] = [
  {
    href: "/",
    label: "Home",
    icon: "home",
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/sermons/new",
    label: "Create",
    icon: "create",
    isActive: (pathname) => pathname === "/sermons/new" || pathname === "/create",
    emphasis: true,
  },
  {
    href: "/sermons",
    label: "Review & library",
    shortLabel: "Review",
    icon: "review",
    isActive: (pathname) => pathname === "/sermons" || (pathname.startsWith("/sermons/") && !pathname.startsWith("/sermons/new")),
  },
  {
    href: "/ready-to-post",
    label: "Publish",
    icon: "publish",
    isActive: (pathname) => pathname.startsWith("/ready-to-post"),
  },
];

const contentPlanItems: NavigationItem[] = [
  {
    href: "/weekly-plan",
    label: "Weekly plan",
    icon: "plan",
    isActive: (pathname) => pathname.startsWith("/weekly-plan"),
  },
  {
    href: "/opportunities",
    label: "Content ideas",
    icon: "ideas",
    isActive: (pathname) => pathname.startsWith("/opportunities"),
  },
  {
    href: "/growth",
    label: "Growth",
    icon: "growth",
    isActive: (pathname) => pathname.startsWith("/growth"),
  },
  {
    href: "/intelligence-dashboard",
    label: "Sermon insights",
    icon: "insights",
    isActive: (pathname) => pathname.startsWith("/intelligence-dashboard") || pathname.startsWith("/knowledge-base"),
  },
];

const settingsItems: NavigationItem[] = [
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
];

const utilityMenus: NavigationMenu[] = [
  { label: "Content plan", icon: "plan", items: contentPlanItems },
  { label: "Settings", icon: "settings", items: settingsItems },
];

const secondaryItems = utilityMenus.flatMap((menu) => menu.items);

function NavigationIconPaths({ name }: { name: NavigationIconName }) {
  switch (name) {
    case "home":
      return (
        <>
          <path d="m3.5 10.5 8.5-7 8.5 7" />
          <path d="M5.5 9.25V20h13V9.25M9.5 20v-6h5v6" />
        </>
      );
    case "create":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" />
        </>
      );
    case "review":
      return (
        <>
          <path d="M3.5 7.5h6l2-2h9v13h-17z" />
          <path d="M3.5 10h17" />
          <path d="m9 14.5 1.8 1.8 4.2-4.2" />
        </>
      );
    case "publish":
      return (
        <>
          <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
          <path d="M5 13.5V20h14v-6.5" />
        </>
      );
    case "plan":
      return (
        <>
          <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
          <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
        </>
      );
    case "growth":
      return (
        <>
          <path d="M4 19V5" />
          <path d="m5.5 16 4.25-4.25 3.25 3.25L20 8" />
          <path d="M15.5 8H20v4.5" />
        </>
      );
    case "ideas":
      return (
        <>
          <path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z" />
          <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
          <path d="m5.5 14 .55 1.45 1.45.55-1.45.55L5.5 19l-.55-1.45L3.5 17l1.45-.55L5.5 14Z" />
        </>
      );
    case "insights":
      return (
        <>
          <path d="M4 20V11h4v9M10 20V4h4v16M16 20v-6h4v6" />
          <path d="M3 20h18" />
        </>
      );
    case "brand":
      return (
        <>
          <path d="M4 4h7l9 9-7 7-9-9V4Z" />
          <circle cx="8.5" cy="8.5" r="1.25" />
        </>
      );
    case "channels":
      return (
        <>
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="m8.25 10.9 7.5-3.8M8.25 13.1l7.5 3.8" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.55h.09A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4.05v.09A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5c.13.4.34.74.6 1 .3.28.68.42 1.1.4h.1v4.05h-.1A1.7 1.7 0 0 0 19.4 15Z" />
        </>
      );
    case "more":
      return (
        <>
          <circle cx="5" cy="12" r="1.25" />
          <circle cx="12" cy="12" r="1.25" />
          <circle cx="19" cy="12" r="1.25" />
        </>
      );
  }
}

function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <span className={`rail-item-icon rail-item-icon-${name}`} aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <NavigationIconPaths name={name} />
      </svg>
    </span>
  );
}

function LivingFrameMark() {
  return (
    <span className="rail-mark living-frame-mark" aria-hidden="true">
      <span className="living-frame-window" />
      <span className="living-frame-message" />
      <span className="living-frame-light" />
    </span>
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

function UtilityMenu({ menu, pathname }: { menu: NavigationMenu; pathname: string }) {
  const active = menu.items.some((item) => item.isActive(pathname));

  return (
    <details
      key={`${menu.label}-${active ? "active" : "idle"}`}
      className={`rail-utility-menu${active ? " is-active" : ""}`}
      open={active || undefined}
    >
      <summary>
        <NavigationIcon name={menu.icon} />
        <span>{menu.label}</span>
        <span className="rail-utility-chevron" aria-hidden="true" />
      </summary>
      <div className="rail-utility-items">
        {menu.items.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
      </div>
    </details>
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
        <Link href="/" className="rail-brand" aria-label="Sermon Clip church content studio home">
          <LivingFrameMark />
          <span className="rail-brand-copy">
            <strong>Sermon Clip</strong>
            <small>Church content studio</small>
          </span>
        </Link>

        <nav className="rail-nav" aria-label="Primary navigation">
          <div className="rail-primary-navigation">
            <p className="rail-nav-label">Weekly workflow</p>
            <div className="rail-nav-items">
              {primaryItems.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
            </div>
          </div>

          <div className="rail-utility-navigation">
            <p className="rail-nav-label">Workspace</p>
            {utilityMenus.map((menu) => <UtilityMenu key={menu.label} menu={menu} pathname={pathname} />)}
          </div>
        </nav>

        <div className="rail-footer">
          <Link href="/settings/branding" className="rail-workspace-card" aria-label="Open your church workspace settings">
            <span className="rail-workspace-avatar" aria-hidden="true">CH</span>
            <span className="rail-workspace-copy">
              <small>Active workspace</small>
              <strong>Your church</strong>
            </span>
            <span className="rail-workspace-status" aria-hidden="true" />
          </Link>
          <div className="rail-review-note">
            <span className="rail-review-beacon" aria-hidden="true" />
            <span>
              <strong>Human review is on</strong>
              <small>Every message stays in your hands.</small>
            </span>
          </div>
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
            <div className="rail-mobile-workspace">
              <span className="rail-workspace-avatar" aria-hidden="true">CH</span>
              <span>
                <small>Active workspace</small>
                <strong>Your church</strong>
              </span>
            </div>
            {utilityMenus.map((menu) => (
              <div className="rail-mobile-menu-group" key={menu.label}>
                <p className="rail-nav-label">{menu.label}</p>
                {menu.items.map((item) => (
                  <NavigationLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileMore} />
                ))}
              </div>
            ))}
          </div>
        </details>
      </nav>
    </aside>
  );
}
