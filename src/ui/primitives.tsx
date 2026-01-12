import React from "react";

export function Card(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-emerald-900/15 bg-white/90 p-4 shadow-lg shadow-emerald-950/10 backdrop-blur-sm"
    >
      {(props.title || props.right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-black uppercase tracking-wide text-emerald-950">{props.title}</div>
          <div>{props.right}</div>
        </div>
      )}
      {props.children}
    </div>
  );
}

export function Btn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }
) {
  const v = props.variant ?? "primary";
  const base =
    "rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide transition";
  const style =
    v === "danger"
      ? `${base} border-red-200 bg-red-100/70 text-red-700 hover:bg-red-100`
      : v === "ghost"
      ? `${base} border-emerald-900/15 bg-transparent text-emerald-900 hover:bg-emerald-900/5`
      : `${base} border-emerald-950/30 bg-emerald-950 text-emerald-50 hover:bg-emerald-900`;

  return (
    <button {...props} className={`${style} ${props.disabled ? "opacity-50" : ""}`}>
      {props.children}
    </button>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-black uppercase tracking-wide text-emerald-900/70">{children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-emerald-900/15 bg-white/90 px-3 py-2 text-sm font-semibold text-emerald-950 outline-none placeholder:text-emerald-900/40 focus:border-emerald-900/40 focus:ring-2 focus:ring-emerald-200/70"
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="min-h-[90px] w-full resize-y rounded-xl border border-emerald-900/15 bg-white/90 px-3 py-2 text-sm font-semibold text-emerald-950 outline-none placeholder:text-emerald-900/40 focus:border-emerald-900/40 focus:ring-2 focus:ring-emerald-200/70"
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border border-emerald-900/15 bg-white/90 px-3 py-2 text-sm font-extrabold uppercase tracking-wide text-emerald-950 outline-none focus:border-emerald-900/40 focus:ring-2 focus:ring-emerald-200/70"
    />
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Divider() {
  return <div className="my-2 h-px w-full bg-emerald-900/10" />;
}
