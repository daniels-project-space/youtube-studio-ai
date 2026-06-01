"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Holds the channel currently selected in the top-bar ChannelSwitcher.
 * `null` = "All channels". Persisted to localStorage so a refresh keeps the
 * operator's selection. Value is a channel slug (stable, URL-friendly).
 */
type ChannelContextValue = {
  selectedSlug: string | null;
  setSelectedSlug: (slug: string | null) => void;
};

const ChannelContext = createContext<ChannelContextValue>({
  selectedSlug: null,
  setSelectedSlug: () => {},
});

const STORAGE_KEY = "studio.selectedChannel";

export function ChannelProvider({ children }: { children: ReactNode }) {
  const [selectedSlug, setSelectedSlugState] = useState<string | null>(null);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSelectedSlugState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setSelectedSlug = (slug: string | null) => {
    setSelectedSlugState(slug);
    try {
      if (slug) window.localStorage.setItem(STORAGE_KEY, slug);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <ChannelContext.Provider value={{ selectedSlug, setSelectedSlug }}>
      {children}
    </ChannelContext.Provider>
  );
}

export function useSelectedChannel(): ChannelContextValue {
  return useContext(ChannelContext);
}
