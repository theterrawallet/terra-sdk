/**
 * React hooks over the Terra Connect client. State hooks use useSyncExternalStore (tear-free, SSR safe: the server
 * snapshot is "disconnected"). Action hooks follow the wagmi convention: `x()` fires and keeps errors in state,
 * `xAsync()` returns a promise that rejects with a typed TerraError.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  INITIAL_STATE,
  getChain,
  toTerraError,
  type ConnectOptions,
  type ConnectResult,
  type Hex,
  type SignableMessage,
  type TerraChain,
  type TerraError,
  type TerraState,
  type TransactionRequest,
} from "@terrawallet/connect";
import { closeWalletModal, connectWithModal, openWalletModal } from "@terrawallet/elements";
import { useTerraContext } from "./provider.js";

const serverSnapshot = () => INITIAL_STATE;

/** The raw connection state. */
export function useTerraState(): TerraState {
  const { client } = useTerraContext();
  return useSyncExternalStore(client.subscribe, client.getState, serverSnapshot);
}

export interface UseAccountResult {
  address: Hex | undefined;
  addresses: readonly Hex[];
  chainId: number | undefined;
  chain: TerraChain | undefined;
  status: TerraState["status"];
  connector: TerraState["connector"] | undefined;
  solanaAddress: string | undefined;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isDisconnected: boolean;
}

export function useAccount(): UseAccountResult {
  const { client } = useTerraContext();
  const s = useTerraState();
  return useMemo(
    () => ({
      address: s.address ?? undefined,
      addresses: s.accounts,
      chainId: s.chainId ?? undefined,
      chain: s.chainId ? getChain(s.chainId, client.chains) : undefined,
      status: s.status,
      connector: s.connector ?? undefined,
      solanaAddress: s.solanaAddress ?? undefined,
      isConnected: s.status === "connected",
      isConnecting: s.status === "connecting",
      isReconnecting: s.status === "reconnecting",
      isDisconnected: s.status === "disconnected",
    }),
    [s, client],
  );
}

export function useChainId(): number | undefined {
  return useTerraState().chainId ?? undefined;
}

interface ActionState<R> {
  data: R | undefined;
  error: TerraError | null;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [st, setSt] = useState<{ data: R | undefined; error: TerraError | null; isPending: boolean }>({ data: undefined, error: null, isPending: false });
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runAsync = useCallback(async (...args: A): Promise<R> => {
    setSt((p) => ({ ...p, isPending: true, error: null }));
    try {
      const data = await fnRef.current(...args);
      if (mounted.current) setSt({ data, error: null, isPending: false });
      return data;
    } catch (e) {
      const error = toTerraError(e);
      if (mounted.current) setSt({ data: undefined, error, isPending: false });
      throw error;
    }
  }, []);
  const run = useCallback((...args: A) => void runAsync(...args).catch(() => {}), [runAsync]);
  const reset = useCallback(() => setSt({ data: undefined, error: null, isPending: false }), []);
  const state: ActionState<R> = { ...st, isSuccess: st.data !== undefined && !st.error, isError: !!st.error };
  return { state, run, runAsync, reset };
}

export interface UseConnectOptions {
  /**
   * true (default): open the Terra Wallet modal (extension, QR code, app deep link, install links).
   * false: connect headlessly (the extension when present, else WalletConnect).
   */
  modal?: boolean;
}

export function useConnect(opts: UseConnectOptions = {}) {
  const { client, theme } = useTerraContext();
  const useModal = opts.modal !== false;
  const { state, run, runAsync, reset } = useAction((o?: ConnectOptions): Promise<ConnectResult> =>
    useModal && typeof window !== "undefined" && !o?.method ? connectWithModal(client, { theme }) : client.connect(o),
  );
  return { connect: run, connectAsync: runAsync, reset, ...state };
}

export function useDisconnect() {
  const { client } = useTerraContext();
  const { state, run, runAsync, reset } = useAction(() => client.disconnect());
  return { disconnect: run, disconnectAsync: runAsync, reset, ...state };
}

export function useSwitchChain() {
  const { client } = useTerraContext();
  const { state, run, runAsync, reset } = useAction((p: { chainId: number }) => client.switchChain(p.chainId));
  return { switchChain: run, switchChainAsync: runAsync, chains: client.chains, reset, ...state };
}

export function useSignMessage() {
  const { client } = useTerraContext();
  const { state, run, runAsync, reset } = useAction((p: { message: SignableMessage }) => client.signMessage(p.message));
  return { signMessage: run, signMessageAsync: runAsync, reset, ...state };
}

export function useSignTypedData() {
  const { client } = useTerraContext();
  const { state, run, runAsync, reset } = useAction((typedData: object) => client.signTypedData(typedData));
  return { signTypedData: run, signTypedDataAsync: runAsync, reset, ...state };
}

/** `data` is the transaction hash once the wallet has sent it. */
export function useSendTransaction() {
  const { client } = useTerraContext();
  const { state, run, runAsync, reset } = useAction((tx: TransactionRequest) => client.sendTransaction(tx));
  return { sendTransaction: run, sendTransactionAsync: runAsync, reset, ...state };
}

/** Opens or closes the Terra Wallet modal (connect when disconnected, account view when connected). */
export function useTerraModal() {
  const { client, theme } = useTerraContext();
  return useMemo(
    () => ({
      open: () => {
        openWalletModal(client, { theme });
      },
      close: () => closeWalletModal(),
    }),
    [client, theme],
  );
}
