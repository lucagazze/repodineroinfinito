/**
 * CSS del checkout.
 *
 * Los valores salen medidos del checkout de referencia que ya convierte
 * (fondo #f0f0f0, botón de pagar #005bd1 radio 12, bumps con borde de 2 px,
 * badge pegado a la esquina). Va como string en un <style> porque hacen
 * falta media queries y estados, que no se pueden poner inline.
 */
export const CHECKOUT_CSS = `
.ck { --ink:#171717; --ink2:#1e293b; --muted:#6b7280; --line:#e5e7eb; --field:#d1d5db;
  --pay:#005bd1; --navy:#1f2937; --ok:#16a34a;
  min-height:100dvh; background:#f0f0f0; color:var(--ink); -webkit-font-smoothing:antialiased; }
.ck * { box-sizing:border-box; }

.ck-social { background:#171717; color:#fff; text-align:center; padding:9px 12px;
  font-size:12px; font-weight:500; display:flex; align-items:center; justify-content:center; gap:7px; }
.ck-social svg { opacity:.85 }
.ck-dot { width:7px; height:7px; border-radius:4px; background:#22c55e; animation:ckPulse 2s infinite; }
@keyframes ckPulse { 0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)} 70%{box-shadow:0 0 0 6px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }

.ck-wrap { max-width:960px; margin:0 auto; padding:28px 20px 40px; }
.ck-grid { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:32px; align-items:start; }
.ck-left, .ck-right { display:flex; flex-direction:column; gap:22px; min-width:0; }
.ck-right { position:sticky; top:20px; gap:16px; }

.ck-h { display:flex; align-items:center; gap:9px; margin:0 0 14px; font-size:21px; font-weight:600;
  color:var(--ink2); letter-spacing:-.01em; }
.ck-h svg { color:#64748b; flex-shrink:0 }

.ck-label { display:block; font-size:14px; font-weight:500; margin:0 0 6px; color:#374151; }
.ck-input { width:100%; padding:12px 16px; font-size:14px; border-radius:8px; border:1px solid var(--field);
  background:#fff; color:var(--ink); font-family:inherit; transition:border-color .15s, box-shadow .15s; }
.ck-input::placeholder { color:#9ca3af }
.ck-input:focus { outline:none; border-color:var(--pay); box-shadow:0 0 0 3px rgba(0,91,209,.15); }
.ck-help { font-size:13px; color:var(--muted); margin:6px 0 16px; }
.ck-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.ck-b2, .ck-bump { cursor:pointer; -webkit-tap-highlight-color:transparent; user-select:none; }
.ck-b2:focus-visible, .ck-bump:focus-visible { outline:2px solid var(--pay); outline-offset:2px; }


.ck-or { display:flex; align-items:center; gap:10px; margin:14px 0; font-size:12.5px; color:var(--muted); }
.ck-or::before, .ck-or::after { content:""; flex:1; height:1px; background:#dcdcdc; }
.ck-paycard { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; }

.ck-pay { width:100%; height:56px; border:0; border-radius:12px; background:var(--pay); color:#fff;
  font-size:16px; font-weight:700; font-family:inherit; cursor:pointer; letter-spacing:-.005em;
  transition:filter .15s, transform .08s; display:flex; align-items:center; justify-content:center; gap:8px; }
.ck-pay:hover:not(:disabled) { filter:brightness(1.08) }
.ck-pay:active:not(:disabled) { transform:translateY(1px) }
.ck-pay:disabled { opacity:.65; cursor:default }
.ck-spin { width:16px; height:16px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff;
  border-radius:50%; animation:ckSpin .7s linear infinite; }
@keyframes ckSpin { to { transform:rotate(360deg) } }
.ck-err { margin:10px 0 0; font-size:13.5px; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca;
  padding:10px 12px; border-radius:8px; }
.ck-secure { display:flex; align-items:center; justify-content:center; gap:6px; margin:12px 0 0;
  font-size:12.5px; color:var(--muted); }

.ck-guar { width:100%; max-width:640px; height:auto; border-radius:14px; display:block; margin:0 auto; }

/* ---- bumps ---- */
.ck-bumps { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px 14px 16px; }
.ck-bumpTitle { margin:0; text-align:center; font-size:11px; font-weight:700; letter-spacing:.06em; color:#b45309; }
.ck-timer { margin:8px 0 12px; display:flex; align-items:center; justify-content:center; gap:6px;
  font-size:11px; font-weight:700; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca;
  border-radius:8px; padding:6px 10px; font-variant-numeric:tabular-nums; }
.ck-timer b { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:700 }
.ck-bumpList { display:grid; gap:10px; }
.ck-bump { position:relative; background:#fff; border:2px solid var(--line); border-radius:10px;
  padding:18px 12px 12px; display:flex; gap:12px; transition:border-color .15s, background .15s; }
.ck-bump.on { border-color:var(--ok); background:#f0fdf4; }
.ck-off { position:absolute; top:0; right:0; background:#dc2626; color:#fff; font-size:10px; font-weight:700;
  padding:2px 8px; border-radius:0 8px 0 8px; }
.ck-bumpImg { width:64px; height:82px; object-fit:contain; border-radius:6px; flex-shrink:0; background:#fafafa; }
.ck-bumpBody { min-width:0; flex:1; }
.ck-bumpName { margin:0; font-size:13px; font-weight:600; line-height:1.35; color:var(--ink); }
.ck-bumpPrice { margin:5px 0 0; font-size:12.5px; }
.ck-bumpPrice s { color:#9ca3af; margin-right:6px; }
.ck-bumpPrice b { color:var(--ok); font-weight:700; }
.ck-bumpDesc { margin:6px 0 0; font-size:11.5px; line-height:1.45; color:var(--muted); }
.ck-bumpBtn { margin-top:9px; border:0; border-radius:6px; padding:8px 10px; background:var(--navy); color:#fff;
  font-size:12px; font-weight:700; font-family:inherit; cursor:pointer; transition:filter .15s; }
.ck-bumpBtn:hover:not(:disabled) { filter:brightness(1.25) }
.ck-bumpBtn.on { background:var(--ok) }
.ck-bumpBtn:disabled { opacity:.6; cursor:default }

/* ---- resumen ---- */
.ck-sum { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.ck-sumHead { width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:16px 18px;
  background:none; border:0; font-family:inherit; cursor:default; text-align:left; }
.ck-sumHead span { font-size:15px; font-weight:600; color:var(--ink2); display:flex; align-items:center; gap:6px; }
.ck-sumHead strong { font-size:18px; font-weight:600; color:#111827; }
.ck-sumHead svg { display:none }
.ck-sumBody { padding:0 18px 16px; border-top:1px solid #f1f1f1; }
.ck-line { display:flex; gap:10px; align-items:flex-start; padding-top:14px; font-size:13.5px; }
.ck-line img { width:46px; height:58px; object-fit:contain; border-radius:5px; background:#fafafa; flex-shrink:0; }
.ck-line span { flex:1; line-height:1.4; }
.ck-line b { white-space:nowrap; font-weight:600; }
.ck-free { margin:14px 0 8px; font-size:11px; font-weight:700; letter-spacing:.05em; color:#b45309; display:flex; gap:6px; align-items:center; }
.ck-freeRow { display:flex; align-items:center; gap:8px; font-size:12.5px; color:#4b5563; padding:3px 0; }
.ck-freeRow span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ck-freeRow s { color:#9ca3af }
.ck-badge { background:#22c55e; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; }
.ck-total { border-top:1px solid var(--line); margin-top:14px; padding-top:12px; }
.ck-total .row { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; color:var(--muted); }
.ck-total .big { margin:2px 0 0; text-align:right; font-size:22px; font-weight:700; color:#111827; }
.ck-total .save { margin:2px 0 0; text-align:right; font-size:13px; font-weight:600; color:var(--ok); }

.ck-foot { text-align:center; font-size:12px; color:var(--muted); line-height:1.75; margin-top:34px; }
.ck-foot b { color:#374151; font-weight:600 }
.ck-foot a { color:var(--muted); cursor:pointer }

/* Hoja de políticas encima del checkout. */
.ck-pol { position:fixed; inset:0; z-index:60; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; padding:24px; }
.ck-polCard { width:100%; max-width:760px; height:min(86dvh,900px); background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.3); display:flex; flex-direction:column; }
.ck-polBar { flex:none; display:flex; justify-content:flex-end; padding:8px 10px; border-bottom:1px solid #e5e7eb; background:#fff; }
.ck-polCard iframe { flex:1; width:100%; border:0; display:block; }
.ck-polX { width:36px; height:36px; border-radius:18px; border:0; background:#111827; color:#fff; font-size:22px; line-height:1; cursor:pointer; }
@media (max-width:640px) { .ck-pol { padding:0; } .ck-polCard { max-width:none; height:100dvh; border-radius:0; } }

.ck-skel { height:520px; border-radius:12px;
  background:linear-gradient(90deg,#e9e9e9 25%,#f3f3f3 37%,#e9e9e9 63%); background-size:400% 100%;
  animation:ckShine 1.4s ease infinite; }
@keyframes ckShine { 0%{background-position:100% 50%} 100%{background-position:0 50%} }

/* ---- celular: el mismo orden que la plataforma anterior ----
   datos → método de pago → bumps → pagar → garantía → resumen plegable */
@media (max-width: 860px) {
  .ck-wrap { padding:18px 16px 32px; }
  /* stretch explícito: el align-items:start de la grilla de PC achicaba el
     botón de pagar y el resumen al ancho de su contenido. */
  .ck-grid { display:flex; flex-direction:column; align-items:stretch; gap:20px; }
  .ck-left, .ck-right { display:contents; }
  .o-data { order:1 } .o-method { order:2 } .o-bumps { order:3 } .o-pay { order:4 }
  .o-guar { order:5 } .o-sum { order:6 }
  .ck-h { font-size:20px; }
  .ck-sumHead { cursor:pointer; }
  .ck-sumHead span { color:#2563eb; font-weight:500; font-size:14px; }
  .ck-sumHead svg { display:block; transition:transform .2s; }
  .ck-sum[data-open="false"] .ck-sumBody { display:none; }
  .ck-sum[data-open="true"] .ck-sumHead svg { transform:rotate(180deg); }
}
`;
