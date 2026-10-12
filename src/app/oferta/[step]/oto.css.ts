/**
 * Estilos de la página post-compra. Copiados de las OTO de referencia
 * (Post-pago/salida/oto1.html): mismos colores, medidas, radios y sombras.
 * Todo cuelga de .oto para no pisar nada fuera de esta pantalla.
 */
export const OTO_CSS = `
body{background:#f4f7fd}
.oto{
 --primary:#2645a0;--primary-dark:#1c3479;--primary-light:#eff4fd;
 --cta:#f97216;--cta-hover:#dd5f0a;--accent:#f7cf49;
 --bg-white:#fff;--bg-light:#f4f7fd;--bg-dark:#1b3277;
 --text:#101828;--text-light:#667085;--border:#e1e8f4;
 --success:#10b981;--guarantee-bg:#f0fdf4;
 --shadow:0 4px 20px rgba(16,24,40,.08);
 --shadow-cta:0 6px 22px rgba(249,114,22,.42);
 font-family:var(--oto-font),Inter,system-ui,-apple-system,sans-serif;color:var(--text);
 background:var(--bg-light);line-height:1.8;-webkit-font-smoothing:antialiased;
 overflow-x:clip;min-height:100vh}
.oto *{box-sizing:border-box}
.oto h1,.oto h2,.oto h3{font-weight:800;line-height:1.2;margin:0}
.oto .hide{display:none}
.oto .pg{width:100%;max-width:540px;min-height:100vh;margin:0 auto;background:var(--bg-white)}
.oto .top{padding:24px 18px 4px;text-align:center}
.oto .eyebrow{display:inline-block;font-size:13px;font-weight:700;line-height:1.8;
 text-transform:uppercase;letter-spacing:.1em;color:var(--success);
 background:var(--guarantee-bg);padding:6px 16px;border-radius:99px}
.oto .top h1{margin:18px 0 10px;font-size:clamp(26px,6.6vw,32px);letter-spacing:-.015em;text-wrap:balance}
.oto .sub{margin:0;font-size:15px;line-height:1.6;color:var(--text-light)}
.oto .intro{display:flex;gap:14px;align-items:flex-start;margin:20px 0 4px;
 padding:18px 20px;background:var(--bg-white);border:1px solid var(--border);
 border-radius:12px;box-shadow:var(--shadow);font-size:14.5px;line-height:1.6;text-align:left;white-space:pre-line}
.oto .intro strong{font-weight:700}

.oto .banda{position:sticky;top:0;z-index:40;padding:11px 12px;
 background:linear-gradient(90deg,#1c3479,#2645a0 55%,#1c3479);color:#fff;
 text-align:center;font-size:12px;font-weight:800;letter-spacing:.1em;line-height:1.8;
 text-transform:uppercase}
.oto .banda.abajo{position:static;letter-spacing:.06em;font-size:12.5px}

/* El video, o la tapa cuando no hay video. */
.oto .watch{margin:20px 14px 12px;color:var(--cta);font-size:13px;font-weight:700;
 letter-spacing:.1em;text-transform:uppercase;line-height:1.8}
.oto .vid{padding:0 14px 18px}
.oto .marco{position:relative;border-radius:14px;overflow:hidden;background:var(--bg-dark)}
.oto .vid video{display:block;width:100%}
.oto .sonido{position:absolute;inset:0;width:100%;border:0;cursor:pointer;
 background:rgba(9,14,36,.5);color:#fff;display:flex;flex-direction:column;
 align-items:center;justify-content:center;gap:8px;font-family:inherit;
 -webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}
.oto .sonido .ico{font-size:46px;line-height:1}
.oto .sonido b{font-size:17px;font-weight:800}
.oto .sonido i{font-style:normal;font-size:14px;padding:9px 20px;border-radius:99px;
 background:var(--cta);font-weight:800;letter-spacing:.04em;box-shadow:var(--shadow-cta)}
.oto .hero{padding:22px 14px 18px;text-align:center}
.oto .hero img{display:block;margin:0 auto;width:min(66%,300px);height:auto;border-radius:8px;
 box-shadow:0 14px 36px rgba(16,24,40,.22),0 2px 6px rgba(16,24,40,.08)}

/* La vitrina: páginas reales, se tocan y se abren. */
.oto .vitrina{padding:6px 14px 0;text-align:center}
.oto .libri{padding:20px 14px 6px;text-align:center}
.oto .lg{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left}
.oto .lg.n3 .libro:first-child{grid-column:1/-1;display:grid;grid-template-columns:42% 1fr;gap:4px 12px;align-items:start}
.oto .lg.n3 .libro:first-child .lcov{grid-row:1/span 3}
.oto .libro{background:var(--bg-white);border:1px solid var(--border);border-radius:14px;padding:10px;box-shadow:var(--shadow)}
.oto .lcov{display:block;width:100%;padding:0;border:0;border-radius:8px;background:var(--bg-light);cursor:default;overflow:hidden;aspect-ratio:3/4}
.oto .lcov.zoom{cursor:zoom-in}
.oto .lcov img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 4px 10px rgba(16,24,40,.18))}
.oto .lnone{display:flex;align-items:center;justify-content:center;height:100%;padding:10px;font-weight:700;font-size:13px;color:var(--text-light);text-align:center}
.oto .libro h3{margin:9px 0 3px;font-size:14px;line-height:1.3;font-weight:800;color:var(--text)}
.oto .libro p{margin:0;font-size:12.5px;line-height:1.45;color:var(--text-light)}
.oto .lver{margin-top:8px;padding:0;border:0;background:none;color:var(--primary);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.oto .vt{font-size:12.5px;font-weight:800;letter-spacing:.12em;line-height:1.8;
 text-transform:uppercase;color:var(--text-light);margin-bottom:12px}
.oto .vg{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.oto .vg .tap{padding:0;border:0;background:none;cursor:pointer;display:block;
 position:relative;width:calc(33.333% - 6px);-webkit-tap-highlight-color:transparent}
.oto .vg.n1 .tap{width:62%}
.oto .vg.n2 .tap,.oto .vg.n4 .tap{width:calc(50% - 4px)}
.oto .vg .tap img{width:100%;display:block;border-radius:7px;
 box-shadow:0 3px 14px rgba(16,24,40,.16);outline:1px solid rgba(16,24,40,.06);outline-offset:-1px}
.oto .vg .tap::after{content:"+";position:absolute;right:5px;bottom:5px;
 width:20px;height:20px;border-radius:50%;background:rgba(16,24,40,.72);
 color:#fff;font-size:15px;font-weight:700;line-height:19px;text-align:center}
.oto .vpista{flex-basis:100%;width:100%;margin:9px 0 0;font-size:11.5px;font-weight:700;
 letter-spacing:.05em;line-height:1.8;text-transform:uppercase;color:var(--text-light)}
.oto .vn{margin:14px 0 0;font-size:15px;font-weight:700;line-height:1.8;color:var(--primary-dark)}
.oto .vn em{font-style:normal;color:var(--text-light);font-weight:500}
.oto .ctatemp{margin:16px 14px 0}
.quick{margin:10px 14px 4px;text-align:center}
.quick .qp{display:flex;align-items:baseline;justify-content:center;gap:10px;margin:0 0 10px}
.quick .qp .antes{font-size:15px;color:var(--text-light);text-decoration:line-through}
.quick .qp .hoy{font-size:28px;font-weight:800;color:var(--text)}
.quick .qcov{display:flex;justify-content:center;align-items:flex-end;margin:4px auto 14px;height:132px}
.quick .qcov img{height:118px;width:auto;aspect-ratio:3/4;object-fit:cover;border-radius:6px;background:#fff;
  box-shadow:0 2px 4px rgba(0,0,0,.08),0 10px 22px rgba(0,0,0,.18);margin:0 -14px;position:relative}
.quick .qcov.n1 img{height:132px;margin:0}
.quick .qcov.n2 img:nth-child(1){transform:rotate(-5deg)}.quick .qcov.n2 img:nth-child(2){transform:rotate(5deg)}
.quick .qcov.n3 img:nth-child(1){transform:rotate(-7deg) translateY(6px)}.quick .qcov.n3 img:nth-child(2){height:128px}.quick .qcov.n3 img:nth-child(3){transform:rotate(7deg) translateY(6px)}
.quick .qcov.n4 img:nth-child(1){transform:rotate(-9deg) translateY(10px)}.quick .qcov.n4 img:nth-child(2){transform:rotate(-3deg)}.quick .qcov.n4 img:nth-child(3){transform:rotate(3deg)}.quick .qcov.n4 img:nth-child(4){transform:rotate(9deg) translateY(10px)}
.quick .qcov.n5 img,.quick .qcov.n6 img{height:104px;margin:0 -18px}
.quick .qcov.n5 img:nth-child(1){transform:rotate(-10deg) translateY(12px)}.quick .qcov.n5 img:nth-child(2){transform:rotate(-5deg) translateY(3px)}.quick .qcov.n5 img:nth-child(3){height:118px}.quick .qcov.n5 img:nth-child(4){transform:rotate(5deg) translateY(3px)}.quick .qcov.n5 img:nth-child(5){transform:rotate(10deg) translateY(12px)}
.quick .qcov.n6 img:nth-child(1){transform:rotate(-11deg) translateY(14px)}.quick .qcov.n6 img:nth-child(2){transform:rotate(-6deg) translateY(5px)}.quick .qcov.n6 img:nth-child(3){transform:rotate(-2deg)}.quick .qcov.n6 img:nth-child(4){transform:rotate(2deg)}.quick .qcov.n6 img:nth-child(5){transform:rotate(6deg) translateY(5px)}.quick .qcov.n6 img:nth-child(6){transform:rotate(11deg) translateY(14px)}
.quick .qsave{display:inline-block;margin:-4px 0 12px;padding:5px 12px;border-radius:999px;background:#dcfce7;color:#166534;font-size:13.5px;font-weight:800;letter-spacing:.01em}
.oto .shint{font-size:11px;text-align:center;color:#6a7286;margin:6px 0 0;line-height:1.8;letter-spacing:.01em}

/* La caja de la oferta. */
.oto .offer{margin:0 14px 36px;background:var(--bg-white);border-radius:24px;
 box-shadow:0 12px 48px rgba(0,0,0,.18),0 0 0 1px rgba(225,232,244,.9);overflow:hidden}
.oto .vitrina + .offer{margin-top:14px}
.oto .offer.marca{animation:oto-latido 1.5s ease-out 2}
@keyframes oto-latido{
 0%,100%{box-shadow:0 12px 48px rgba(0,0,0,.18),0 0 0 1px rgba(225,232,244,.9)}
 45%{box-shadow:0 12px 48px rgba(0,0,0,.18),0 0 0 4px rgba(249,114,22,.55)}}
@media (prefers-reduced-motion:reduce){.oto .offer.marca{animation:none}}
.oto .timer{padding:13px;background:var(--bg-dark);color:#fff;text-align:center;line-height:1.8;
 font-size:12.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
.oto .body{padding:28px 20px 26px}
.oto .body h2{font-size:24px;letter-spacing:-.015em}
.oto .body .promesa{margin:8px 0 18px;font-size:15px;line-height:1.6;color:var(--text-light)}
.oto .b{display:flex;align-items:flex-start;gap:14px;margin:10px 0;padding:16px 18px;
 background:var(--bg-white);border:1px solid var(--border);border-radius:12px;
 box-shadow:var(--shadow);font-size:14px;line-height:1.55}
.oto .b i{font-style:normal;color:var(--success);font-weight:800;flex:0 0 auto}
.oto .b strong{font-weight:700}
.oto .precio{margin:22px 0 16px;padding:20px;background:var(--primary-light);border-radius:14px;text-align:center;line-height:1.8}
.oto .precio .antes{font-size:15px;color:var(--text-light);text-decoration:line-through}
.oto .precio .hoy{display:block;margin-top:2px;font-size:42px;font-weight:800;
 color:var(--primary-dark);letter-spacing:-.025em;line-height:1.1}
.oto .precio small{display:block;margin-top:6px;font-size:13px;color:var(--text-light)}
.oto .si{display:block;width:100%;padding:19px 20px;border:0;border-radius:11px;
 background:var(--cta);color:#fff;font-size:16px;font-weight:800;
 font-family:inherit;text-transform:uppercase;letter-spacing:.4px;
 line-height:1.38;cursor:pointer;box-shadow:var(--shadow-cta);transition:.15s}
.oto .si:hover{background:var(--cta-hover);transform:scale(1.02)}
.oto .si:disabled{cursor:default;transform:none}
.oto .si.wait{opacity:.75;cursor:wait}
.oto .si.ok,.oto .si.ok:hover{background:#12a150;box-shadow:0 6px 22px rgba(18,161,80,.35);transform:none}
.oto .nolab{margin:10px 0 0;text-align:center;font-size:12.5px;line-height:1.5;color:var(--text-light)}
.oto .no{display:block;width:100%;margin-top:14px;padding:15px 14px;
 border:1.5px solid #d4dbe7;border-radius:11px;background:#fff;
 color:#5b6478;font-size:14px;font-weight:600;line-height:1.5;text-align:center;text-decoration:none;
 font-family:inherit;letter-spacing:.01em;cursor:pointer;
 transition:background .15s,border-color .15s,color .15s}
.oto .no:hover{background:var(--bg-light);border-color:#c7cfe0;color:var(--text)}
.oto .trust{margin:18px 0 2px;padding:14px;background:var(--guarantee-bg);
 border:2px solid var(--success);border-radius:12px;text-align:center;
 font-size:13px;line-height:1.65;color:#065f46}

/* Lo que pasa después de tocar. */
.oto .stat,.oto .err,.oto .pvnote{margin:10px 0 0;text-align:center;font-size:13px;line-height:1.5}
.oto .stat{color:#067647;font-weight:600}
.oto .err{color:#b42318}
.oto .err a{color:var(--primary);font-weight:700}
.oto .pvnote{padding:9px 12px;border-radius:10px;background:var(--primary-light);color:var(--primary-dark);font-weight:600}

/* Visor de páginas. */
.oto .hoj{position:fixed;inset:0;z-index:70;background:rgba(9,14,28,.94);display:flex;flex-direction:column}
.oto .hojtop{display:flex;align-items:center;gap:10px;padding:14px 14px 10px}
.oto .hojtit{flex:1;color:#fff;font-size:15px;font-weight:800;line-height:1.25}
.oto .hojtit span{display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;
 text-transform:uppercase;color:rgba(255,255,255,.62);margin-top:3px}
.oto .hojx{flex:none;width:34px;height:34px;border-radius:50%;border:0;
 background:rgba(255,255,255,.14);color:#fff;font-size:19px;line-height:1;cursor:pointer;font-family:inherit}
.oto .hojtira{position:relative;flex:1;min-height:0;display:flex;align-items:center;gap:10px;
 overflow-x:auto;overflow-y:hidden;padding:0 10px 8px;
 scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.oto .hojtira img{scroll-snap-align:center;flex:0 0 calc(100% - 20px);
 width:calc(100% - 20px);height:100%;max-height:100%;object-fit:contain;border-radius:8px}
.oto .hojpie{padding:8px 14px 16px;text-align:center;color:rgba(255,255,255,.66);font-size:12px;font-weight:600;line-height:1.6}

/* Botón fijo abajo en el teléfono, cuando el de la caja no se ve. */
.oto .stick{position:fixed;left:0;right:0;bottom:0;z-index:60;
 padding:9px 14px calc(9px + env(safe-area-inset-bottom));
 background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
 border-top:1px solid #e3e8ef;box-shadow:0 -6px 22px rgba(16,24,40,.10);
 transform:translateY(130%);transition:transform .24s ease;pointer-events:none}
.oto .stick.on{transform:none;pointer-events:auto}
.oto .stick .si{width:100%;display:block}
@media(min-width:780px){.oto .stick{display:none}}
`;
