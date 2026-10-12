/**
 * CSS del catálogo público. Mobile-first: perfecto a 390 px, sin scroll
 * horizontal. El color de marca entra por variables en el contenedor
 * (--accent, --on-accent, --accent-text), ya saneadas en el servidor.
 */
export const CATALOG_CSS = `
.cat{--accent:#1e293b;--on-accent:#fff;--accent-text:#1e293b;--ink:#0f172a;--muted:#475569;--soft:#64748b;
  --line:#e2e8f0;--bg:#f8fafc;--body:#334155;
  min-height:100dvh;background:var(--bg);color:var(--ink);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  overflow-wrap:break-word;overflow-x:clip}
.cat *,.cat *::before,.cat *::after{box-sizing:border-box}
.cat img{max-width:100%;display:block}
.cat a{color:inherit}
.cat a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.cat-wrap{max-width:1120px;margin:0 auto;padding-left:16px;padding-right:16px}
@media(min-width:640px){.cat-wrap{padding-left:24px;padding-right:24px}}

/* ---- header ---- */
.cat-top{background:#fff;border-bottom:1px solid var(--line)}
.cat-topin{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding-top:14px;padding-bottom:10px}
.cat-brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700;font-size:17px;
  letter-spacing:-.01em;color:var(--ink);flex:1 1 auto;min-width:0}
.cat-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cat-mono{width:32px;height:32px;border-radius:9px;background:var(--accent);color:var(--on-accent);display:grid;
  place-items:center;font-size:15px;font-weight:700;flex:none;text-transform:uppercase}
.cat-logo{height:34px;width:auto;max-width:180px;object-fit:contain}
.cat-lang{display:flex;gap:2px;order:2;flex:none}
.cat-lang a{font-size:12px;font-weight:600;letter-spacing:.04em;text-decoration:none;color:var(--soft);
  padding:4px 8px;border-radius:6px;border:1px solid transparent;line-height:1.4}
.cat-lang a:hover{color:var(--ink)}
.cat-lang a[aria-current]{color:var(--ink);border-color:var(--line);background:var(--bg)}
.cat-nav{order:3;flex-basis:100%;display:flex;flex-wrap:wrap;gap:0 2px;margin:0 -7px}
.cat-nav a{font-size:14px;color:var(--muted);text-decoration:none;padding:6px 7px;border-radius:7px;white-space:nowrap}
.cat-nav a:hover{color:var(--ink);background:var(--bg)}
.cat-nav a[aria-current="page"]{color:var(--ink);font-weight:600}
@media(min-width:900px){
  .cat-topin{flex-wrap:nowrap;padding-top:16px;padding-bottom:16px}
  .cat-nav{order:2;flex-basis:auto;margin:0;gap:2px}
  .cat-nav a{padding:6px 10px}
  .cat-lang{order:3;margin-left:6px;padding-left:12px;border-left:1px solid var(--line)}
}

/* ---- hero ---- */
.cat-hero{background:#fff;border-bottom:1px solid var(--line)}
.cat-herogrid{display:grid;gap:28px;padding-top:36px;padding-bottom:40px}
@media(min-width:900px){.cat-herogrid{grid-template-columns:minmax(0,1fr) 340px;gap:56px;padding-top:64px;padding-bottom:68px;align-items:start}}
.cat-eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-text);margin:0 0 12px}
.cat-h1{font-size:clamp(30px,7.2vw,46px);line-height:1.1;letter-spacing:-.025em;font-weight:800;margin:0 0 18px;color:var(--ink);text-wrap:balance}
.cat-about p{margin:0 0 14px;color:var(--body);max-width:68ch;font-size:16.5px}
.cat-about p.cat-leadp{font-size:18px;color:var(--muted)}
.cat-who{margin:0 0 14px;color:var(--body);max-width:68ch}
.cat-who strong{color:var(--ink)}
.cat-op{font-size:13.5px;color:var(--soft);margin:18px 0 0;max-width:68ch}
.cat-op strong{color:var(--muted);font-weight:600}
.cat-cta{display:inline-flex;align-items:center;gap:8px;margin-top:24px;height:46px;padding:0 20px;border-radius:10px;
  background:var(--accent);color:var(--on-accent)!important;text-decoration:none;font-weight:600;font-size:15px}
.cat-cta:hover,.cat-btn:hover{filter:brightness(1.15)}
.cat-facts{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:20px;margin:0;list-style:none;display:grid;gap:14px}
.cat-facts li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:var(--body);line-height:1.45;min-width:0}
.cat-facts li>span{min-width:0}
.cat-facts svg{flex:none;color:var(--accent-text);margin-top:1px}
.cat-facts a{color:var(--accent-text);font-weight:600;text-decoration:none;overflow-wrap:anywhere}

/* ---- secciones ---- */
.cat-sec{padding-top:48px;padding-bottom:8px;scroll-margin-top:12px}
.cat-panel{scroll-margin-top:12px}
.cat-sec:last-of-type{padding-bottom:56px}
@media(min-width:900px){.cat-sec{padding-top:72px}.cat-sec:last-of-type{padding-bottom:80px}}
.cat-h2{font-size:clamp(24px,5vw,30px);line-height:1.2;letter-spacing:-.02em;font-weight:750;margin:0 0 10px;color:var(--ink)}
.cat-sub{color:var(--muted);margin:0 0 18px;max-width:68ch}
.cat-note{display:flex;gap:10px;align-items:flex-start;background:#fffbeb;border:1px solid #fde68a;color:#78350f;
  border-radius:10px;padding:10px 14px;font-size:14px;line-height:1.5;margin:0 0 28px;max-width:760px}
.cat-note svg{flex:none;margin-top:2px}
.cat-empty{background:#fff;border:1px dashed #cbd5e1;border-radius:14px;padding:28px;color:var(--muted);text-align:center}

/* ---- productos ---- */
.cat-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
@media(min-width:640px){.cat-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}
@media(min-width:960px){.cat-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}}
.cat-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;display:grid;
  grid-template-columns:100px minmax(0,1fr);min-width:0}
.cat-media{position:relative;background:#f1f5f9;aspect-ratio:3/4;align-self:start;overflow:hidden}
.cat-media img,.cat-media .cat-ph{position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px);object-fit:contain}
.cat-ph{display:grid;place-items:center;font-size:28px;font-weight:700;color:#94a3b8;text-transform:uppercase}
.cat-body{padding:14px 14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
@media(min-width:640px){
  .cat-card{display:flex;flex-direction:column}
  .cat-media{aspect-ratio:4/3;align-self:stretch}
  .cat-media img,.cat-media .cat-ph{inset:18px;width:calc(100% - 36px);height:calc(100% - 36px)}
  .cat-body{padding:18px 18px 20px;flex:1}
}
.cat-label{align-self:flex-start;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:3px 8px;border-radius:999px;background:#f1f5f9;color:#334155;line-height:1.4;max-width:100%}
.cat-card[data-kind=addon] .cat-label{background:#fef3c7;color:#92400e}
.cat-card[data-kind=after] .cat-label{background:#ede9fe;color:#5b21b6}
.cat-card[data-kind=bonus] .cat-label{background:#dcfce7;color:#166534}
.cat-name{font-size:15.5px;line-height:1.35;font-weight:650;margin:2px 0 0;color:var(--ink)}
.cat-desc{font-size:14px;line-height:1.5;color:var(--muted);margin:0}
.cat-buy{margin-top:auto;padding-top:10px;display:flex;flex-direction:column;gap:10px}
.cat-price{margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px}
.cat-price strong{font-size:20px;font-weight:750;letter-spacing:-.01em;color:var(--ink)}
.cat-price s{font-size:14px;color:#94a3b8}
.cat-once{font-size:12.5px;color:var(--soft);margin:-8px 0 0}
.cat-btn{display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:10px;
  background:var(--accent);color:var(--on-accent)!important;font-weight:600;font-size:15px;text-decoration:none;text-align:center}
.cat-link{font-weight:600;font-size:14.5px;color:var(--accent-text)!important;text-decoration:none}
.cat-link:hover{text-decoration:underline}
.cat-incl{font-size:13.5px;color:#166534;margin:0;line-height:1.45}

/* ---- paneles ---- */
.cat-two{display:grid;gap:16px}
@media(min-width:900px){.cat-two{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}}
.cat-panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;min-width:0}
@media(min-width:640px){.cat-panel{padding:28px}}
.cat-panel .cat-h2{font-size:clamp(22px,4.5vw,26px)}
.cat-list{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:12px}
.cat-list li{display:flex;gap:12px;align-items:flex-start;font-size:15px;color:var(--body);min-width:0}
.cat-list li>span{min-width:0}
.cat-list svg{flex:none;margin-top:2px;color:#15803d}
.cat-dl{display:grid;gap:14px;margin:16px 0 0}
.cat-dl div{display:grid;gap:2px;min-width:0}
.cat-dl dt{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}
.cat-dl dd{margin:0;font-size:15px;color:var(--ink);overflow-wrap:anywhere}
.cat-dl a{color:var(--accent-text);font-weight:600;text-decoration:none}
.cat-dl a:hover{text-decoration:underline}
.cat-reply{display:flex;gap:8px;align-items:center;margin:18px 0 0;font-size:14px;color:var(--muted)}
.cat-reply svg{flex:none}
.cat-stmt{margin:18px 0 0;font-size:14.5px;color:var(--body)}
.cat-tag{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;
  background:#0f172a;color:#fff;padding:2px 8px;border-radius:6px;letter-spacing:.04em;margin-left:4px;overflow-wrap:anywhere}
.cat-pay{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.cat-pay svg{width:60px;height:38px;display:block}
.cat-two-top{align-items:start}
.cat-small{font-size:13.5px;color:var(--soft);margin:16px 0 0}

/* ---- políticas ---- */
.cat-pol{display:grid;gap:12px}
@media(min-width:640px){.cat-pol{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}}
@media(min-width:960px){.cat-pol{grid-template-columns:repeat(4,minmax(0,1fr))}}
.cat-polcard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;
  gap:8px;text-decoration:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.cat-polcard:hover{border-color:#cbd5e1;box-shadow:0 4px 14px rgba(15,23,42,.06)}
.cat-polcard h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin:0;font-weight:700}
.cat-polcard p{margin:0;font-size:15px;color:var(--ink);flex:1;line-height:1.5}
.cat-polcard span{font-size:14px;font-weight:600;color:var(--accent-text)}

/* ---- footer ---- */
.cat-foot{background:#fff;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.cat-footgrid{display:grid;gap:22px;padding-top:32px;padding-bottom:24px}
@media(min-width:900px){.cat-footgrid{grid-template-columns:minmax(0,1fr) auto;gap:48px;padding-top:40px}}
.cat-foot p{margin:0 0 6px;overflow-wrap:anywhere}
.cat-foot strong{color:var(--ink);font-weight:650}
.cat-foot a{color:var(--muted);text-decoration:none}
.cat-foot a:hover{color:var(--ink);text-decoration:underline}
.cat-footlinks{display:grid;gap:8px;align-content:start}
.cat-copy{border-top:1px solid var(--line);padding-top:16px;padding-bottom:28px;font-size:13px;color:var(--soft)}

/* ---- páginas legales ---- */
.cat-doc{max-width:820px;padding-top:36px;padding-bottom:56px}
@media(min-width:900px){.cat-doc{padding-top:56px;padding-bottom:84px}}
.cat-doc h1{font-size:clamp(28px,6.4vw,40px);line-height:1.15;letter-spacing:-.025em;margin:0 0 12px;font-weight:800;text-wrap:balance}
.cat-doclead{font-size:17px;color:var(--muted);margin:0 0 10px}
.cat-updated{font-size:14px;color:var(--soft);margin:0 0 26px}
.cat-toc{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:0 0 30px}
.cat-toc p{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}
.cat-toc ol{list-style:none;margin:0;padding:0;display:grid;gap:4px}
@media(min-width:640px){.cat-toc ol{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 28px}}
.cat-toc a{color:var(--accent-text);text-decoration:none;font-size:15px}
.cat-toc a:hover{text-decoration:underline}
.cat-legal section{scroll-margin-top:16px}
.cat-legal h2{font-size:20px;line-height:1.3;letter-spacing:-.01em;margin:30px 0 10px;font-weight:700;color:var(--ink)}
.cat-legal p{margin:0 0 14px;color:var(--body);font-size:16px;line-height:1.7}
.cat-auto{color:var(--accent-text);overflow-wrap:anywhere}

/* ---- contacto ---- */
.cat-cgrid{display:grid;gap:12px;margin:22px 0 26px}
@media(min-width:640px){.cat-cgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}}
.cat-ccard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;display:flex;gap:14px;align-items:flex-start;min-width:0}
.cat-ccard>div{min-width:0}
.cat-ccard svg{flex:none;color:var(--accent-text);margin-top:3px}
.cat-ccard h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin:0 0 4px;font-weight:700}
.cat-ccard p{margin:0;font-size:15.5px;color:var(--ink);overflow-wrap:anywhere}
.cat-ccard a{color:var(--accent-text);font-weight:600;text-decoration:none}
.cat-ccard a:hover{text-decoration:underline}
.cat-prose p{margin:0 0 14px;color:var(--body);max-width:68ch}
.cat-doc .cat-btn{display:inline-flex;margin-top:8px}
`;
