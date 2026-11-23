/** Test doubles: an injected Terra Wallet (EIP-1193 + EIP-6963) and a WalletConnect sign client. */
import { randomBytes } from "node:crypto";

export const ADDRESS = `0x${"ab".repeat(20)}` as const;
export const ADDRESS_2 = `0x${"cd".repeat(20)}` as const;

type Listener = (...a: any[]) => void;

export function fakeInjectedWallet(win: EventTarget, opts: { chainId?: string; reject?: boolean } = {}) {
  const calls: { method: string; params?: any }[] = [];
  const listeners: Record<string, Listener[]> = {};
  let chainId = opts.chainId ?? "0x1";
  let authorized = false;
  const emit = (event: string, data: unknown) => (listeners[event] ?? []).slice().forEach((cb) => cb(data));
  const provider = {
    isTerraWallet: true,
    rejectNext: opts.reject ?? false,
    async request({ method, params }: { method: string; params?: any }) {
      calls.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
          if (provider.rejectNext) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          authorized = true;
          return [ADDRESS];
        case "eth_accounts":
          return authorized ? [ADDRESS] : [];
        case "eth_chainId":
          return chainId;
        case "wallet_switchEthereumChain": {
          const id = params[0].chainId as string;
          if (id === "0xfa2") throw Object.assign(new Error("Unrecognized chain ID."), { code: 4902 });
          chainId = id;
          emit("chainChanged", id);
          return null;
        }
        case "wallet_addEthereumChain":
          chainId = params[0].chainId;
          emit("chainChanged", chainId);
          return null;
        case "personal_sign":
          return `0x${"11".repeat(65)}`;
        case "eth_signTypedData_v4":
          return `0x${"33".repeat(65)}`;
        case "eth_sendTransaction":
          return `0x${"22".repeat(32)}`;
        case "wallet_revokePermissions":
          authorized = false;
          return null;
      }
      throw Object.assign(new Error("Unsupported method"), { code: 4200 });
    },
    on(event: string, cb: Listener) {
      (listeners[event] ??= []).push(cb);
    },
    removeListener(event: string, cb: Listener) {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
    },
  };
  win.addEventListener("eip6963:requestProvider", () =>
    win.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: { uuid: "b8d1f4c2-1a2b-4c3d-9e4f-7e7211c0d301", name: "Terra Wallet", icon: "data:,", rdns: "com.terrawallet.app" }, provider }),
      }),
    ),
  );
  return {
    provider,
    calls,
    emit,
    authorize: () => (authorized = true),
    listenerCount: (e: string) => (listeners[e] ?? []).length,
  };
}

export const randomProjectId = () => randomBytes(16).toString("hex");
export const TOPIC = "f".repeat(64);
export const PAIRING_URI = `wc:${"e".repeat(64)}@2?expiryTimestamp=1999999999&relay-protocol=irn&symKey=${"9".repeat(64)}`;

export function fakeSignClient() {
  const handlers: Record<string, Listener[]> = {};
  const state = {
    initOpts: null as any,
    namespaces: null as any,
    requests: [] as any[],
    disconnects: [] as any[],
    sessions: [] as any[],
    approve: (_s: any) => {},
    reject: (_e: any) => {},
    respond: (_req: any): any => null,
  };
  const client = {
    on(event: string, cb: Listener) {
      (handlers[event] ??= []).push(cb);
    },
    emit(event: string, args: unknown) {
      (handlers[event] ?? []).forEach((cb) => cb(args));
    },
    async connect(p: { optionalNamespaces: any; requiredNamespaces?: any }) {
      state.namespaces = p;
      let resolve!: (s: any) => void;
      let reject!: (e: any) => void;
      const approved = new Promise<any>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      state.approve = (s) => {
        state.sessions.push(s);
        resolve(s);
      };
      state.reject = reject;
      return { uri: PAIRING_URI, approval: () => approved };
    },
    async request(p: any) {
      state.requests.push(p);
      client.emit("session_request_sent", { topic: p.topic, id: 1763884800123, chainId: p.chainId, request: p.request });
      return state.respond(p);
    },
    async disconnect(p: any) {
      state.disconnects.push(p);
    },
    session: { getAll: () => state.sessions },
  };
  const loader = async () => ({
    SignClient: {
      async init(opts: any) {
        state.initOpts = opts;
        return client;
      },
    },
  });
  const session = (opts: { chains?: number[]; solana?: string } = {}) => ({
    topic: TOPIC,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    namespaces: {
      eip155: {
        chains: (opts.chains ?? [1, 8453]).map((c) => `eip155:${c}`),
        accounts: (opts.chains ?? [1, 8453]).map((c) => `eip155:${c}:${ADDRESS}`),
        methods: ["personal_sign", "eth_sendTransaction"],
        events: ["chainChanged", "accountsChanged"],
      },
      ...(opts.solana ? { solana: { accounts: [`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${opts.solana}`], methods: [], events: [] } } : {}),
    },
  });
  return { client, state, loader, session };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until cond() holds (polling), instead of a fixed sleep: the WalletConnect connector is a lazy dynamic
 * import, which can take longer than a fixed delay on a busy CI runner.
 */
export async function until(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error("until(): condition not met in time");
    await tick(5);
  }
}
