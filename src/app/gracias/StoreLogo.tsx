"use client";

import { useEffect, useRef, useState } from "react";

/**
 * El logo de la tienda, solo si es un logo de verdad: una imagen apaisada
 * (wordmark). Las tiendas tienen cargada como "logo" la foto de perfil
 * cuadrada de Instagram, y arriba de las descargas se leía como un avatar
 * cualquiera. Si no pasa, queda el nombre de la tienda en la barra.
 */
export function StoreLogo({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [ok, setOk] = useState(false);
  const check = () => {
    const im = ref.current;
    if (im && im.naturalWidth && im.naturalHeight) setOk(im.naturalWidth / im.naturalHeight >= 1.6);
  };
  // Si cargó antes de que React se enganche, onLoad no vuelve a dispararse.
  useEffect(() => { if (ref.current?.complete) check(); }, []);
  return (
    <div className="brand" style={ok ? undefined : { display: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={src} alt={alt} onLoad={check} onError={() => setOk(false)} />
    </div>
  );
}
