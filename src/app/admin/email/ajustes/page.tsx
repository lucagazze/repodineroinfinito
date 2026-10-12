import { Suspense } from "react";
import Shell from "@/components/admin/Shell";
import { Badge, Card } from "@/components/admin/ui";
import { SkCard } from "@/components/admin/Skeleton";
import { mktSettings, sentLast24h, storeSender } from "@/lib/mkt/settings";
import { brevoAccount, brevoConfigured, brevoDomains, webhookStatus } from "@/lib/mkt/brevo";
import { db } from "@/lib/db";
import { MktHead, mktStores } from "../shared";
import { BrevoActions, GeneralSettings, SenderForm } from "./SettingsClient";

export const dynamic = "force-dynamic";

/** Brevo (plan, dominios, webhook): va aparte para no frenar la página. */
async function BrevoCard() {
  if (!brevoConfigured()) return <Card tone="bad" title="Brevo"><p className="ad-note">Falta BREVO_API_KEY.</p></Card>;
  const base = process.env.PUBLIC_BASE_URL?.trim() ?? "";
  const [acct, domains, hook] = await Promise.all([brevoAccount(), brevoDomains(true).catch(() => []), base ? webhookStatus(base) : Promise.resolve(null)]);
  const noCredits = acct.credits === 0;
  return (
    <Card title="Brevo" sub="El proveedor de las campañas (aparte de los mails de entrega).">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-zinc-400">Plan</span><Badge tone={acct.plan === "free" ? "warn" : "ok"}>{acct.plan === "free" ? "Free" : acct.plan}</Badge>
        <span className="text-zinc-400">Créditos</span><Badge tone={noCredits ? "bad" : "ok"}>{acct.credits ?? "?"}{acct.creditsType ? ` (${acct.creditsType})` : ""}</Badge>
        {acct.error && <Badge tone="bad">{acct.error}</Badge>}
      </div>
      {noCredits && <p className="ad-flash bad mb-4">Brevo dice «sin créditos»: no sale ningún mail por Brevo (ni pruebas, ni el respaldo de las entregas) hasta pasar a un plan pago.</p>}
      <p className="mb-2 text-[12.5px] font-semibold text-zinc-300">Dominios</p>
      <ul className="mb-4 grid gap-1.5">
        {domains.map((d) => (
          <li key={d.name} className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <code>{d.name}</code>
            <Badge tone={d.authenticated ? "ok" : "warn"}>{d.authenticated ? "autenticado" : "falta el DNS"}</Badge>
            {!d.authenticated && d.name.startsWith("news.") && <BrevoActions domain={d.name} />}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-zinc-400">Webhook de rebotes, quejas y bajas</span>
        <Badge tone={hook ? "ok" : "warn"}>{hook ? "conectado" : "sin conectar"}</Badge>
        <BrevoActions webhook />
      </div>
    </Card>
  );
}

async function Senders() {
  const stores = await mktStores();
  const { data } = await db.from("stores").select("id,support_email").in("id", stores.map((s) => s.id));
  const support = new Map((data ?? []).map((s) => [s.id, s.support_email as string]));
  const rows = await Promise.all(stores.map(async (s) => ({ s, sender: await storeSender({ id: s.id, support_email: support.get(s.id) ?? "" }) })));
  return (
    <Card title="Remitente por tienda" sub="Un subdominio propio solo para marketing (news.*), autenticado en Brevo: si su reputación cae, no arrastra a los mails de entrega. Nunca la casilla de la tienda.">
      <div className="grid gap-4">
        {rows.map(({ s, sender }) => <SenderForm key={s.id} store={s.id} name={s.name} from={sender.from} replyTo={sender.replyTo} suggested={sender.suggested} />)}
      </div>
    </Card>
  );
}

export default async function Ajustes() {
  const [settings, used] = await Promise.all([mktSettings(), sentLast24h()]);
  return (
    <Shell>
      <MktHead tab="ajustes" sub="Interruptor general, tope diario, remitentes y Brevo." />
      <div className="grid gap-5">
        <GeneralSettings enabled={settings.enabled} dailyCap={settings.daily_cap} batch={settings.batch} used={used} />
        <Suspense fallback={<SkCard rows={4} />}><Senders /></Suspense>
        <Suspense fallback={<SkCard rows={5} />}><BrevoCard /></Suspense>
      </div>
    </Shell>
  );
}
