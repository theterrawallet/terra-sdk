/**
 * Widget styles in the Terra Wallet extension's visual language: the same surface tokens (canvas, layer 1-3,
 * hairline borders), brand blue, 14/18/24 px radii, Inter-first type scale and 150-240 ms motion with the
 * extension's sheet curve. Everything lives in closed shadow roots.
 *
 * Contrast (WCAG AA): body text 18.6:1 (dark) / 17:1 (light); muted text 6.6:1 / 5.9:1; the accent text colour
 * is computed per accent in theme.ts; focus rings are checked for 3:1 per mode.
 */

/** Shared tokens and primitives, adopted once per shadow root alongside the component sheet. */
export const TOKENS_CSS = `
.t{--canvas:#060912;--l1:#0C1322;--l2:#111A2E;--l3:#18233C;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--fg:#F5F7FF;--muted:#93A0B8;--faint:#7A86A1;--ok:#2ECC71;--ok-soft:rgba(46,204,113,.14);--warn:#FFB020;--warn-soft:rgba(255,176,32,.12);--neg:#FF6B6B;--neg-soft:rgba(255,92,92,.12);--shadow:0 16px 48px rgba(0,0,0,.55);--card:inset 0 1px 0 rgba(255,255,255,.04),0 8px 24px rgba(0,0,0,.28);--focus:var(--_focus-dark,#5B8BFF);color-scheme:dark;font-family:var(--_font,Inter,"SF Pro Text",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
.t[data-theme=light]{--canvas:#F7F9FC;--l1:#FFFFFF;--l2:#F1F4F9;--l3:#E6EBF4;--line:rgba(11,18,33,.08);--line2:rgba(11,18,33,.14);--fg:#0B1221;--muted:#5B6577;--faint:#6B7588;--ok:#13703D;--ok-soft:rgba(19,112,61,.10);--warn:#965800;--warn-soft:rgba(150,88,0,.10);--neg:#C62828;--neg-soft:rgba(198,40,40,.08);--shadow:0 16px 48px rgba(11,18,33,.18);--card:0 1px 2px rgba(11,18,33,.06),0 4px 14px rgba(11,18,33,.06);--focus:var(--_focus-light,#0A5BFF);color-scheme:light}
@media (prefers-color-scheme:light){.t[data-theme=auto]{--canvas:#F7F9FC;--l1:#FFFFFF;--l2:#F1F4F9;--l3:#E6EBF4;--line:rgba(11,18,33,.08);--line2:rgba(11,18,33,.14);--fg:#0B1221;--muted:#5B6577;--faint:#6B7588;--ok:#13703D;--ok-soft:rgba(19,112,61,.10);--warn:#965800;--warn-soft:rgba(150,88,0,.10);--neg:#C62828;--neg-soft:rgba(198,40,40,.08);--shadow:0 16px 48px rgba(11,18,33,.18);--card:0 1px 2px rgba(11,18,33,.06),0 4px 14px rgba(11,18,33,.06);--focus:var(--_focus-light,#0A5BFF);color-scheme:light}}
*{box-sizing:border-box}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.sr{position:absolute!important;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.spin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes pop{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes push{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;

/** <terra-connect-button> and <terra-pay-button>. */
export const BUTTON_CSS = `
:host{display:inline-block;vertical-align:middle;-webkit-tap-highlight-color:transparent;line-height:normal}
:host([hidden]){display:none}
:host([block]){display:block}
.t{display:inline-flex;flex-direction:column;align-items:center;gap:6px}
:host([block]) .t{display:flex;align-items:stretch}
.btn{all:unset;box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;height:44px;padding:0 18px 0 12px;border-radius:var(--_radius,14px);font:600 15px/20px var(--_font,Inter,"SF Pro Text",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);letter-spacing:-.005em;white-space:nowrap;cursor:pointer;user-select:none;-webkit-user-select:none;transition:transform .15s ease-out,filter .15s ease-out,background-color .15s ease-out,box-shadow .15s ease-out}
.btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.btn:active{transform:scale(.98)}
.btn[disabled],.btn[aria-disabled=true]{cursor:default;opacity:.55;transform:none}
.primary{background:var(--_accent,#0A5BFF) linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,0) 55%);color:var(--_on-accent,#fff);box-shadow:0 8px 22px -8px var(--_ring,rgba(10,91,255,.45)),inset 0 0 0 1px rgba(255,255,255,.14)}
.primary:hover:not([disabled]){filter:brightness(1.08)}
.chip{background:var(--l2);color:var(--fg);border:1px solid var(--line2);padding:0 12px 0 6px;gap:8px;box-shadow:var(--card)}
.chip:hover{background:var(--l3)}
.mark{width:24px;height:24px;border-radius:7px;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.22)}
.ava{position:relative;width:30px;height:30px;border-radius:50%;flex:none}
.ava img{position:absolute;right:-3px;bottom:-3px;width:15px;height:15px;border-radius:50%;box-shadow:0 0 0 2px var(--l2)}
.addr{font:600 14px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.chev{color:var(--muted);margin-left:-2px}
:host([size=sm]) .btn{height:36px;font-size:13px;gap:8px;padding:0 14px 0 9px}
:host([size=sm]) .mark{width:20px;height:20px;border-radius:6px}
:host([size=sm]) .chip{padding:0 10px 0 4px}
:host([size=sm]) .ava{width:26px;height:26px}
:host([size=lg]) .btn{height:52px;font-size:16px;padding:0 22px 0 14px;gap:12px}
:host([size=lg]) .mark{width:28px;height:28px;border-radius:8px}
.note{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:14px;font-weight:500;color:var(--muted);white-space:nowrap}
.note svg{color:var(--ok)}
:host([block]) .note{justify-content:center}
.err{font-size:12px;line-height:16px;color:var(--neg);max-width:320px;text-align:center}
`;

/** The wallet modal: a bottom sheet on phones, a centred card from 641 px. */
export const MODAL_CSS = `
:host{all:initial}
dialog{position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100%;height:100%;max-width:none;max-height:none;overflow:hidden;color:var(--fg)}
dialog:not([open]){display:none}
dialog::backdrop{background:rgba(3,6,14,.62)}
.scrim{position:absolute;inset:0;background:rgba(3,6,14,.0)}
.panel{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;max-height:min(92dvh,92vh);overflow:auto;overscroll-behavior:contain;background:var(--l1);color:var(--fg);border-top:1px solid var(--line2);border-radius:24px 24px 0 0;box-shadow:var(--shadow);padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));animation:sheet .24s cubic-bezier(.32,.72,0,1);font-size:14px;line-height:20px}
.grab{width:36px;height:4px;border-radius:2px;background:var(--line2);margin:0 auto 6px;flex:none}
@media (min-width:641px){.panel{left:50%;top:50%;bottom:auto;right:auto;width:400px;max-height:calc(100vh - 48px);border:1px solid var(--line2);border-radius:24px;transform:translate(-50%,-50%);padding:16px 20px 20px;animation:pop .16s ease-out}.grab{display:none}}
.view{animation:push .2s ease-out}
header{display:flex;align-items:center;gap:10px;min-height:44px}
header .mark{width:32px;height:32px;border-radius:9px;flex:none}
.title{flex:1;min-width:0;margin:0;font-size:18px;line-height:24px;font-weight:700;letter-spacing:-.01em}
.title:focus{outline:none}
.ib{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;color:var(--muted);cursor:pointer;flex:none;transition:background-color .15s}
.ib:hover{background:var(--l2);color:var(--fg)}
.ib:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
.origin{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 12px;border-radius:14px;background:var(--l2);border:1px solid var(--line);font-size:13px;line-height:18px;color:var(--muted)}
.origin svg{flex:none;color:var(--ok)}
.origin b{color:var(--fg);font-weight:600;word-break:break-all}
.origin.warn{background:var(--warn-soft);border-color:transparent}
.origin.warn svg{color:var(--warn)}
.label{margin:16px 2px 8px;font-size:12px;line-height:16px;font-weight:600;color:var(--muted)}
.list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.label+.list{margin-top:0}
.row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:10px 12px;border-radius:16px;background:var(--l2);border:1px solid var(--line);color:var(--fg);cursor:pointer;text-decoration:none;transition:background-color .15s,border-color .15s,transform .15s}
.row:hover{background:var(--l3);border-color:var(--line2)}
.row:active{transform:scale(.99)}
.row:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.row[aria-disabled=true]{cursor:default;opacity:.6;transform:none}
.row.hero{border-color:var(--line2);box-shadow:var(--card)}
.tile{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--l3);color:var(--fg);flex:none}
.tile img{width:40px;height:40px;border-radius:12px}
.txt{display:flex;flex-direction:column;flex:1;min-width:0}
.t1{font-size:15px;line-height:20px;font-weight:600}
.t2{font-size:12px;line-height:16px;color:var(--muted)}
.end{color:var(--muted);flex:none}
.pill{flex:none;font-size:11px;line-height:14px;font-weight:600;padding:4px 8px;border-radius:999px;background:var(--ok-soft);color:var(--ok)}
.skel{height:60px;border-radius:16px;background:linear-gradient(90deg,var(--l2) 0%,var(--l3) 50%,var(--l2) 100%);background-size:200% 100%;animation:shimmer 1.4s linear infinite}
.qrbox{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:12px;padding:16px;border-radius:20px;background:var(--l2);border:1px solid var(--line)}
.qr{display:flex;align-items:center;justify-content:center;width:248px;height:248px;max-width:100%;border-radius:18px;background:#fff;padding:8px;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.qr svg{width:100%;height:100%}
.qr .ph{width:100%;height:100%;border-radius:12px;background:linear-gradient(90deg,#eef1f6 0%,#dfe5ee 50%,#eef1f6 100%);background-size:200% 100%;animation:shimmer 1.4s linear infinite}
.hint{margin:0;font-size:13px;line-height:18px;color:var(--muted);text-align:center;max-width:300px}
.btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 16px;border-radius:var(--_radius,14px);font-weight:600;font-size:15px;line-height:20px;cursor:pointer;text-align:center;user-select:none;transition:transform .15s ease-out,filter .15s ease-out,background-color .15s}
.btn:active{transform:scale(.98)}
.btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.btn[disabled]{opacity:.55;cursor:default;transform:none}
.btn .mark{width:22px;height:22px;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.22)}
.btn.sm{height:36px;font-size:13px;padding:0 12px;border-radius:999px}
.primary{background:var(--_accent,#0A5BFF) linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,0) 55%);color:var(--_on-accent,#fff);box-shadow:0 8px 22px -8px var(--_ring,rgba(10,91,255,.45)),inset 0 0 0 1px rgba(255,255,255,.14)}
.primary:hover:not([disabled]){filter:brightness(1.08)}
.secondary{background:var(--l2);color:var(--fg);border:1px solid var(--line2)}
.secondary:hover{background:var(--l3)}
.danger{background:var(--neg-soft);color:var(--neg);border:1px solid var(--neg-soft)}
.danger:hover{filter:brightness(1.1)}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
.actions.one{grid-template-columns:1fr}
.state{display:flex;flex-direction:column;align-items:center;text-align:center;padding:16px 4px 4px}
.state h3{margin:16px 0 4px;font-size:18px;line-height:24px;font-weight:700}
.state p{margin:0;color:var(--muted);max-width:310px}
.ring{position:relative;display:flex;align-items:center;justify-content:center;width:80px;height:80px}
.ring::before{content:"";position:absolute;inset:0;border-radius:50%;border:3px solid var(--line2);border-top-color:var(--_accent,#0A5BFF);animation:spin .9s linear infinite}
.ring img{width:54px;height:54px;border-radius:15px}
.badge-tile{display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:16px;background:var(--neg-soft);color:var(--neg)}
.acct{display:flex;align-items:center;gap:12px;margin-top:12px;padding:14px;border-radius:18px;background:var(--l2);border:1px solid var(--line);box-shadow:var(--card)}
.acct .ava{position:relative;width:44px;height:44px;border-radius:50%;flex:none}
.acct .ava img{position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border-radius:50%;box-shadow:0 0 0 2px var(--l2)}
.addr{font:600 15px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.nets{display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:16px;background:var(--l2);border:1px solid var(--line);max-height:236px;overflow:auto}
.net{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 10px;border-radius:12px;font-size:14px;font-weight:500;cursor:pointer;color:var(--fg)}
.net:hover{background:var(--l3)}
.net:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.net[aria-current=true]{background:var(--_accent-soft,rgba(10,91,255,.14))}
.net .end{margin-left:auto;color:var(--fg)}
.logo{width:24px;height:24px;border-radius:50%;flex:none}
.mono{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--l3);color:var(--muted);font-size:11px;font-weight:700;flex:none}
.foot{display:flex;align-items:flex-start;gap:8px;margin-top:16px;padding:10px 12px;border-radius:14px;background:var(--l2);color:var(--muted);font-size:12px;line-height:16px}
.foot svg{flex:none;color:var(--ok);margin-top:0}
.inline-err{margin:8px 2px 0;font-size:12px;line-height:16px;color:var(--neg)}
.link{all:unset;cursor:pointer;color:var(--fg);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.link:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
`;
