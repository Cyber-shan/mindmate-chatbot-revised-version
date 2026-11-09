import { HeartHandshake, ExternalLink } from "lucide-react";
import type { StudentSupport } from "@/lib/support/types";

export default function SupportNotice({ support }: { support: StudentSupport }) {
  if (!support.safety_response_required && support.review_status !== "queued") return null;
  return (
    <aside
      aria-label="Support for this message"
      data-testid="student-support-notice"
      className="mt-3 rounded-xl border p-3 text-left"
      style={{ background: "var(--surface-elevated)", borderColor: "var(--border)", color: "var(--foreground)" }}
    >
      <p className="flex items-center gap-2 text-xs font-semibold">
        <HeartHandshake size={14} aria-hidden="true" />
        {support.safety_response_required ? "Support beyond this chat" : "A review request was saved"}
      </p>
      <p data-testid="student-review-status" className="mt-1.5 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
        {support.review_status === "queued"
          ? "A review request was saved with this response. This does not confirm that anyone has read it. For urgent help, reach out to a person directly."
          : "No active review request is confirmed for this response. This chat has not contacted a counselor or emergency services. Please reach out to someone you trust or your school counselor."}
      </p>
      {support.resources.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {support.resources.map((resource) => {
            const external = /^https?:/i.test(resource.href);
            return <li key={resource.href}>
              <a
                href={resource.href}
                {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                {resource.label}{external && <ExternalLink size={11} aria-hidden="true" />}
                {external && <span className="sr-only"> (opens in a new tab)</span>}
              </a>
            </li>;
          })}
        </ul>
      )}
    </aside>
  );
}
