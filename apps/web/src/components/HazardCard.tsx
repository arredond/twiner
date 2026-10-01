import type { ReactNode } from "react";

// One hazard's card in the top-left stack (twinQUAKE, twinFLOOD): its name
// is the header, with the hazard's part ("QUAKE") in its colour
// (HAZARD_COLORS). Clicking it opens the card's setup controls (App.tsx
// decides what that means: switching hazard, a new run, or collapsing).
// `status` (running / errors) shows open or collapsed.
export function HazardCard({
  name,
  color,
  open,
  title,
  onHeaderClick,
  status,
  children,
}: {
  // e.g. "QUAKE" in "twinQUAKE".
  name: string;
  color: string;
  open: boolean;
  // Header tooltip: what a click will do.
  title: string;
  onHeaderClick: () => void;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--panel-bg)",
        color: "var(--text)",
        borderRadius: 6,
        boxShadow: "0 1px 4px var(--shadow)",
        padding: "0.5rem 0.75rem",
      }}
    >
      <button
        type="button"
        onClick={onHeaderClick}
        aria-expanded={open}
        title={title}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          width: "100%",
          padding: 0,
          border: "none",
          background: "none",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: "0.95rem",
        }}
      >
        <span>
          <span style={{ color: "var(--text-muted)" }}>twin</span>
          <strong style={{ color }}>{name}</strong>
        </span>
        <span aria-hidden style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && children}
      {status}
    </section>
  );
}
