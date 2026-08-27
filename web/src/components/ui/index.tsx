"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/* ============================================================
   Owned primitives. Small enough to read in one sitting, styled
   entirely through the design tokens so the Appearance settings
   reach every component without any of them knowing about it.
   ============================================================ */

/* ---------------- Button ---------------- */
const button = cva(
  "inline-flex items-center gap-[7px] font-semibold whitespace-nowrap rounded-[var(--radius-sm)] border transition-colors disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-surface border-line-2 text-ink-2 hover:bg-surface-3 hover:text-ink",
        primary: "bg-accent border-accent text-accent-ink hover:bg-accent-2 hover:border-accent-2",
        ghost: "bg-transparent border-transparent text-ink-2 hover:bg-surface-3 hover:text-ink",
        danger: "bg-surface border-bad text-bad hover:bg-wash-bad",
      },
      size: {
        default: "px-[13px] py-[7px] text-[13px]",
        sm: "px-[9px] py-[4px] text-[12px] font-medium",
        lg: "px-[18px] py-[10px] text-[14px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

/* ---------------- Card ---------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-surface border border-line rounded-[var(--radius)] shadow-[var(--shadow-1)]", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  right,
  className,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-[10px] px-4 py-[13px] border-b border-line", className)}>
      <h3 className="text-[14px] font-bold">{title}</h3>
      {right ? <div className="ml-auto flex items-center gap-[5px]">{right}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/* ---------------- Chip ---------------- */
const chip = cva(
  "inline-flex items-center gap-[5px] px-2 py-[2px] rounded-full text-[11px] font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        default: "bg-surface-3 text-ink-2",
        good: "bg-wash-good text-good",
        warn: "bg-wash-warn text-amber",
        bad: "bg-wash-bad text-bad",
        teal: "bg-wash-teal text-teal",
        accent: "bg-accent-wash text-accent",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Chip({
  tone,
  dot,
  className,
  children,
}: VariantProps<typeof chip> & { dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(chip({ tone }), className)}>
      {dot ? <span className="w-[6px] h-[6px] rounded-full bg-current shrink-0" /> : null}
      {children}
    </span>
  );
}

/* ---------------- Input ---------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[13px] text-ink",
        "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Field({
  label,
  help,
  error,
  children,
}: {
  label?: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      {label ? <label className="text-[12.5px] font-semibold flex items-center gap-[7px]">{label}</label> : null}
      {children}
      {error ? (
        <span className="text-[11.5px] text-bad leading-[1.5]">{error}</span>
      ) : help ? (
        <span className="text-[11.5px] text-ink-3 leading-[1.5]">{help}</span>
      ) : null}
    </div>
  );
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-[4px]", className)} role="group">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 px-[10px] py-[5px] text-[12px] rounded-[var(--radius-sm)] border transition-colors",
              active
                ? "bg-ink text-surface border-ink font-semibold"
                : "border-line-2 text-ink-2 hover:text-ink hover:border-ink-3",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The lighter inline variant used inside card headers. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-[2px] bg-surface-3 p-[2px] rounded-[var(--radius-sm)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "px-[9px] py-[3px] rounded-[4px] text-[11.5px] transition-colors",
              active ? "bg-surface text-ink font-semibold shadow-[var(--shadow-1)]" : "text-ink-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-[11px] px-[13px] py-3 border border-line rounded-[var(--radius-sm)] bg-surface-2 text-left hover:border-line-2 transition-colors"
    >
      <span
        className={cn(
          "w-[34px] h-[19px] rounded-full relative shrink-0 mt-[1px] transition-colors",
          checked ? "bg-accent" : "bg-surface-4",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] left-[2px] w-[15px] h-[15px] rounded-full bg-surface shadow-[var(--shadow-1)] transition-transform",
            checked && "translate-x-[15px]",
          )}
        />
      </span>
      <span className="flex-1">
        <b className="block text-[13px] font-semibold mb-[2px]">{title}</b>
        {description ? <span className="text-[11.5px] text-ink-3 leading-[1.5]">{description}</span> : null}
      </span>
    </button>
  );
}

/* ---------------- Section label ---------------- */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[10px] font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3">
      {children}
      <span className="flex-1 h-px bg-line" />
    </div>
  );
}

/* ---------------- Table ---------------- */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  // Wide tables scroll inside their own container so the page body never does.
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[13px] min-w-[560px]", className)} {...props} />;
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "text-left font-mono text-[9.5px] tracking-[0.11em] uppercase text-ink-3 font-semibold px-[14px] py-[10px] border-b border-line",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-[14px] py-3 border-b border-line text-ink-2", className)} {...props} />;
}

/* ---------------- Stat tile ---------------- */
export function Tile({
  label,
  value,
  delta,
  deltaTone = "flat",
  children,
}: {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: "up" | "down" | "flat";
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-[var(--radius)] p-4 shadow-[var(--shadow-1)]">
      <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-ink-3">{label}</div>
      <div className="font-display text-[28px] font-bold tracking-[-0.025em] my-[7px] tnum leading-none">{value}</div>
      {delta ? (
        <div
          className={cn(
            "text-[11.5px] font-semibold flex items-center gap-[5px]",
            deltaTone === "up" && "text-good",
            deltaTone === "down" && "text-bad",
            deltaTone === "flat" && "text-ink-3",
          )}
        >
          {delta}
        </div>
      ) : null}
      {children ? <div className="mt-[9px]">{children}</div> : null}
    </div>
  );
}

/* ---------------- Feedback states ---------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-surface-3 rounded-[var(--radius-sm)] animate-pulse", className)} />;
}

export function EmptyState({
  icon = "◻",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-14 px-5 text-ink-3">
      <div className="text-[34px] mb-3 opacity-50">{icon}</div>
      <h3 className="text-[16px] text-ink mb-[6px]">{title}</h3>
      {body ? <p className="m-0 mx-auto max-w-[42ch] text-[13.5px]">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-12 px-5">
      <div className="text-[28px] mb-3">⚠</div>
      <h3 className="text-[15px] text-ink mb-[6px]">That didn&apos;t load</h3>
      <p className="m-0 mx-auto max-w-[46ch] text-[13px] text-ink-3">{message}</p>
      {onRetry ? (
        <div className="mt-4 flex justify-center">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}
