/**
 * @terrawallet/react: Terra Wallet for React.
 *
 *   <TerraProvider appName="My dApp" walletConnectProjectId="...">
 *     <ConnectButton />
 *   </TerraProvider>
 *
 * The wagmi connector lives at "@terrawallet/react/wagmi".
 */
export { TerraProvider, useTerraClient, useTerraContext, type TerraProviderProps, type TerraContextValue } from "./provider.js";
export {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useTerraModal,
  useTerraState,
  type UseAccountResult,
  type UseConnectOptions,
} from "./hooks.js";
export { ConnectButton, WalletModal, type ConnectButtonProps, type WalletModalProps } from "./components.js";
export { TerraError, isTerraError, type TerraChain, type TerraConnect, type TerraConnectOptions, type TerraState, type Hex } from "@terrawallet/connect";
