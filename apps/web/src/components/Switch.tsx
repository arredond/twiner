// A small on/off switch for the legend's layer toggles: a real checkbox
// (keyboard and screen readers get a switch) drawn as a pill.
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  // Accessible name; the visible label sits next to it in the row.
  label: string;
}) {
  return (
    <label
      style={{
        position: "relative",
        display: "inline-block",
        flex: "none",
        width: "1.7rem",
        height: "0.95rem",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", inset: 0, opacity: 0, margin: 0, cursor: "inherit" }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "0.5rem",
          background: checked ? "var(--switch-on)" : "var(--switch-off)",
          transition: "background 120ms",
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: "0.12rem",
          left: checked ? "0.87rem" : "0.12rem",
          width: "0.71rem",
          height: "0.71rem",
          borderRadius: "50%",
          background: "#fff",
          transition: "left 120ms",
        }}
      />
    </label>
  );
}
