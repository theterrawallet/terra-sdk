// Page logic, kept out of inline scripts so the page runs under a strict CSP (script-src 'self').
const status = document.getElementById("status");
const say = (text) => (status.textContent = text);

document.addEventListener("terra-connect", (e) => say(`Connected ${e.detail.address} on chain ${e.detail.chainId}.`));
document.addEventListener("terra-disconnect", () => say("Disconnected."));
document.addEventListener("terra-pay-success", () => say("Payment sent. Your server confirms the order from the webhook."));
document.addEventListener("terra-pay-cancel", () => say("Checkout closed."));
document.addEventListener("terra-pay-expire", () => say("The quote expired. Try again."));
document.addEventListener("terra-pay-error", (e) => say(`Checkout error: ${e.detail.message}`));
