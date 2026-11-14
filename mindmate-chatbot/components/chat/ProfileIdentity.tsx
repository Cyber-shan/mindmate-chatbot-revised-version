"use client";

import { useEffect, useRef } from "react";

export default function ProfileIdentity({ name, email }: { name: string; email: string }) {
  const nameLine = useRef<HTMLParagraphElement>(null);
  const emailLine = useRef<HTMLParagraphElement>(null);
  const nameText = useRef<HTMLSpanElement>(null);
  const emailText = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let generation = 0;
    let animation: Animation | undefined;

    const restart = () => {
      if (disposed) return;
      const current = ++generation;
      animation?.cancel();
      if (reducedMotion.matches || document.hidden) return;

      // Measure rendered text, so font changes and sidebar resizing are respected.
      // Only overflowing lines join the sequence: name first, then email.
      const queue = [
        { line: nameLine.current, text: nameText.current },
        { line: emailLine.current, text: emailText.current },
      ].flatMap(({ line, text }) => {
        if (!line || !text || line.clientWidth === 0) return [];
        const distance = Math.ceil(text.getBoundingClientRect().width - line.clientWidth);
        return distance > 1 ? [{ text, distance }] : [];
      });
      if (!queue.length) return;

      const scroll = async () => {
        while (!disposed && generation === current) {
          for (const { text, distance } of queue) {
            if (disposed || generation !== current) return;
            const travel = Math.max(1600, distance / 28 * 1000);
            const duration = 1000 + travel + 1200 + 600;
            animation = text.animate([
              { transform: "translateX(0)", offset: 0 },
              { transform: "translateX(0)", offset: 1000 / duration },
              { transform: `translateX(-${distance}px)`, offset: (1000 + travel) / duration },
              { transform: `translateX(-${distance}px)`, offset: (1000 + travel + 1200) / duration },
              { transform: "translateX(0)", offset: 1 },
            ], { duration, easing: "linear" });
            try { await animation.finished; } catch { return; }
          }
        }
      };
      void scroll();
    };

    const observer = new ResizeObserver(restart);
    for (const node of [nameLine.current, emailLine.current, nameText.current, emailText.current]) {
      if (node) observer.observe(node);
    }
    reducedMotion.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    void document.fonts.ready.then(restart);
    restart();
    return () => {
      disposed = true;
      generation++;
      animation?.cancel();
      observer.disconnect();
      reducedMotion.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [name, email]);

  return (
    <div className="min-w-0 flex-1" data-profile-identity>
      <p ref={nameLine} title={name} className="overflow-hidden whitespace-nowrap motion-reduce:whitespace-normal motion-reduce:break-all"
        style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--foreground)", lineHeight: 1.3 }}>
        <span ref={nameText} className="inline-block motion-reduce:max-w-full">{name}</span>
      </p>
      <p ref={emailLine} title={email} className="overflow-hidden whitespace-nowrap motion-reduce:whitespace-normal motion-reduce:break-all"
        style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
        <span ref={emailText} className="inline-block motion-reduce:max-w-full">{email}</span>
      </p>
    </div>
  );
}
