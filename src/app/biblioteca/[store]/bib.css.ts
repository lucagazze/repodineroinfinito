/**
 * Estilos de Mi biblioteca, con el mismo lenguaje visual que las landings de las ofertas: Inter 400–800; tinta #101828, gris #667085; azul #2645A0 (degradé del hero 150° #2F55B5 → #2645A0 →
 * #1F3C92, azul noche #1B3277); amarillo #F7CF49; botón naranja #F97216 en mayúsculas; precio verde #16A34A; fondos de
 * sección #F4F7FD; tarjetas blancas con borde #E1E8F4, radio 12–16 y sombra 0 4px 20px rgba(16,24,40,.08).
 * Las landings son solo claras: el portal también (sin modo oscuro).
 *
 * Barra de arriba: una sola barra fija y
 * baja (52 px en el celular, 60 en la compu) con la marca, el idioma y entrar/salir; debajo, las pestañas (también fijas,
 * 46 px). El buscador de la Tienda va dentro del contenido (no se pega). Nada cambia de tamaño al hacer scroll, no hay
 * JS de scroll y sin backdrop-filter (en iOS el desenfoque de capas fijas apiladas es lo que traba): fondos sólidos.
 */
export const BIB_CSS = `
.bib{--ink:#101828;--muted:#667085;--soft:#98A2B3;--slate:#475569;--line:#E1E8F4;--bg:#FFFFFF;--tint:#F4F7FD;--tint2:#F7F9FD;
  --blue:#2645A0;--blue-hi:#2F55B5;--blue-lo:#1F3C92;--navy:#1B3277;--yellow:#F7CF49;--orange:#F97216;--orange-hi:#FB8A3C;
  --green:#16A34A;--green-ink:#15803D;--green-bg:#DCFCE7;--green-line:#86EFAC;--save-bg:#FDE68A;--save-ink:#92400E;--red:#B42318;
  --card-shadow:0 4px 20px rgba(16,24,40,.08);--cta-shadow:0 6px 22px rgba(249,114,22,.42);--book:0 2px 4px rgba(16,24,40,.10),0 12px 28px rgba(16,24,40,.18);
  --hero:linear-gradient(150deg,#2F55B5 0%,#2645A0 48%,#1F3C92 100%);
  --font:var(--bib-inter),Inter,system-ui,-apple-system,sans-serif;
  color-scheme:light;min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:clip;position:relative;isolation:isolate}
.bib *{box-sizing:border-box}
.bib>*{position:relative}
.bib a:not(.bib-btn){color:inherit}
.bib button{font-family:inherit}
.bib :focus-visible{outline:3px solid color-mix(in srgb,var(--blue) 45%,transparent);outline-offset:2px}
.bib-wrap{max-width:1240px;margin:0 auto;padding:0 16px}
@media(min-width:768px){.bib-wrap{padding:0 32px}}
@media(min-width:1600px){.bib-wrap{max-width:1400px}}

/* ---- marca y barra superior */
.bib-wm{font-weight:800;font-size:18px;letter-spacing:-.02em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--blue)}
.bib-top{position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid var(--line)}
.bib-top .bib-wrap{display:flex;align-items:center;justify-content:space-between;height:52px;gap:10px}
@media(min-width:768px){.bib-top .bib-wrap{height:60px}.bib-wm{font-size:20px}}
.bib-me{display:flex;align-items:center;gap:8px;flex:none}
.bib-out{display:inline-flex;align-items:center;height:34px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;padding:0 12px;font-size:13.5px;font-weight:700;cursor:pointer;text-decoration:none;transition:border-color .15s,background .15s}
.bib-out:hover{border-color:color-mix(in srgb,var(--blue) 40%,var(--line));background:var(--tint)}
/* ---- barra: Temas ▾ (pantallas anchas), botón de color y hamburguesa */
.bib-navbtn{display:none;align-items:center;gap:6px;height:38px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--ink);font-size:14.5px;font-weight:700;cursor:pointer}
.bib-navbtn:hover,.bib-navbtn[aria-expanded="true"]{background:var(--tint);color:var(--blue)}
@media(min-width:900px){.bib-navbtn{display:inline-flex}}
.bib-top .bib-topcta{min-height:36px;height:36px;padding:0 14px;font-size:12.5px;border-radius:8px;box-shadow:none;white-space:nowrap}
@media(min-width:768px){.bib-top .bib-topcta{height:40px;min-height:40px;padding:0 18px;font-size:13.5px}}
.bib-burger{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);cursor:pointer}
.bib-burger:hover{background:var(--tint)}
.bib-drop{position:relative}
.bib-mega{position:absolute;right:0;top:calc(100% + 10px);z-index:40;display:grid;grid-template-columns:230px 260px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 48px rgba(16,24,40,.18);overflow:hidden;animation:bibfade .12s ease}
.bib-mega ul{list-style:none;margin:0;padding:8px;max-height:min(70vh,520px);overflow-y:auto}
.bib-mega-groups{background:var(--tint2);border-right:1px solid var(--line)}
.bib-mega button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:none;color:var(--ink);font-size:14.5px;font-weight:700;text-align:left;cursor:pointer}
.bib-mega-groups button[aria-expanded="true"]{background:#fff;color:var(--blue);box-shadow:0 1px 4px rgba(16,24,40,.08)}
.bib-mega-topics button{font-weight:600}
.bib-mega-topics button:hover,.bib-mega-groups button:hover{background:var(--tint);color:var(--blue)}
.bib-mega i,.bib-menu i{font-style:normal;font-size:12px;font-weight:800;color:var(--muted);background:var(--tint);border-radius:999px;padding:2px 8px}
/* ---- menú (hamburguesa): panel a la derecha; en el celular, toda la pantalla */
.bib-menu-bg{position:fixed;inset:0;z-index:60;background:rgba(16,24,40,.5);display:flex;justify-content:flex-end;animation:bibfade .12s ease}
.bib-menu{width:min(400px,100%);height:100%;overflow-y:auto;overscroll-behavior:contain;background:#fff;padding:0 16px calc(24px + env(safe-area-inset-bottom));box-shadow:-12px 0 40px rgba(16,24,40,.18)}
.bib-menu-top{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;height:52px;margin:0 -16px;padding:0 10px 0 16px;background:#fff;border-bottom:1px solid var(--line)}
@media(min-width:768px){.bib-menu-top{height:60px}}
.bib-menu section{padding:16px 0 8px;border-bottom:1px solid var(--line)}
.bib-menu section:last-child{border-bottom:0}
.bib-menu h3{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.bib-menu ul{list-style:none;margin:0;padding:0}
.bib-menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:10px 10px;border:0;border-radius:10px;background:none;color:var(--ink);font:inherit;font-size:16px;font-weight:700;text-align:left;text-decoration:none;cursor:pointer}
.bib-menu-item:hover{background:var(--tint);color:var(--blue)}
.bib-menu-n{font-size:13px;font-weight:700;color:var(--muted)}
.bib-menu-sub{margin:2px 0 8px 12px!important;padding-left:10px!important;border-left:2px solid var(--line)}
.bib-menu-sub .bib-menu-item{min-height:42px;font-size:15px;font-weight:600}
.bib-menu-chev{display:inline-block;font-weight:800;transition:transform .15s}
.bib-menu-item[aria-expanded="true"]{color:var(--blue)}
.bib-menu-item[aria-expanded="true"] .bib-menu-chev{transform:rotate(90deg)}
.bib-menu-back{border:0;background:none;color:var(--blue);font:inherit;font-size:15px;font-weight:800;padding:4px 0 12px;cursor:pointer}
.bib-menu-langs{display:grid!important;grid-template-columns:1fr 1fr;gap:8px}
.bib-menu-lang{width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:14.5px;font-weight:700;cursor:pointer}
.bib-menu-lang[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
#catalogo,#entrar,.bib-shopbar{scroll-margin-top:112px}
.bib-sentinel{display:flex;justify-content:center;padding:24px 0 0}
.bib-sentinel .bib-btn{width:auto;padding:0 22px}
.bib-admin{background:var(--ink);color:#fff;font-size:12.5px;font-weight:600;text-align:center;padding:7px 12px}

/* ---- tipografía */
.bib-h1{font-weight:800;font-size:clamp(32px,5.4vw,56px);line-height:1.08;letter-spacing:-.015em;margin:0}
.bib-h2{font-weight:800;font-size:clamp(22px,2.6vw,30px);line-height:1.2;letter-spacing:-.01em;margin:0}
.bib-sub{margin:10px 0 0;font-size:16px;color:var(--muted)}
.bib-hl{color:var(--yellow)}
.bib-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 14px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:rgba(38,69,160,.08);color:var(--blue);border:1px solid rgba(38,69,160,.16)}
.bib-lede{font-size:15px;color:var(--muted);margin:0;max-width:62ch}
.bib-note{font-size:13.5px;color:var(--muted);margin:0 0 18px}

/* ---- hero (como el de las landings) */
.bib-hero{background:var(--hero);color:#fff;overflow:hidden}
.bib-hero .bib-wrap{display:grid;gap:26px;align-items:center;padding-top:36px;padding-bottom:36px}
@media(min-width:860px){.bib-hero .bib-wrap{grid-template-columns:minmax(0,1fr) 400px;padding-top:56px;padding-bottom:56px}}
.bib-hero .bib-pill{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.22)}
.bib-hero .bib-h1{margin-top:14px;color:#fff}
.bib-hero .bib-sub{color:rgba(255,255,255,.85);font-size:17px;max-width:56ch}
.bib-hero-txt{min-width:0}
.bib-mail{margin:10px 0 0;font-size:15px;color:rgba(255,255,255,.78);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bib-stats{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0}
.bib-stats li{display:inline-block;border-radius:7px;padding:5px 11px;font-size:13.5px;font-weight:700;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.16);color:#fff}
.bib-stats li b{color:var(--yellow)}
.bib-fan{display:none;position:relative;height:250px}
@media(min-width:860px){.bib-fan{display:block}}
.bib-fan img{position:absolute;bottom:0;width:150px;aspect-ratio:3/4;object-fit:cover;border-radius:8px;border:4px solid rgba(255,255,255,.9);box-shadow:0 18px 40px rgba(8,16,34,.45);transition:transform .4s cubic-bezier(.2,.7,.2,1)}
.bib-fan img:nth-child(1){left:40px;transform:rotate(-9deg) translateY(6px);z-index:1}
.bib-fan img:nth-child(2){left:125px;transform:rotate(-1deg) translateY(-14px);z-index:3}
.bib-fan img:nth-child(3){left:210px;transform:rotate(8deg) translateY(4px);z-index:2}
.bib-fan-1 img:nth-child(1){left:125px;transform:rotate(-3deg)}
.bib-fan-2 img:nth-child(1){left:80px}.bib-fan-2 img:nth-child(2){left:170px;transform:rotate(6deg) translateY(-6px)}

/* ---- pestañas */
.bib-tabsbar{position:sticky;top:52px;z-index:20;background:#fff;border-bottom:1px solid var(--line)}
@media(min-width:768px){.bib-tabsbar{top:60px}}
.bib-tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.bib-tabs::-webkit-scrollbar{display:none}
.bib-tabs button{position:relative;flex:none;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;border:0;background:transparent;color:var(--muted);font-size:15px;font-weight:700;height:46px;padding:0 14px;cursor:pointer;transition:color .15s}
@media(min-width:768px){.bib-tabs button{height:52px}}
@media(max-width:480px){.bib-tabs{gap:0}.bib-tabs button{font-size:14px;padding:0 9px;gap:6px}.bib-tabs button:after{left:9px;right:9px}}
.bib-tabs button:first-child{padding-left:0}
.bib-tabs button:hover{color:var(--ink)}
.bib-tabs button:after{content:"";position:absolute;left:14px;right:14px;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:var(--blue);transform:scaleY(0);transform-origin:bottom;transition:transform .2s}
.bib-tabs button:first-child:after{left:0}
.bib-tabs button span{font-size:12px;font-weight:800;min-width:22px;padding:2px 7px;border-radius:999px;background:var(--tint);color:var(--muted);text-align:center}
.bib-tabs button[aria-selected="true"]{color:var(--blue)}
.bib-tabs button[aria-selected="true"]:after{transform:scaleY(1)}
.bib-tabs button[aria-selected="true"] span{background:var(--blue);color:#fff}
[role="tabpanel"][hidden]{display:none}

/* ---- secciones */
.bib-sec{padding:12px 0 8px}
.bib-block{margin-top:36px}
.bib-block-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin-bottom:20px}
.bib-block-h .bib-h2{display:flex;align-items:center;gap:12px;min-width:0}
.bib-count{flex:none;font-size:13px;font-weight:800;color:var(--blue);background:var(--tint);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.bib-kit-h{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.bib-kit-h img{width:48px;height:64px;object-fit:cover;border-radius:6px;box-shadow:var(--card-shadow);flex:none}
.bib-kit-h small{display:block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin-bottom:4px}
.bib-more-link{font-size:14.5px;font-weight:800;color:var(--blue)!important;text-decoration:none;white-space:nowrap}
.bib-more-link:hover{text-decoration:underline;text-underline-offset:3px}

/* ---- grilla y tarjetas */
.bib-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media(min-width:640px){.bib-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}}
@media(min-width:960px){.bib-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(min-width:1180px){.bib-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:22px}}
@media(min-width:1600px){.bib-grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
@media(min-width:1180px){.bib-grid-6{grid-template-columns:repeat(6,minmax(0,1fr))}}
.bib-cell{display:flex;min-width:0}
.bib-cell>.bib-book{flex:1}
.bib-book{display:flex;flex-direction:column;min-width:0;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 10px 12px;box-shadow:var(--card-shadow);transition:border-color .2s,box-shadow .2s}
@media(min-width:640px){.bib-book{padding:12px 12px 14px;border-radius:16px}}
/* sin transform en la tarjeta: la hoja de compra (fixed) vive adentro y tiene que tomar toda la pantalla */
.bib-book:hover{border-color:#C9D4EA;box-shadow:0 10px 30px rgba(16,24,40,.12)}
.bib-cover{position:relative;aspect-ratio:3/4;border-radius:8px;overflow:hidden;background:var(--tint)}
.bib-cover img{width:100%;height:100%;object-fit:cover;display:block}
.bib-ph{display:flex;align-items:center;justify-content:center;height:100%;padding:16px;text-align:center;background:linear-gradient(160deg,#E8EEFB,var(--tint))}
.bib-ph span{font-size:15px;font-weight:800;line-height:1.25;color:var(--blue)}
.bib-open{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in;text-align:left;color:inherit;font:inherit;letter-spacing:inherit}
.bib-peek{position:absolute;left:50%;bottom:10px;transform:translate(-50%,6px);opacity:0;white-space:nowrap;background:rgba(16,24,40,.82);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:5px 11px;transition:opacity .2s,transform .2s;pointer-events:none}
.bib-open:hover .bib-peek,.bib-open:focus-visible .bib-peek{opacity:1;transform:translate(-50%,0)}
@media(hover:none){.bib-peek{opacity:1;transform:translate(-50%,0);font-size:11px;padding:4px 9px}}
.bib-badge{position:absolute;left:8px;top:8px;z-index:2;background:#fff;color:var(--blue);font-size:11px;font-weight:800;letter-spacing:.02em;border-radius:999px;padding:4px 9px;box-shadow:0 2px 8px rgba(16,24,40,.16)}
.bib-lk{position:absolute;right:8px;top:8px;z-index:2;width:28px;height:28px;border-radius:999px;background:rgba(16,24,40,.75);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px}
.bib-t{font-size:15px;font-weight:800;line-height:1.28;letter-spacing:-.005em;margin:12px 0 4px;min-height:2.56em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bib-t .bib-open{cursor:pointer}
.bib-d{font-size:13px;line-height:1.45;color:var(--muted);margin:0 0 10px;min-height:2.9em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bib-d1{-webkit-line-clamp:1;min-height:1.45em}
.bib-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin:0 0 8px}
.bib-price b{font-size:19px;font-weight:900;color:var(--green);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.bib-price s{font-size:13px;color:#64748B}
.bib-gift{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;margin:0 0 10px;font-size:11.5px;font-weight:800;color:var(--green-ink);background:var(--green-bg);border:1px solid var(--green-line);border-radius:999px;padding:2px 9px}
.bib-acts{margin-top:auto;display:flex;flex-direction:column;gap:7px}
.bib-acts>*{width:100%}

/* ---- botones (los de las landings) */
.bib-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:8px;min-height:42px;padding:10px 14px;font-size:14px;font-weight:800;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer;background:var(--blue);color:#fff;transition:transform .15s,background .15s,box-shadow .15s}
.bib-btn:hover{background:var(--blue-hi)}
.bib-btn:active{transform:scale(.98)}
.bib-btn[disabled]{opacity:.55;cursor:default}
.bib-ghost{background:#fff;color:var(--blue);border:1px solid rgba(38,69,160,.22);min-height:36px;font-size:13px;font-weight:700}
.bib-ghost:hover{background:var(--tint)}
.bib-unlock,.bib-cta{background:var(--orange);color:#fff;text-transform:uppercase;letter-spacing:.4px;box-shadow:var(--cta-shadow)}
.bib-unlock:hover,.bib-cta:hover{background:var(--orange-hi)}
.bib-unlock{width:100%;font-size:13px}
.bib-done{width:100%;background:var(--green);color:#fff}
.bib-soon{background:#FFF7E6;color:var(--save-ink);border:1px solid #FCD9A5;cursor:default;font-size:12.5px}
.bib-soon:hover{background:#FFF7E6}
.bib-err{font-size:12.5px;color:var(--red);margin:6px 0 0}
@media(max-width:480px){.bib-acts .bib-btn{font-size:12px;padding:9px 6px;letter-spacing:0}}

/* ---- colecciones */
.bib-coll{margin-top:28px;background:var(--tint);border:2px solid var(--blue);border-radius:16px;padding:20px 14px 22px}
@media(min-width:768px){.bib-coll{padding:26px 26px 28px}}
.bib-coll+.bib-coll{margin-top:16px}
.bib-coll-n{font-size:13px;font-weight:800;color:var(--blue)}
.bib-prog{height:8px;border-radius:999px;background:#fff;border:1px solid var(--line);overflow:hidden;margin:10px 0 8px}
.bib-prog i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--blue-hi))}
.bib-lock .bib-cover img{filter:saturate(.55)}
.bib-lock:hover .bib-cover img{filter:none}

/* ---- tienda: buscador, temas y resultados */
.bib-shopbar{padding:20px 0 4px}
@media(min-width:768px){.bib-shopbar{padding:24px 0 6px}}
.bib-search{display:flex;align-items:center;gap:12px;height:52px;padding:0 8px 0 18px;border-radius:12px;border:2px solid var(--line);background:#fff;box-shadow:var(--card-shadow);transition:border-color .15s,box-shadow .15s}
.bib-search:focus-within{border-color:var(--blue);box-shadow:0 0 0 4px rgba(38,69,160,.12)}
.bib-search svg{color:var(--blue);flex:none}
.bib-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:17px;font-weight:500;outline:none;-webkit-appearance:none;appearance:none}
.bib-search input::-webkit-search-cancel-button{display:none}
.bib-search input::placeholder{color:var(--soft);font-weight:400}
.bib-search button{flex:none;width:38px;height:38px;border:0;border-radius:8px;background:var(--tint);color:var(--ink);font-size:20px;line-height:1;cursor:pointer}
.bib-chips{display:flex;gap:8px;margin-top:12px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.bib-chips::-webkit-scrollbar{display:none}
@media(min-width:768px){.bib-chips{flex-wrap:wrap;overflow:visible}}
.bib-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink);font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.bib-chip i{font-style:normal;font-size:11.5px;font-weight:800;color:var(--muted)}
.bib-chip:hover{border-color:rgba(38,69,160,.4)}
.bib-chip-more{color:var(--blue);border-style:dashed;min-width:52px;justify-content:center}
.bib-chip[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.bib-chip[aria-pressed="true"] i{color:rgba(255,255,255,.8)}
.bib-results-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:28px 0 18px}
.bib-results-h .bib-h2{display:flex;align-items:center;gap:12px}
.bib-shuffle{min-height:40px;padding:0 16px;font-size:13.5px}
.bib-empty{background:var(--tint);border:1px dashed #C9D4EA;border-radius:16px;padding:40px 20px;text-align:center;margin-top:24px}
.bib-empty .bib-h2{font-size:20px}

/* ---- pedidos */
.bib-orders{display:grid;gap:14px;margin-top:20px}
@media(min-width:900px){.bib-orders{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}
.bib-order{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;box-shadow:var(--card-shadow)}
.bib-order header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.bib-order-ref{display:block;font-size:17px;font-weight:800}
.bib-order-date{display:block;font-size:13.5px;color:var(--muted);margin-top:2px}
.bib-order-tot{text-align:right;flex:none}
.bib-order-tot b{display:block;font-size:19px;font-weight:900;color:var(--ink);font-variant-numeric:tabular-nums}
.bib-status{display:inline-block;margin-top:5px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 10px}
.bib-status.ok{background:var(--green-bg);color:var(--green-ink);border:1px solid var(--green-line)}
.bib-status.bad{background:#FEE4E2;color:var(--red);border:1px solid #FECDCA}
.bib-order ul{list-style:none;margin:14px 0 0;padding:14px 0 0;border-top:1px solid var(--line);display:grid;gap:8px}
.bib-order li{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px}
.bib-order li span{min-width:0}
.bib-order li em{flex:none;font-style:normal;font-size:11px;font-weight:800;color:var(--blue);background:var(--tint);border:1px solid var(--line);border-radius:999px;padding:2px 8px}

/* ---- ayuda y pie (la franja azul noche de las landings) */
.bib-help{margin-top:64px;background:var(--navy);color:#fff}
.bib-help .bib-wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;padding-top:40px;padding-bottom:40px}
.bib-help .bib-sub{color:rgba(255,255,255,.8)}
.bib-help .bib-btn{min-height:52px;padding:14px 26px;font-size:15px}
.bib-foot{background:var(--ink);color:rgba(255,255,255,.7);font-size:13px}
.bib-foot .bib-wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 20px;padding-top:22px;padding-bottom:30px}
.bib-foot .bib-wm{color:#fff;font-size:17px}

/* ---- entrar (público) */
.bib-loginbox{background:#fff;color:var(--ink);border-radius:20px;padding:24px 20px 20px;box-shadow:0 12px 48px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.1)}
@media(min-width:640px){.bib-loginbox{padding:30px 28px 24px}}
.bib-loginbox h2{font-size:21px;font-weight:800;line-height:1.25;margin:0}
.bib-loginbox p{margin:6px 0 0;font-size:14.5px;color:var(--muted)}
.bib-login-toggle{display:inline-flex;align-items:center;gap:8px;margin-top:22px;min-height:48px;padding:12px 20px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;font-size:15px;font-weight:800;cursor:pointer}
.bib-login-toggle:hover{background:rgba(255,255,255,.18)}
.bib-form{margin-top:18px;display:grid;gap:10px;text-align:left}
.bib-field{display:flex;align-items:center;gap:10px;border:2px solid var(--line);background:#fff;border-radius:10px;padding:0 14px;transition:border-color .15s,box-shadow .15s}
.bib-field:focus-within{border-color:var(--blue);box-shadow:0 0 0 4px rgba(38,69,160,.12)}
.bib-field svg{color:var(--soft);flex:none}
.bib-field input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:16px;padding:14px 0;outline:none}
.bib-field input::placeholder{color:var(--soft)}
.bib-form .bib-cta{width:100%;min-height:54px;font-size:16px;border-radius:10px}
.bib-in{width:100%;border:2px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:11px 14px;font:inherit;font-size:15px;outline:none}
.bib-in:focus{border-color:var(--blue)}
.bib-msg{font-size:14px;line-height:1.5;margin:4px 0 0;color:var(--muted);text-align:center}
.bib-warn{color:var(--save-ink)!important;background:#FFF7E6;border:1px solid #FCD9A5;border-radius:8px;padding:8px 12px}
.bib-trouble{font-size:13px;color:var(--muted);margin:14px 0 0;text-align:center}
.bib-trouble a{font-weight:700;color:var(--blue)!important}
.bib-sent{margin-top:20px;padding:20px 16px;border-radius:12px;background:#F0FDF4;border:2px solid #10B981}
.bib-sent h2{font-size:18px;font-weight:800;margin:0 0 6px}
.bib-sent p{font-size:14px;line-height:1.5;color:var(--muted);margin:0 0 12px}
.bib-sent-ic{font-size:30px;line-height:1;margin-bottom:8px}
.bib-textbtn{border:0;background:none;color:var(--blue);font-size:14px;font-weight:800;cursor:pointer;padding:4px}

/* ---- idioma (botón + lista) */
.bib-lang{position:relative}
.bib-lang>button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px 0 11px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);font-size:13.5px;font-weight:700;cursor:pointer}
.bib-lang>button:hover{background:var(--tint)}
.bib-lang>button svg{color:var(--blue);flex:none}
.bib-lang>button .bib-chev{color:var(--muted);transition:transform .15s}
.bib-lang>button[aria-expanded="true"] .bib-chev{transform:rotate(180deg)}
.bib-lang ul{position:absolute;right:0;top:calc(100% + 6px);z-index:40;min-width:180px;list-style:none;margin:0;padding:6px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px rgba(16,24,40,.16);animation:bibfade .12s ease}
.bib-lang li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:8px;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer}
.bib-lang li[aria-selected="true"]{color:var(--blue);font-weight:800}
.bib-lang li[data-active="true"],.bib-lang li:hover{background:var(--tint)}
.bib-lang li small{font-size:11px;font-weight:800;color:var(--soft);text-transform:uppercase}
@media(max-width:400px){.bib-lang .bib-lang-name{display:none}}

/* ---- vista previa del libro */
.bib-pv-bg{position:fixed;inset:0;z-index:55;background:rgba(16,24,40,.68);display:flex;align-items:stretch;justify-content:center;animation:bibfade .15s ease}
@media(min-width:760px){.bib-pv-bg{align-items:center;padding:24px}}
.bib-pv{position:relative;width:100%;max-width:960px;background:#fff;color:var(--ink);overflow-y:auto;overscroll-behavior:contain;animation:bibup .2s cubic-bezier(.2,.8,.2,1)}
@media(min-width:760px){.bib-pv{border-radius:20px;max-height:calc(100vh - 48px);box-shadow:0 24px 70px rgba(8,16,34,.45)}}
.bib-pv-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px 10px 18px;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line)}
.bib-pv-top p{margin:0;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bib-x{flex:none;width:40px;height:40px;border:0;border-radius:999px;background:var(--tint);color:var(--ink);font-size:22px;line-height:1;cursor:pointer}
.bib-pv-body{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;padding:20px 18px 28px}
@media(min-width:760px){.bib-pv-body{grid-template-columns:260px minmax(0,1fr);gap:28px;padding:26px 28px 30px}}
.bib-pv-cover{width:min(220px,62vw);margin:0 auto;aspect-ratio:3/4;border-radius:10px;overflow:hidden;box-shadow:var(--book);background:var(--tint)}
@media(min-width:760px){.bib-pv-cover{width:100%}}
.bib-pv-cover{position:relative}
.bib-pv-cover img{width:100%;height:100%;object-fit:cover;display:block}
.bib-pv-cover .bib-hires{position:absolute;inset:0;opacity:0;transition:opacity .2s}
.bib-pv-cover .bib-hires[data-ok]{opacity:1}
.bib-pv-cover-big{width:min(340px,80vw)}
.bib-pv h2{font-size:clamp(22px,3vw,30px);font-weight:800;line-height:1.15;margin:0}
.bib-pv-desc{font-size:15.5px;line-height:1.6;color:#344054;margin:12px 0 0;white-space:pre-line}
.bib-pv .bib-price{margin:16px 0 6px}
.bib-pv .bib-price b{font-size:30px}
.bib-pv .bib-acts{margin-top:12px;max-width:360px}
.bib-pv .bib-acts .bib-btn{min-height:52px;font-size:15px}
.bib-pv-pages{grid-column:1/-1;min-width:0}
.bib-pv-pages h3{font-size:15px;font-weight:800;margin:0 0 12px;display:flex;align-items:center;gap:10px}
.bib-strip{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px;scrollbar-width:thin}
.bib-strip button{flex:none;scroll-snap-align:start;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;box-shadow:var(--card-shadow)}
.bib-strip img{display:block;height:230px;width:auto;max-width:none}
@media(min-width:760px){.bib-strip img{height:280px}}
.bib-skel{flex:none;width:170px;height:230px;border-radius:8px;background:linear-gradient(90deg,var(--tint),#EAF0FB,var(--tint));background-size:200% 100%;animation:bibshine 1.2s linear infinite}

/* ---- visor de páginas (grande, se desliza) */
.bib-viewer{position:fixed;inset:0;z-index:70;background:rgba(8,12,24,.94);display:flex;flex-direction:column}
.bib-viewer-track{flex:1;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.bib-viewer-track::-webkit-scrollbar{display:none}
.bib-viewer-track>div{flex:0 0 100%;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;padding:56px 12px 12px}
.bib-viewer-track img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.bib-viewer-bar{display:flex;align-items:center;justify-content:center;gap:16px;padding:12px 12px calc(14px + env(safe-area-inset-bottom));color:#fff;font-size:14px;font-weight:700}
.bib-viewer-bar button,.bib-viewer .bib-x{background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:999px;width:44px;height:44px;font-size:22px;cursor:pointer}
.bib-viewer .bib-x{position:absolute;top:10px;right:10px;z-index:2}
.bib-viewer-bar button[disabled]{opacity:.35;cursor:default}

/* ---- hoja de compra */
.bib-sheet-bg{position:fixed;inset:0;z-index:60;background:rgba(16,24,40,.62);display:flex;align-items:flex-end;justify-content:center;animation:bibfade .18s ease}
@media(min-width:640px){.bib-sheet-bg{align-items:center;padding:20px}}
.bib-sheet{position:relative;width:100%;max-width:440px;background:#fff;color:var(--ink);border-radius:22px 22px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:bibup .22s cubic-bezier(.2,.8,.2,1)}
@media(min-width:640px){.bib-sheet{border-radius:22px;padding:28px 28px 24px}}
.bib-sheet-x{position:absolute;top:12px;right:12px;width:36px;height:36px;border:0;border-radius:999px;background:var(--tint);color:var(--ink);font-size:20px;line-height:1;cursor:pointer}
.bib-sheet-k{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin:0 0 16px}
.bib-sheet-top{display:flex;gap:16px;align-items:flex-start}
.bib-sheet-top img,.bib-sheet-ph{width:84px;height:112px;flex:none;object-fit:cover;border-radius:8px;box-shadow:var(--book);background:var(--tint);display:flex;align-items:center;justify-content:center;font-size:30px}
.bib-sheet h3{font-size:18px;font-weight:800;line-height:1.25;margin:2px 0 6px}
.bib-sheet-m{font-size:13px;color:var(--muted);margin:0;line-height:1.45}
.bib-sheet-m b{color:var(--green-ink);font-weight:800}
.bib-pay{margin-top:20px;min-height:54px;font-size:16px;border-radius:10px}
.bib-sheet-note{font-size:12.5px;color:var(--muted);text-align:center;margin:12px 0 0;line-height:1.45}
.bib-sheet-secure{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;font-weight:700;color:var(--muted);margin:8px 0 0}
.bib-sheet-ok{margin:20px auto 4px;width:64px;height:64px;border-radius:999px;background:var(--green);color:#fff;font-size:32px;font-weight:800;display:flex;align-items:center;justify-content:center;animation:bibpop .35s cubic-bezier(.2,1.4,.4,1)}
@keyframes bibfade{from{opacity:0}to{opacity:1}}
@keyframes bibup{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@keyframes bibpop{from{transform:scale(.4)}to{transform:none}}
@keyframes bibshine{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.bib *,.bib *:before,.bib *:after{animation:none!important;transition:none!important}}
`;
