const STORAGE_KEY = "sermon-clip.navigation-collapsed";
const CHANGE_EVENT = "sermon-clip:navigation-visibility";
let fallback = false;
let storageWriteFailed = false;

export function getNavigationCollapsed(): boolean {
  if (storageWriteFailed) return fallback;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return fallback;
  }
}

export function getServerNavigationCollapsed(): boolean {
  return false;
}

export function setNavigationCollapsed(collapsed: boolean): void {
  fallback = collapsed;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
    storageWriteFailed = false;
  } catch {
    // The control still works when browser storage is unavailable.
    storageWriteFailed = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeNavigationVisibility(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
