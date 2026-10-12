"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type Ref } from "react";
import { Inter } from "next/font/google";
import type { OfferView } from "@/lib/postcompra-page";
import { OTO_CSS } from "./oto.css";
import { useOffer, type OfferMode } from "./useOffer";
import { PreviewPill } from "./PreviewPill";
import { PaySheet, PAY_COPY } from "./PaySheet";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
// Un solo objeto: si cambia en cada render, React 19 reescribe el <style> cada vez.
const CSS = { __html: OTO_CSS };

type Origin = "top" | "box" | "stick" | "no";

/** **negrita** → <strong>. Nada más: el contenido viene de la base, no se interpreta HTML. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

/** La OTO con plantilla (products.postcompra_page). */
export default function OfferClient({ view: v, mode, pillDetail, save }: { view: OfferView; mode: OfferMode; pillDetail?: string; save?: string | null }) {
  const offer = useOffer(mode);
  const { state } = offer;
  const [origin, setOrigin] = useState<Origin>("box");
  const [noteAt, setNoteAt] = useState<Origin | null>(null);

  // Con video y demora, los botones de compra aparecen cuando el video llega a ese segundo.
  const [revealed, setRevealed] = useState(!v.video || v.video.delaySeconds <= 0);
  const [marked, setMarked] = useState(false);
  const [sound, setSound] = useState<"muted" | "blocked" | "on">("muted");
  const videoRef = useRef<HTMLVideoElement>(null);

  // El visor: las páginas de la galería, o las de un libro del kit (cada uno con su título).
  const [viewer, setViewer] = useState<{ imgs: string[]; title: string; sub: string; i: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [stick, setStick] = useState(false);
  const boxCtaRef = useRef<HTMLButtonElement>(null);
  const showcaseRef = useRef<HTMLElement>(null);

  const next = offer.next ?? "#";
  const pay = PAY_COPY[v.locale as keyof typeof PAY_COPY] ?? PAY_COPY.en;

  useEffect(() => {
    document.title = v.productName;
    document.documentElement.lang = v.locale;
  }, [v.productName, v.locale]);

  // ------------------------------------------------------------- el cobro
  function accept(from: Origin) {
    if (state === "loading" || state === "done") return;
    setOrigin(from);
    // La barra fija no tiene lugar para avisos: van debajo del botón de la caja.
    setNoteAt(from === "stick" ? "box" : from);
    offer.accept();
  }

  function decline(e: MouseEvent) {
    setNoteAt("no");
    if (!offer.decline()) e.preventDefault();
  }

  // ------------------------------------------------------------- el video
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !v.video) return;
    const delay = v.video.delaySeconds;
    let shown = delay <= 0;
    const reveal = () => {
      if (shown) return;
      shown = true;
      setRevealed(true);
      setMarked(true);
    };
    // Arranca mudo: con sonido el navegador lo bloquea. Si ni mudo puede,
    // la capa pasa a ser un "tocá para ver".
    el.play()?.catch(() => setSound("blocked"));

    // Se mira el reloj del video, no `timeupdate`: si el comprador adelanta
    // con la barra, timeupdate puede no dispararse nunca.
    const start = Date.now();
    let runs = false;
    const id = setInterval(() => {
      if (el.currentTime > 0.4) runs = true;
      if (el.currentTime >= delay) reveal();
      const past = (Date.now() - start) / 1000;
      if (!runs && past > 14) reveal(); // el video no anda: no hay voz que esperar
      if (past > delay + 25) reveal(); // último recurso
      if (shown) clearInterval(id);
    }, 250);
    el.addEventListener("ended", reveal);
    return () => {
      clearInterval(id);
      el.removeEventListener("ended", reveal);
    };
  }, [v.video]);

  function withSound() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.controls = true;
    // Vuelve a empezar: hasta acá vio imágenes mudas, que lo vea entero.
    el.currentTime = 0;
    el.play()?.catch(() => {});
    setSound("on");
  }

  // ------------------------------------------------------------- el visor
  useEffect(() => {
    if (viewer === null) return;
    const strip = stripRef.current;
    const page = strip?.children[viewer.i] as HTMLElement | undefined;
    if (strip && page) strip.scrollLeft = page.offsetLeft - (strip.clientWidth - page.clientWidth) / 2;
    // Sin esto el fondo sigue scrolleando debajo del visor en el teléfono.
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewer(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [viewer]);

  // --------------------------------------------- el botón fijo del teléfono
  // Aparece cuando ya pasó la vitrina (con su botón) y el botón de la caja no
  // se ve. Se mide en cada scroll y no con IntersectionObserver: un salto
  // grande (un ancla, un fling) no cruza ningún umbral y el observer no avisa.
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const a = showcaseRef.current?.getBoundingClientRect();
      const r = boxCtaRef.current?.getBoundingClientRect();
      const past = !!a && a.bottom < 0;
      const realVisible = !!r && r.height > 0 && r.top < window.innerHeight - 40 && r.bottom > 40;
      setStick(past && !realVisible);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [revealed]);

  // ---------------------------------------------------------------- piezas
  const cta = (from: Origin, ref?: Ref<HTMLButtonElement>) => (
    <button
      ref={ref}
      type="button"
      className={`si${state === "done" ? " ok" : ""}${state === "loading" ? " wait" : ""}`}
      disabled={state === "loading" || state === "done"}
      onClick={() => accept(from)}
      data-pp-accept=""
    >
      {state === "done" ? `✓ ${v.ui.added}` : state === "loading" ? pay.processing : v.ctaText}
    </button>
  );

  const status = (at: Origin) => {
    if (offer.previewNote && noteAt === at) return <p className="pvnote" role="status">{v.ui.preview}</p>;
    if (at !== origin && !(at === "box" && origin === "stick")) return null;
    if (state === "done") return <p className="stat" role="status">{v.ui.cont}…</p>;
    if (state === "error") return <p className="err" role="alert">{offer.pending ? pay.pending : v.ui.failed} <a href={offer.continueHref ?? next}>{v.ui.cont}</a></p>;
    return null;
  };

  const images = v.gallery?.images ?? [];
  const openGallery = (i: number) => v.gallery && setViewer({ imgs: images, title: v.productName, sub: v.gallery.viewerSub, i });
  const [statsMain, ...statsRest] = v.stats.split(" — ");

  return (
    <div className={`oto ${inter.className}`} style={{ "--oto-font": inter.style.fontFamily } as CSSProperties}>
      <style dangerouslySetInnerHTML={CSS} />
      {offer.isPreview && <PreviewPill label={v.ui.pill} detail={pillDetail} />}
      <main className="pg">
        <div className="banda">{v.topBar}</div>

        <section className="top">
          <div className="eyebrow">{v.eyebrow}</div>
          <h1>{v.headline}</h1>
          <p className="sub"><Rich text={v.intro} /></p>
          {v.pitch && <div className="intro"><span><Rich text={v.pitch} /></span></div>}
        </section>

        {/* Precio y botón en la primera pantalla del celular (análisis 07/10: solo el 16 % lo veía sin bajar). */}
        <section className="quick">
          {/* Lo que se lleva, a la vista antes de bajar: las tapas del kit (o la tapa del libro) arriba del precio. */}
          {(() => {
            const covers = (v.contents?.items ?? []).map((b) => b.cover).filter((c): c is string => !!c).slice(0, 6);
            if (covers.length > 1) return (
              <div className={`qcov n${covers.length}`} aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {covers.map((src, k) => <img key={src + k} src={src} alt="" decoding="async" style={{ zIndex: 10 - Math.abs(k - (covers.length - 1) / 2) * 2 }} />)}
              </div>
            );
            if (!v.video && v.cover) return (
              // eslint-disable-next-line @next/next/no-img-element
              <div className="qcov n1" aria-hidden><img src={v.cover} alt="" decoding="async" /></div>
            );
            return null;
          })()}
          <div className="qp">{v.compare && <span className="antes">{v.compare}</span>}<span className="hoy">{v.price}</span></div>
          {save && <div className="qsave">{save}</div>}
          <div className={revealed ? undefined : "hide"}>
            {cta("top")}
            <p className="shint">{v.ctaNote}</p>
            {status("top")}
          </div>
        </section>

        {v.video ? (
          <>
            <div className="watch">{v.video.label}</div>
            <section className="vid">
              <div className="marco">
                <video ref={videoRef} autoPlay muted playsInline preload="none" poster={v.video.poster || undefined}>
                  <source src={v.video.url} />
                </video>
                {sound !== "on" && (
                  <button type="button" className="sonido" onClick={withSound}>
                    <span className="ico">🔊</span>
                    <b>{sound === "blocked" ? v.video.playTitle : v.video.soundTitle}</b>
                    <i>{sound === "blocked" ? v.video.playCta : v.video.soundCta}</i>
                  </button>
                )}
              </div>
            </section>
          </>
        ) : v.contents ? (
          // Kit o biblioteca: cada libro por separado, con su tapa, qué es y sus páginas.
          <section className="libri">
            <div className="vt">{v.contents.title}</div>
            <div className={`lg${v.contents.items.length === 3 ? " n3" : ""}`}>
              {v.contents.items.map((b, k) => {
                const open = () => b.pages.length && setViewer({ imgs: b.pages, title: b.name, sub: b.pagesSub, i: 0 });
                return (
                  <article className="libro" key={b.name + k}>
                    <button type="button" className={`lcov${b.pages.length ? " zoom" : ""}`} onClick={open} aria-label={b.pages.length ? `${b.name} · ${b.seePages}` : b.name}>
                      {b.cover
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={b.cover} alt={b.name} loading="lazy" decoding="async" />
                        : <span className="lnone">{b.name}</span>}
                    </button>
                    <h3>{b.name}</h3>
                    {b.description && <p>{b.description}</p>}
                    {b.pages.length > 0 && <button type="button" className="lver" onClick={open}>{b.seePages} →</button>}
                  </article>
                );
              })}
            </div>
          </section>
        ) : v.cover ? (
          <section className="hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.cover} alt={v.productName} style={images.length ? { cursor: "zoom-in" } : undefined}
              onClick={() => { if (images.length) openGallery(0); }}
              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
          </section>
        ) : null}

        <section className="vitrina" ref={showcaseRef}>
          {v.gallery && (
            <>
              <div className="vt">{v.gallery.title}</div>
              <div className={`vg n${images.length}`}>
                {images.map((src, i) => (
                  <button type="button" className="tap" key={src + i} onClick={() => openGallery(i)}
                    aria-label={`${v.productName} · ${i + 1}/${images.length}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
                <p className="vpista">{v.gallery.caption}</p>
              </div>
            </>
          )}
          {v.stats && (
            <div className="vn">
              <Rich text={statsMain} />
              {statsRest.length > 0 && <em> — <Rich text={statsRest.join(" — ")} /></em>}
            </div>
          )}
        </section>

        <section id="oferta" className={`offer${marked ? " marca" : ""}`}>
          <div className="timer">{v.boxKicker}</div>
          <div className="body">
            <h2>{v.boxTitle}</h2>
            {v.boxSubtitle && <p className="promesa"><Rich text={v.boxSubtitle} /></p>}
            {v.bullets.map((b, i) => (
              <div className="b" key={i}><i>✓</i><span><Rich text={b} /></span></div>
            ))}
            <div className="precio">
              {v.compare && <span className="antes">{v.compare}</span>}
              <span className="hoy">{v.price}</span>
              <small>{v.priceNote}</small>
            </div>
            <div className={revealed ? undefined : "hide"}>
              {cta("box", boxCtaRef)}
              {status("box")}
            </div>
            <div className="trust">
              {v.guaranteeLines.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}
            </div>
            <a className="no" href={next} onClick={decline}>{v.noThanks}</a>
            {status("no")}
            <p className="nolab">{v.footnote}</p>
          </div>
        </section>

        {v.bottomBar && <div className="banda abajo">{v.bottomBar}</div>}
      </main>

      {viewer !== null && (
        <div className="hoj" role="dialog" aria-modal="true" aria-label={viewer.title}
          onClick={(e) => {
            // Tocar fuera de la página cierra: el fondo, el hueco al costado, la barra.
            const t = e.target as HTMLElement;
            if (t.tagName !== "IMG" && !t.closest("button")) setViewer(null);
          }}>
          <div className="hojtop">
            <div className="hojtit">{viewer.title}<span>{viewer.sub}</span></div>
            <button type="button" className="hojx" aria-label={v.ui.close} onClick={() => setViewer(null)}>×</button>
          </div>
          <div className="hojtira" ref={stripRef}>
            {viewer.imgs.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src + i} src={src} alt={`${viewer.title} ${i + 1}`} decoding="async" />
            ))}
          </div>
          <div className="hojpie">{v.gallery?.viewerHint ?? ""}</div>
        </div>
      )}

      <div className={`stick${stick && revealed ? " on" : ""}`}>
        {cta("stick")}
        <p className="shint">{v.ctaNote}</p>
      </div>

      {offer.sheetProps && <PaySheet {...offer.sheetProps} />}
    </div>
  );
}
