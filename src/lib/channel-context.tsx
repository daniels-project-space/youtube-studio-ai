"use client";

import {
  useCallback,
  createContext,
  useContext,
  useSyncExternalStore,
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
const CHANGE_EVENT = "studio:selected-channel-change";

function readSelectedSlug(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeToSelectedSlug(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function ChannelProvider({ children }: { children: ReactNode }) {
  const selectedSlug = useSyncExternalStore(subscribeToSelectedSlug, readSelectedSlug, () => null);

  const setSelectedSlug = useCallback((slug: string | null) => {
    try {
      if (slug) window.localStorage.setItem(STORAGE_KEY, slug);
      else window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ChannelContext.Provider value={{ selectedSlug, setSelectedSlug }}>
      {children}
    </ChannelContext.Provider>
  );
}

export function useSelectedChannel(): ChannelContextValue {
  return useContext(ChannelContext);
}
