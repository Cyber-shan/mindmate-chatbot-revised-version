"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { isDarkTheme, subscribeTheme, toggleTheme } from "@/lib/theme";

const serverTheme = () => false;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useSyncExternalStore(subscribeTheme, isDarkTheme, serverTheme);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark mode"
      aria-pressed={dark}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
      data-testid="theme-toggle"
      className={`theme-toggle ${className}`}
    >
      <span className="theme-icon theme-icon-light" aria-hidden="true">
        <Moon size={15} />
      </span>
      <span className="theme-icon theme-icon-dark" aria-hidden="true">
        <Sun size={15} />
      </span>
    </button>
  );
}
