/**
 * wagmi connector: `connectors: [terraWallet()]`.
 *
 *   import { createConfig, http } from "wagmi";
 *   import { base, mainnet } from "wagmi/chains";
 *   import { terraWallet } from "@terrawallet/react/wagmi";
 *
 *   export const config = createConfig({
 *     chains: [base, mainnet],
 *     connectors: [terraWallet({ walletConnectProjectId: "..." })],
 *     transports: { [base.id]: http(), [mainnet.id]: http() },
 *   });
 *
 * Works with wagmi 2.17+ and 3.x. It has no runtime dependency on wagmi (the connector contract is a plain
 * function), so it adds nothing to apps that do not use it.
 */
import type { CreateConnectorFn } from "@wagmi/core";
import {
  TERRA_RDNS,
  assertPublishableKey,
  createTerraConnect,
  getChain,
  toProviderError,
  type EIP1193Provider,
  type TerraChain,
  type TerraConnect,
  type TerraConnectOptions,
} from "@terrawallet/connect";
import type { ThemeOptions } from "@terrawallet/elements";

export interface TerraWalletParameters extends TerraConnectOptions {
  /** Share a client with <TerraProvider client={...}>. */
  client?: TerraConnect;
  /** Show the Terra Wallet modal on connect (extension, QR code, app deep link). Default true. */
  modal?: boolean;
  theme?: ThemeOptions;
}

type ViemChainLike = {
  id: number;
  name: string;
  nativeCurrency: { symbol: string; decimals: number };
  rpcUrls: { default: { http: readonly string[] } };
  blockExplorers?: { default: { url: string } };
  testnet?: boolean;
};

function toTerraChain(c: ViemChainLike): TerraChain {
  return (
    getChain(c.id) ?? {
      id: c.id,
      name: c.name,
      symbol: c.nativeCurrency.symbol,
      decimals: c.nativeCurrency.decimals,
      rpcUrls: c.rpcUrls.default.http,
      ...(c.blockExplorers ? { explorerUrl: c.blockExplorers.default.url } : {}),
      logo: "",
      ...(c.testnet ? { testnet: true } : {}),
    }
  );
}

export function terraWallet(parameters: TerraWalletParameters = {}): CreateConnectorFn<EIP1193Provider, { getTerraClient(): TerraConnect }> {
  const { client: given, modal = true, theme, ...options } = parameters;
  // Refuse a secret key when the wagmi config is created, not later at the first connect.
  if (options.publishableKey !== undefined) assertPublishableKey(options.publishableKey);
  return (config) => {
    let client: TerraConnect | undefined;
    let off: (() => void)[] = [];

    const terra = () =>
      (client ??= given ?? createTerraConnect({ deepLink: "manual", autoReconnect: false, ...options, chains: options.chains ?? config.chains.map((c) => toTerraChain(c as ViemChainLike)) }));

    function onAccountsChanged(accounts: readonly string[]) {
      if (!accounts.length) onDisconnect();
      else config.emitter.emit("change", { accounts: accounts as readonly `0x${string}`[] });
    }
    function onChainChanged(chainId: number | string) {
      config.emitter.emit("change", { chainId: Number(chainId) });
    }
    function onDisconnect() {
      stopListening();
      config.emitter.emit("disconnect");
    }
    function listen(c: TerraConnect) {
      if (off.length) return;
      off = [c.on("accountsChanged", onAccountsChanged), c.on("chainChanged", onChainChanged), c.on("disconnect", onDisconnect)];
    }
    function stopListening() {
      for (const f of off) f();
      off = [];
    }

    return {
      id: "terraWallet",
      name: "Terra Wallet",
      type: "terraWallet",
      rdns: TERRA_RDNS,
      icon: "https://terrawallet.us/icon.png",
      async connect({ chainId, isReconnecting, withCapabilities } = {}) {
        const c = terra();
        try {
          if (isReconnecting) {
            if (!(await c.reconnect())) throw new Error("Terra Wallet is not connected.");
          } else if (modal && typeof window !== "undefined") {
            const { connectWithModal } = await import("@terrawallet/elements");
            await connectWithModal(c, { theme });
          } else {
            await c.connect();
          }
          listen(c);
          let current = c.getState().chainId ?? config.chains[0].id;
          if (chainId && chainId !== current) current = await c.switchChain(chainId).catch(() => current);
          const accounts = c.getState().accounts;
          return {
            accounts: (withCapabilities ? accounts.map((address) => ({ address, capabilities: {} })) : accounts) as never,
            chainId: current,
          };
        } catch (e) {
          throw toProviderError(e);
        }
      },
      async disconnect() {
        stopListening();
        await terra().disconnect();
      },
      async getAccounts() {
        return terra().getState().accounts;
      },
      async getChainId() {
        return terra().getState().chainId ?? config.chains[0].id;
      },
      async getProvider() {
        return terra().getProvider();
      },
      async isAuthorized() {
        const c = terra();
        return c.getState().status === "connected" || (await c.reconnect());
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find((x) => x.id === chainId);
        if (!chain) throw toProviderError(Object.assign(new Error("This chain is not in your wagmi config."), { code: 4902 }));
        try {
          await terra().switchChain(chainId);
        } catch (e) {
          throw toProviderError(e);
        }
        onChainChanged(chainId);
        return chain;
      },
      onAccountsChanged,
      onChainChanged,
      onDisconnect,
      getTerraClient: () => terra(),
    };
  };
}
