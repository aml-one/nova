"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ShellHeaderExtrasContextValue = {
  extras: ReactNode | null;
  setShellHeaderExtras: (node: ReactNode | null) => void;
};

const ShellHeaderExtrasContext = createContext<ShellHeaderExtrasContextValue | null>(null);

export function ShellHeaderExtrasProvider({ children }: { children: ReactNode }) {
  const [extras, setExtras] = useState<ReactNode | null>(null);
  const setShellHeaderExtras = useCallback((node: ReactNode | null) => {
    setExtras(node);
  }, []);
  const value = useMemo(
    () => ({ extras, setShellHeaderExtras }),
    [extras, setShellHeaderExtras]
  );
  return <ShellHeaderExtrasContext.Provider value={value}>{children}</ShellHeaderExtrasContext.Provider>;
}

export function useShellHeaderExtras(): ShellHeaderExtrasContextValue {
  const ctx = useContext(ShellHeaderExtrasContext);
  if (!ctx) {
    throw new Error("useShellHeaderExtras must be used within ShellHeaderExtrasProvider");
  }
  return ctx;
}
