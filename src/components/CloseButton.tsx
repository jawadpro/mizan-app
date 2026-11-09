/** The ✕ in a popup's corner: a round, filled button big enough to hit with a thumb. */
export default function CloseButton({ onClick, disabled, label = "Close" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="close-x" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
