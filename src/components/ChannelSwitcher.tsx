"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow } from "@/lib/types";
import { IconChevron } from "./icons";
import { ChannelAvatar } from "./ChannelArt";
import { StudioMark } from "./StudioMark";

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
    function onDoc(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (
      channels !== undefined &&
      selectedSlug &&
      !channels.some((channel) => channel.slug === selectedSlug)
    ) {
      setSelectedSlug(null);
    }
  }, [channels, selectedSlug, setSelectedSlug]);

  const current = channels?.find((c) => c.slug === selectedSlug);
  const label = current ? current.name : "All channels";

  return (
    <div ref={ref} className="channel-switcher">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="channel-switcher-button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="channel-switcher-options"
      >
        {current ? (
          <ChannelAvatar
            imageKey={current.identity?.imageKey}
            name={current.name}
            palette={current.identity?.palette}
            size={24}
            radius={7}
          />
        ) : (
          <span className="channel-switcher-all" aria-hidden="true">
            <StudioMark width={16} height={16} />
          </span>
        )}
        <span className="channel-switcher-label">
          <small>{current ? "Channel view" : "Fleet view"}</small>
          <strong>{label}</strong>
        </span>
        <IconChevron className="channel-switcher-chevron" data-open={open ? "true" : undefined} width={15} height={15} />
      </button>

      {open && (
        <div
          id="channel-switcher-options"
          className="channel-switcher-menu"
          role="listbox"
        >
          <DropdownItem
            label="All channels"
            active={!selectedSlug}
            palette={[]}
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
              imageKey={c.identity?.imageKey}
              palette={c.identity?.palette}
              active={c.slug === selectedSlug}
              onClick={() => {
                setSelectedSlug(c.slug);
                setOpen(false);
              }}
            />
          ))}
          {channels && channels.length === 0 && (
            <div className="channel-switcher-empty">
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
  imageKey,
  palette,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  imageKey?: string;
  palette?: string[];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={active}
      className="channel-switcher-option"
      data-active={active ? "true" : undefined}
    >
      {imageKey || palette?.length ? (
        <ChannelAvatar
          imageKey={imageKey}
          name={label}
          palette={palette}
          size={27}
          radius={7}
        />
      ) : (
        <span className="channel-switcher-option-mark" aria-hidden="true">
          <StudioMark width={15} height={15} />
        </span>
      )}
      <span className="channel-switcher-option-copy">
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
      </span>
      <i aria-hidden="true" />
    </button>
  );
}
