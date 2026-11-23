/**
 * Checkout overlay styles, in the browser extension's visual language (same tokens: canvas, layers, lines,
 * brand blue, 14/18/24 px radii, 160-240 ms motion). Lives in a closed shadow root, so host CSS cannot reach it.
 */
export const CHECKOUT_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.t{--canvas:#060912;--l1:#0C1322;--l2:#111A2E;--l3:#18233C;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--fg:#F5F7FF;--muted:#93A0B8;--brand:#0A5BFF;--brand2:#5B8BFF;--ok:#2ECC71;--shadow:0 16px 48px rgba(0,0,0,.55);color-scheme:dark}
.t[data-theme=light]{--canvas:#F7F9FC;--l1:#fff;--l2:#F1F4F9;--l3:#E6EBF4;--line:rgba(11,18,33,.08);--line2:rgba(11,18,33,.14);--fg:#0B1221;--muted:#5B6577;--brand2:#0A5BFF;--ok:#13703D;--shadow:0 16px 48px rgba(11,18,33,.18);color-scheme:light}
@media (prefers-color-scheme:light){.t[data-theme=auto]{--canvas:#F7F9FC;--l1:#fff;--l2:#F1F4F9;--l3:#E6EBF4;--line:rgba(11,18,33,.08);--line2:rgba(11,18,33,.14);--fg:#0B1221;--muted:#5B6577;--brand2:#0A5BFF;--ok:#13703D;--shadow:0 16px 48px rgba(11,18,33,.18);color-scheme:light}}
dialog{position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;overflow:hidden;font:14px/20px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
dialog::backdrop{background:rgba(3,6,14,.62)}
dialog:not([open]){display:none}
.scrim{position:absolute;inset:0}
.panel{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;height:min(92dvh,92vh);background:var(--l1);color:var(--fg);border-top:1px solid var(--line2);border-radius:24px 24px 0 0;box-shadow:var(--shadow);overflow:hidden;animation:sheet .24s cubic-bezier(.32,.72,0,1)}
.card{position:absolute;left:16px;right:16px;bottom:16px;padding:20px;background:var(--l1);color:var(--fg);border:1px solid var(--line2);border-radius:24px;box-shadow:var(--shadow);animation:sheet .24s cubic-bezier(.32,.72,0,1)}
@media (min-width:641px){
.panel{left:50%;top:50%;bottom:auto;width:440px;height:min(720px,calc(100vh - 48px));border:1px solid var(--line2);border-radius:24px;transform:translate(-50%,-50%);animation:pop .16s ease-out}
.card{left:50%;top:50%;bottom:auto;right:auto;width:380px;transform:translate(-50%,-50%);animation:pop .16s ease-out}
}
.bar{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--line);background:var(--l1)}
.lock{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;background:rgba(46,204,113,.12);color:var(--ok);flex:none}
.who{display:flex;flex-direction:column;min-width:0;flex:1}
.who strong{font-size:14px;line-height:18px;font-weight:600}
.origin{font-size:12px;line-height:16px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{all:unset;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;color:var(--muted);cursor:pointer;flex:none}
.x:hover{background:var(--l2);color:var(--fg)}
.x:focus-visible,.btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(91,139,255,.45)}
.frame{position:relative;flex:1;background:var(--canvas)}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}
.loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:13px}
.loading[hidden]{display:none}
.spin{width:28px;height:28px;border-radius:50%;border:2.5px solid var(--line2);border-top-color:var(--brand2);animation:spin .8s linear infinite}
h2{margin:12px 0 4px;font-size:18px;line-height:24px;font-weight:700;letter-spacing:-.01em}
p{margin:0;color:var(--muted)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px}
.btn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 16px;border-radius:14px;font-weight:600;font-size:14px;cursor:pointer;text-align:center;transition:transform .15s ease-out,filter .15s ease-out}
.btn:active{transform:scale(.98)}
.primary{background:linear-gradient(135deg,#0A5BFF 0%,#5B8BFF 100%);color:#fff;box-shadow:0 8px 22px rgba(10,91,255,.38)}
.primary:hover{filter:brightness(1.1)}
.secondary{background:var(--l2);color:var(--fg);border:1px solid var(--line2)}
.secondary:hover{background:var(--l3)}
@keyframes sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes pop{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation-duration:1ms!important;transition-duration:1ms!important}}
`;

export const BUTTON_CSS = `
:host{all:initial;display:inline-block;vertical-align:middle}
*{box-sizing:border-box}
button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:var(--terra-radius,14px);font:600 15px/20px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;background:linear-gradient(135deg,#0A5BFF 0%,#5B8BFF 100%);box-shadow:0 8px 22px rgba(10,91,255,.32);cursor:pointer;transition:transform .15s ease-out,filter .15s ease-out;-webkit-font-smoothing:antialiased}
button:hover{filter:brightness(1.1)}
button:active{transform:scale(.98)}
button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(91,139,255,.45)}
button[disabled]{opacity:.5;cursor:default}
@media (prefers-reduced-motion:reduce){button{transition:none}}
`;
