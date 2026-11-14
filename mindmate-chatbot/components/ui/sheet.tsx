"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

export const Sheet = Dialog.Root;

export function SheetContent({
  children,
  className = "",
  side = "right",
  ...props
}: ComponentProps<typeof Dialog.Content> & { side?: "right" | "left" }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
      <Dialog.Content
        className={`admin-design fixed inset-y-0 z-50 flex h-full flex-col gap-4 border-border bg-background shadow-lg outline-none transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500 ${
          side === "right"
            ? "right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
            : "left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
        } ${className}`}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`flex flex-col gap-2 ${className}`} {...props} />;
}

export function SheetTitle({ className = "", ...props }: ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={`font-semibold text-foreground ${className}`} {...props} />;
}

export function SheetDescription({ className = "", ...props }: ComponentProps<typeof Dialog.Description>) {
  return <Dialog.Description className={`text-sm text-muted-foreground ${className}`} {...props} />;
}
