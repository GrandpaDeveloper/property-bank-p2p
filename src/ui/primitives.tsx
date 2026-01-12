import React from "react";

export function Card(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 12,
        boxShadow: "var(--shadow)",
        backdropFilter: "blur(10px)",
      }}
    >
      {(props.title || props.right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 900 }}>{props.title}</div>
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
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    fontWeight: 900,
    cursor: "pointer",
  };
  const style: React.CSSProperties =
    v === "danger"
      ? { ...base, background: "rgba(185,28,28,0.12)", color: "var(--danger)" }
      : v === "ghost"
      ? { ...base, background: "transparent" }
      : { ...base, background: "rgba(17,24,39,0.92)", color: "white", borderColor: "rgba(17,24,39,0.3)" };

  return (
    <button {...props} style={{ ...style, opacity: props.disabled ? 0.55 : 1 }}>
      {props.children}
    </button>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)", marginBottom: 6 }}>{children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        borderRadius: 12,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        outline: "none",
        background: "rgba(255,255,255,0.9)",
      }}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: "100%",
        borderRadius: 12,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        outline: "none",
        background: "rgba(255,255,255,0.9)",
        minHeight: 70,
        resize: "vertical",
      }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        borderRadius: 12,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        outline: "none",
        background: "rgba(255,255,255,0.9)",
        fontWeight: 800,
      }}
    />
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>;
}

export function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />;
}
