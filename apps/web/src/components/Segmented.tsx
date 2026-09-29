// A row of mutually exclusive buttons (the mode toggle, the settings
// menu's language/theme pickers): the chosen one filled, `aria-pressed`
// for assistive tech.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  // Accessible name for the group.
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex" }}>
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            title={option.title}
            style={{
              flex: 1,
              padding: "0.3rem 0.5rem",
              fontSize: "0.8rem",
              border: "1px solid var(--border-input)",
              marginLeft: i === 0 ? 0 : -1,
              background: selected ? "var(--accent-bg)" : "var(--surface)",
              color: selected ? "var(--accent-fg)" : "var(--text)",
              borderRadius: i === 0 ? "4px 0 0 4px" : i === options.length - 1 ? "0 4px 4px 0" : 0,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
