/**
 * <ConnectButton/> and <WalletModal/>. Both render Terra's audited Web Components (closed Shadow DOM), so the
 * button and the security prompts look and behave exactly as on any other site, and app CSS cannot restyle or hide
 * them. Theme them through props or <TerraProvider theme>.
 */
import { createElement, useEffect, useRef, type CSSProperties } from "react";
import type { ConnectResult, TerraConnect } from "@terrawallet/connect";
import { defineTerraElements, openWalletModal, type ThemeMode } from "@terrawallet/elements";
import { useTerraContext } from "./provider.js";

export interface ConnectButtonProps {
  /** Text when disconnected. Default "Connect Terra Wallet". */
  label?: string;
  theme?: ThemeMode;
  /** #rgb, #rrggbb or rgb(). Text colour is picked automatically for AA contrast. */
  accent?: string;
  /** px (0 to 24) or "none" | "sm" | "md" | "lg". */
  radius?: number | "none" | "sm" | "md" | "lg";
  size?: "sm" | "md" | "lg";
  /** Full width. */
  block?: boolean;
  className?: string;
  style?: CSSProperties;
  onConnect?(result: ConnectResult): void;
  onDisconnect?(): void;
}

type ButtonElement = HTMLElement & { client: TerraConnect | null };

export function ConnectButton(props: ConnectButtonProps) {
  const { client, theme } = useTerraContext();
  const ref = useRef<ButtonElement | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.client = client; // set before the element upgrades; it adopts the value (see elements.ts)
    defineTerraElements();
    const onConnect = (e: Event) => handlers.current.onConnect?.((e as CustomEvent<ConnectResult>).detail);
    const onDisconnect = () => handlers.current.onDisconnect?.();
    el.addEventListener("terra-connect", onConnect);
    el.addEventListener("terra-disconnect", onDisconnect);
    return () => {
      el.removeEventListener("terra-connect", onConnect);
      el.removeEventListener("terra-disconnect", onDisconnect);
    };
  }, [client]);

  const mode = props.theme ?? theme?.mode;
  const accent = props.accent ?? theme?.accent;
  const radius = props.radius ?? theme?.radius;
  return createElement("terra-connect-button", {
    ref,
    theme: mode,
    accent,
    radius: radius === undefined ? undefined : String(radius),
    font: theme?.font,
    size: props.size,
    label: props.label,
    block: props.block ? "" : undefined,
    className: props.className,
    style: props.style,
    suppressHydrationWarning: true,
  });
}

export interface WalletModalProps {
  open: boolean;
  onOpenChange?(open: boolean): void;
}

/** Controlled Terra Wallet modal. Renders nothing in place: the dialog lives in the browser's top layer. */
export function WalletModal({ open, onOpenChange }: WalletModalProps) {
  const { client, theme } = useTerraContext();
  const onChange = useRef(onOpenChange);
  onChange.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const handle = openWalletModal(client, { theme });
    void handle.closed.then(() => {
      if (active) onChange.current?.(false);
    });
    return () => {
      active = false;
      handle.close();
    };
  }, [open, client, theme]);
  return null;
}
