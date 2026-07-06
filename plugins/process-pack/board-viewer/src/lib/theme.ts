// Three-state theme: "system" (default, follows the OS via prefers-color-scheme),
// or an explicit "light"/"dark" override. The override is persisted to
// localStorage and applied as `data-theme` on <html>; index.html also runs a
// tiny synchronous inline script that reads the same key before first paint,
// so a stored override never flashes the wrong theme on load. See index.css
// for how `data-theme` and the media query combine to pick the palette.

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "board-viewer-theme";

function isThemeMode(v: unknown): v is "light" | "dark" {
  return v === "light" || v === "dark";
}

/** Reads the persisted override, if any; "system" if none is stored. */
export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Applies `mode` to the document: sets/clears `data-theme` on <html>. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

/** Persists `mode` (or clears the override for "system") and applies it. */
export function setStoredTheme(mode: ThemeMode): void {
  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // localStorage unavailable (private mode, disabled) — theme still
    // applies for this session, just won't persist across reloads.
  }
  applyTheme(mode);
}
