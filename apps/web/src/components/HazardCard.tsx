import type { ReactNode } from "react";

// One hazard's card in the top-left stack (twinQUAKE, twinFLOOD, twinCOAST): its name
// is the header, with the hazard's part ("QUAKE") in its colour
// (HAZARD_COLORS). Clicking it opens the card's setup controls (App.tsx
// decides what that means: switching hazard, a new run, or collapsing).
// `status` (running / errors) shows open or collapsed. The info icon next
// to the name opens the hazard's docs page (apps/docs) in a new tab.
export function HazardCard({
  name,
  color,
  open,
  title,
  onHeaderClick,
  docsHref,
  docsLabel,
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
  docsHref: string;
  // The info icon's tooltip and accessible name.
  docsLabel: string;
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
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
            flex: 1,
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
        <a
          href={docsHref}
          target="_blank"
          rel="noopener"
          title={docsLabel}
          aria-label={docsLabel}
          style={{ display: "flex", color: "var(--text-muted)" }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </a>
      </div>
      {open && children}
      {status}
    </section>
  );
}
