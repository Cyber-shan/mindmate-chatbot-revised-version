export type Theme = "light" | "dark";
const STORAGE_KEY = "mindmate-theme";
const CHANGE_EVENT = "mindmate-theme-change";
let memoryPreference: Theme | null = null;

// Set the theme before the first paint, including when browser storage is blocked.
export const THEME_INIT_SCRIPT = '(function(){var t;try{t=localStorage.getItem("mindmate-theme")}catch(e){}if(t!=="light"&&t!=="dark"){try{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()';

function preference(): Theme | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* The current tab can still change theme when storage is unavailable. */ }
  return memoryPreference;
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  memoryPreference = next;
  applyTheme(next);
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the in-memory choice. */ }
}

export function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

export function subscribeTheme(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/** One controller for navigation, OS changes and other browser tabs. */
export function syncTheme() {
  applyTheme(preference() ?? systemTheme());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystemChange = () => { if (!preference()) applyTheme(systemTheme()); };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    memoryPreference = null;
    applyTheme(preference() ?? systemTheme());
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => { media?.removeEventListener("change", onSystemChange); window.removeEventListener("storage", onStorage); };
}
