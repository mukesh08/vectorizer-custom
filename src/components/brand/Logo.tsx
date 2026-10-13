/* The mark: a Bézier curve with its two anchor points and control handles — what the tracer
   actually produces. Colors come from the CSS tokens so it works anywhere in the UI;
   public/favicon.svg is the same drawing with the hex values inlined. */

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M4 22 C 8 6, 20 6, 24 22" fill="none" stroke="var(--accent)" strokeWidth="2.4" />
      <line x1="4" y1="22" x2="9" y2="8" stroke="var(--muted)" strokeWidth="1" />
      <line x1="24" y1="22" x2="19" y2="8" stroke="var(--muted)" strokeWidth="1" />
      <rect x="1.5" y="19.5" width="5" height="5" fill="var(--anchor)" transform="rotate(45 4 22)" />
      <rect x="21.5" y="19.5" width="5" height="5" fill="var(--anchor)" transform="rotate(45 24 22)" />
      <circle cx="9" cy="8" r="2" fill="var(--panel)" stroke="var(--muted)" />
      <circle cx="19" cy="8" r="2" fill="var(--panel)" stroke="var(--muted)" />
    </svg>
  );
}
