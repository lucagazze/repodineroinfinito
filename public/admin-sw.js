/*
 * Service worker del panel (app instalada): solo notificaciones push.
 * No guarda nada offline: el panel siempre pide los datos frescos.
 * Lo registra PushToggle con scope /admin.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil((async () => {
    // Botones («Ver opciones», «Enviar: …»): Chrome, Android y escritorio. Safari (iPhone) no los muestra:
    // ahí el toque abre la pantalla rápida. Cada botón solo abre una página: nunca manda nada.
    const max = (self.Notification && self.Notification.maxActions) || 0;
    const actions = Array.isArray(d.actions) && max > 0 ? d.actions.slice(0, max) : [];
    const urls = {};
    for (const a of actions) urls[a.action] = a.url;
    // Siempre se muestra algo: iOS da de baja la suscripción si un push llega sin notificación.
    await self.registration.showNotification(d.title || "Panel", {
      body: d.body || "",
      icon: "/brand/icon-192.png?v=3",
      badge: "/brand/badge-96.png?v=3",
      tag: d.tag || undefined,
      data: { url: d.url || "/admin", actions: urls },
      timestamp: Date.now(),
      ...(actions.length ? { actions: actions.map((a) => ({ action: a.action, title: a.title })) } : {}),
    });
    // Aviso a las pestañas abiertas del panel (lo usan las pruebas).
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) c.postMessage({ type: "push", data: d });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Un botón abre su página (la pantalla rápida con esa opción elegida); el toque, la del aviso.
  const target = (event.action && data.actions && data.actions[event.action]) || data.url || "/admin";
  const url = new URL(target, self.location.origin).href;
  event.waitUntil((async () => {
    // Si el panel ya está abierto, se usa esa ventana; si no, se abre.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (win) {
      await win.focus().catch(() => {});
      if ("navigate" in win) {
        const ok = await win.navigate(url).then(() => true, () => false);
        if (ok) return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// El navegador renovó la suscripción: se guarda la nueva con lo que recibía la vieja.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const sub = event.newSubscription || (old && await self.registration.pushManager.subscribe(old.options));
    if (!sub) return;
    await fetch("/api/admin/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: old ? old.endpoint : undefined }),
    });
  })());
});
