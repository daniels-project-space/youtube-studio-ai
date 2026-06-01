"use client";

import { createContext, useContext, type ReactNode } from "react";
import { OWNER_ID } from "./config";

/**
 * Provides the active owner id to the client tree so OWNER_ID is sourced from
 * one place instead of being re-declared in every page. Single value today;
 * the provider seam lets a future multi-tenant build swap it per session.
 */
const OwnerContext = createContext<string>(OWNER_ID);

export function OwnerProvider({
  ownerId = OWNER_ID,
  children,
}: {
  ownerId?: string;
  children: ReactNode;
}) {
  return (
    <OwnerContext.Provider value={ownerId}>{children}</OwnerContext.Provider>
  );
}

export function useOwnerId(): string {
  return useContext(OwnerContext);
}
