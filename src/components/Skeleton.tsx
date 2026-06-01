/** Shimmering placeholder block for loading states. */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return (
    <span
      className="studio-skeleton"
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
      }}
    />
  );
}

/** A small stack of skeleton card rows for list placeholders. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="glass"
          style={{ padding: "1rem 1.1rem", display: "grid", gap: "0.6rem" }}
        >
          <Skeleton width="40%" height={14} />
          <Skeleton width="70%" height={12} />
        </div>
      ))}
    </div>
  );
}
