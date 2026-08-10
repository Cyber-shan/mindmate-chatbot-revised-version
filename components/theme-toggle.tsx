"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect } from "react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  useLayoutEffect(() => {
    const savedTheme = localStorage.getItem("mindmate-theme");
    const theme =
      savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : document.documentElement.dataset.theme === "dark"
          ? "dark"
          : "light";

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, []);

  const toggleTheme = () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("mindmate-theme", nextTheme);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark mode"
      title="Toggle light and dark mode"
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
