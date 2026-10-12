/**
 * Corre antes de pintar el panel: si se eligió modo oscuro o modo captura, el
 * contenedor ya nace con la clase (sin destello). Va aparte de Theme.tsx
 * porque lo importan server components y un módulo "use client" no exporta valores.
 */
export const THEME_SCRIPT =
  'try{var e=document.currentScript.parentElement;if(localStorage.getItem("ad-theme")==="dark")e.classList.add("dark");if(localStorage.getItem("ad-privacy")==="1")e.classList.add("privacy")}catch(e){}';
