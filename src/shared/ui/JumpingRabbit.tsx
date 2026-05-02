/**
 * Clean rabbit silhouette — filled pill-shaped ears, circular head, oval body.
 * No opacity stacking, no stroke-only paths — renders crisply at 14–24 px.
 * When `active` is true the element loops the courscheat-hop CSS animation.
 */
interface JumpingRabbitProps {
  size?: number;
  active?: boolean;
  color?: string;
  className?: string;
}

export function JumpingRabbit({
  size = 18,
  active = false,
  color = "currentColor",
  className,
}: JumpingRabbitProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      style={
        active
          ? { animation: "courscheat-hop 0.55s ease-in-out infinite alternate", display: "inline-block", flexShrink: 0 }
          : { display: "inline-block", flexShrink: 0 }
      }
    >
      {/* Left ear — filled pill, angled slightly outward */}
      <rect x="5.5" y="0.5" width="4" height="9" rx="2" transform="rotate(-7 7.5 5)" />
      {/* Right ear — mirrored */}
      <rect x="14.5" y="0.5" width="4" height="9" rx="2" transform="rotate(7 16.5 5)" />
      {/* Head */}
      <circle cx="12" cy="14.5" r="5.5" />
      {/* Body — sits below head, slight overlap creates a natural join */}
      <ellipse cx="12" cy="21.5" rx="5" ry="3" />
      {/* Eye highlights */}
      <circle cx="10.2" cy="13.8" r="0.9" fill="white" />
      <circle cx="13.8" cy="13.8" r="0.9" fill="white" />
    </svg>
  );
}
