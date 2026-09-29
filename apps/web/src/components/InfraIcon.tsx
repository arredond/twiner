import { CATEGORY_ICONS, iconInnerSvg } from "../infraIcons";
import type { InfraCategory } from "../infrastructure";

// A category's map icon (infraIcons.ts) in a small round badge, for the
// legend and the sidebar -- the same glyph the map draws in each asset's
// circle. The SVG is our own bundled Maki asset, not user content.
export function InfraIcon({ category }: { category: InfraCategory }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: "1.1rem",
        height: "1.1rem",
        borderRadius: "50%",
        border: "1px solid var(--text)",
        background: "var(--surface)",
        color: "var(--text)",
        verticalAlign: "middle",
      }}
    >
      <svg
        viewBox="0 0 15 15"
        width="0.7rem"
        height="0.7rem"
        fill="currentColor"
        dangerouslySetInnerHTML={{ __html: iconInnerSvg(CATEGORY_ICONS[category]) }}
      />
    </span>
  );
}
