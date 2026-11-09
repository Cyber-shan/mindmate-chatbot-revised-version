"use client";

import { useEffect } from "react";
import { syncTheme } from "@/lib/theme";

export function ThemeSync() {
  useEffect(() => syncTheme(), []);
  return null;
}
