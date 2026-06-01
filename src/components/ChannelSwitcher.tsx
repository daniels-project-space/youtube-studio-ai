"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow } from "@/lib/types";
import { IconChevron } from "./icons";

/**
 * Top-bar dropdown over the owner's channels. "All channels" is the default;
 * the selection persists via channel-context (localStorage). Pages read the
 * selected slug to filter their data.
 */
export function ChannelSwitcher() {
  const ownerId = useOwnerId();
  const { selectedSlug, setSelectedSlug } = useSelectedChannel();
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = channels?.find((c) => c.slug === selectedSlug);
  const label = current ? current.name : "All channels";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lift"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.5rem 0.85rem",
          borderRadius: 12,
          background: "var(--color-surface)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--color-border)",
          color: "var(--color-fg)",
          font: "inherit",
          fontSize: "0.88rem",
          cursor: "pointer",
          minWidth: 180,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: current ? "var(--color-secondary)" : "var(--color-faint)",
          }}
        />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <IconChevron width={15} height={15} style={{ color: "var(--color-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      </button>

      {open && (
        <div
          className="glass"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            minWidth: 200,
            padding: "0.35rem",
            zIndex: 40,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <DropdownItem
            label="All channels"
            active={!selectedSlug}
            onClick={() => {
              setSelectedSlug(null);
              setOpen(false);
            }}
          />
          {channels?.map((c) => (
            <DropdownItem
              key={c._id}
              label={c.name}
              sub={c.template}
              active={c.slug === selectedSlug}
              onClick={() => {
                setSelectedSlug(c.slug);
                setOpen(false);
              }}
            />
          ))}
          {channels && channels.length === 0 && (
            <div style={{ padding: "0.6rem 0.7rem", fontSize: "0.82rem", color: "var(--color-faint)" }}>
              No channels yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        width: "100%",
        padding: "0.5rem 0.6rem",
        borderRadius: 8,
        background: active ? "var(--color-accent-soft)" : "transparent",
        border: "none",
        color: active ? "var(--color-fg)" : "var(--color-muted)",
        font: "inherit",
        fontSize: "0.85rem",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: "0.72rem", color: "var(--color-faint)" }}>{sub}</span>}
    </button>
  );
}
