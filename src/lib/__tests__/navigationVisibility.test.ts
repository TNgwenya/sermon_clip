import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNavigationCollapsed,
  getServerNavigationCollapsed,
  setNavigationCollapsed,
  subscribeNavigationVisibility,
} from "../navigationVisibility";

afterEach(() => vi.unstubAllGlobals());

function browser(storageBlocked = false) {
  const target = new EventTarget();
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => {
      if (storageBlocked) throw new Error("Storage blocked");
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storageBlocked) throw new Error("Storage blocked");
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", Object.assign(target, { localStorage }));
  return { target, values };
}

describe("main navigation visibility", () => {
  it("starts expanded on the server and for a new browser", () => {
    browser();
    expect(getServerNavigationCollapsed()).toBe(false);
    expect(getNavigationCollapsed()).toBe(false);
  });

  it("persists both hiding and reopening", () => {
    const { values } = browser();
    setNavigationCollapsed(true);
    expect(getNavigationCollapsed()).toBe(true);
    expect([...values.values()]).toEqual(["true"]);
    setNavigationCollapsed(false);
    expect(getNavigationCollapsed()).toBe(false);
  });

  it("notifies mounted navigation and supports other-tab changes", () => {
    const { target } = browser();
    const listener = vi.fn();
    const unsubscribe = subscribeNavigationVisibility(listener);
    setNavigationCollapsed(true);
    target.dispatchEvent(new Event("storage"));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setNavigationCollapsed(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("still toggles when browser storage is blocked", () => {
    browser(true);
    setNavigationCollapsed(true);
    expect(getNavigationCollapsed()).toBe(true);
    setNavigationCollapsed(false);
    expect(getNavigationCollapsed()).toBe(false);
  });
});
