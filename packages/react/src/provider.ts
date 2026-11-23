import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createTerraConnect, type TerraConnect, type TerraConnectOptions } from "@terrawallet/connect";
import { defineTerraElements, setDefaultClient, type ThemeOptions } from "@terrawallet/elements";

export interface TerraContextValue {
  client: TerraConnect;
  theme: ThemeOptions | undefined;
}

const TerraContext = createContext<TerraContextValue | null>(null);

export interface TerraProviderProps extends TerraConnectOptions {
  /** Bring your own client (for example one shared with a wagmi connector). Read once, on mount. */
  client?: TerraConnect;
  /** Theme for <ConnectButton/>, <WalletModal/> and the modal opened by hooks: mode, accent, radius, font. */
  theme?: ThemeOptions;
  children?: ReactNode;
}

/**
 * Provides one Terra Connect client to the tree. The client is created once on mount (options are read then), is
 * safe during server rendering, and silently restores the previous connection in the browser. Passing a secret
 * key as `publishableKey` throws.
 */
export function TerraProvider({ client: given, theme, children, ...options }: TerraProviderProps) {
  const [client] = useState<TerraConnect>(() => given ?? createTerraConnect({ deepLink: "manual", ...options }));
  useEffect(() => {
    // Web Components and the modal share this client.
    setDefaultClient(client);
    defineTerraElements();
  }, [client]);
  const value = useMemo<TerraContextValue>(() => ({ client, theme }), [client, theme]);
  return createElement(TerraContext.Provider, { value }, children);
}

export function useTerraContext(): TerraContextValue {
  const ctx = useContext(TerraContext);
  if (!ctx) throw new Error("Terra hooks and components must be used inside <TerraProvider>.");
  return ctx;
}

/** The underlying Terra Connect client (for anything the hooks do not cover). */
export function useTerraClient(): TerraConnect {
  return useTerraContext().client;
}
