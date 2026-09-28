"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Values read from the web container's environment at request time, so one
 * built image can serve local, staging, and production.
 */
export interface RuntimeConfig {
  readonly apiUrl: string;
  readonly environment: string;
}

const RuntimeConfigContext = createContext<RuntimeConfig>({
  apiUrl: "http://localhost:2567",
  environment: "development",
});

export function RuntimeConfigProvider({
  value,
  children,
}: {
  readonly value: RuntimeConfig;
  readonly children: ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}
