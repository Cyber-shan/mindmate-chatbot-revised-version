import { Ban, BookOpen, Brain, CheckCircle2, CircleDot, Eye, HeartCrack, Swords, Users } from "lucide-react";
import {
  CATEGORY_LABEL,
  STATUS_HELP,
  STATUS_LABEL,
  type Category,
  type Status,
} from "./data";

export const CATEGORY_ICON = {
  suicidal: HeartCrack,
  "harm-others": Swords,
  abuse: Users,
  distress: Brain,
  academic: BookOpen,
};

export const STATUS_ICON: Record<Status, typeof Eye> = {
  new: CircleDot,
  reviewed: Eye,
  resolved: CheckCircle2,
  "false-positive": Ban,
};

export const STATUS_STYLE: Record<Status, string> = {
  new: "border-foreground bg-foreground text-primary-foreground",
  reviewed: "border-foreground bg-background text-foreground",
  resolved: "border-transparent bg-accent text-muted-foreground",
  "false-positive": "border-dashed border-muted-foreground/60 bg-transparent text-muted-foreground",
};

export function StatusPill({ status, size = "sm" }: { status: Status; size?: "sm" | "md" }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      title={STATUS_HELP[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${STATUS_STYLE[status]} ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <Icon className={size === "md" ? "size-4" : "size-3.5"} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const CATEGORY_COLOR: Record<Category, { fg: string; bg: string }> = {
  suicidal: { fg: "var(--category-safety)", bg: "var(--category-safety-surface)" },
  "harm-others": { fg: "var(--category-harm)", bg: "var(--category-harm-surface)" },
  abuse: { fg: "var(--category-abuse)", bg: "var(--category-abuse-surface)" },
  distress: { fg: "var(--category-distress)", bg: "var(--category-distress-surface)" },
  academic: { fg: "var(--category-academic)", bg: "var(--category-academic-surface)" },
};

export function CategoryTag({ category }: { category: Category }) {
  const Icon = CATEGORY_ICON[category];
  const { fg, bg } = CATEGORY_COLOR[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: fg, background: bg }}
    >
      <Icon className="size-3.5" aria-hidden />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function CategoryDot({ category }: { category: Category }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[category].fg }} aria-hidden />;
}

export function ColorGuide() {
  return (
    null
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2" title={`Algorithm confidence ${Math.round(value * 100)}%`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-accent">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{Math.round(value * 100)}%</span>
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .replace(".", "")
    .toUpperCase();
}

export function avatarTone(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 35% var(--avatar-bg-lightness))`, fg: `hsl(${h} 45% var(--avatar-fg-lightness))`, ring: `hsl(${h} 30% var(--avatar-ring-lightness))` };
}

export function StudentAvatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const t = avatarTone(id);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1.5px ${t.ring}`, fontSize: size * 0.34 }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
