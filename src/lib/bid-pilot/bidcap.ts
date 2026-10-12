import { db } from "@/lib/db";
import { BUSY_PCT, metaBatch, metaError, metaGet, metaPost, metaPressure } from "@/lib/admin/meta-conn";
import { resolveAlerts } from "@/lib/alerts";
import { sendPush } from "@/lib/push";
import { logActivity, short } from "./activity";
import { defaultsFor, pilotSettings } from "./run";
import { frontCeilings, frontLabel } from "./front";
import { BID_CAP, BIDCAP_BUDGET, bidCapCreative, bidCapName, bidCapTargeting, ceilingFromFront, checkBuilt, ladderPcts, needsDsa, targetFor, type WinnerCreative } from "./rules";

/**
 * «Pasar a BID CAP»: lo que pasa cuando el dueño toca el botón en la pantalla del
 * ganador (nunca solo). En la misma cuenta arma una campaña nueva
 * «BID CAP - <Mercado> - <Oferta> - <anuncio>»: Ventas, límite de puja, 500 USD
 * por día, en ESCALERA: 3 conjuntos con pujas fijas al 50, 60 y 70 % del precio
 * del libro (el front de la oferta; el último escalón es el tope del piloto),
 * cada uno con el público, el pixel y la optimización del ganador (con las
 * reglas del dueño: sin Advantage+, Facebook + Instagram manual, excluyendo a los
 * compradores) y un anuncio con el MISMO posteo del ganador (sus «me gusta» y
 * comentarios siguen sumando). El piloto no mueve esas pujas: solo apaga el
 * escalón que compra más caro que el libro.
 *
 * planBidCap solo LEE y arma lo que se mandaría (también lo usa «Ver qué se
 * crea»). promoteWinner lo crea todo PAUSADO, lo vuelve a leer y lo compara
 * con lo pedido; recién entonces lo prende (anuncio, conjunto y al final la
 * campaña). Si algo falla en el medio queda pausado y hay un aviso: nunca una
 * campaña a medio armar prendida. Al final la anota en el piloto de pujas,
 * que desde la próxima hora maneja su puja.
 */

type Aud = { id: string; name?: string };
type WAd = { id: string; name: string; adset_id: string; campaign_id: string; account_id?: string; effective_status: string; campaign?: { id: string; name: string }; creative?: WinnerCreative & { id?: string } };
type WSet = {
  id: string; targeting?: Record<string, unknown>; promoted_object?: { pixel_id?: string; custom_event_type?: string; custom_conversion_id?: string };
  optimization_goal?: string; billing_event?: string; attribution_spec?: unknown[]; destination_type?: string; dsa_beneficiary?: string; dsa_payor?: string;
};
type RefSet = { id: string; campaign_id: string; promoted_object?: { pixel_id?: string }; targeting?: { excluded_custom_audiences?: Aud[] }; dsa_beneficiary?: string; dsa_payor?: string };
type Page<T> = { data?: T[]; paging?: { next?: string } };
type Row = { ad_id: string; account_id: string; campaign_id: string; campaign_name: string | null; adset_id: string | null; ad_name: string | null; target: number | null };

export type BidCapPlan = {
  act: string; adId: string; adName: string; cboId: string; cboName: string;
  name: string; target: number; budget: number; pixel: string | null;
  /** El precio del libro (front) en USD y su etiqueta («USD 27»); el tope del piloto (70 %). */
  frontUsd: number | null; frontLabel: string | null; ceiling: number | null;
  /** Los escalones: % del precio y puja fija (USD). */
  rungs: { pct: number; bid: number; name: string }[];
  exclude: Aud[]; dsa: { b: string; p: string } | null;
  /** Ya corre ese posteo en una BID CAP de la cuenta (su id): no se arma otra. */
  dupCampaign: string | null;
  /** Lo que impide crearla (sin nada de esto, se puede). */
  problems: string[];
  /** Lo que se le mandaría a Meta (sin los ids que se conocen al crear). */
  /** El conjunto (sin nombre ni puja: van por escalón). */
  creative: Record<string, string>; campaign: Record<string, string>; adset: Record<string, string>;
};
export type PromoteResult =
  | { ok: true; name: string; campaignId: string; adsetIds: string[]; adIds: string[]; campaignStatus: string }
  | { ok: false; error: string };

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const usd2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const flat = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

/**
 * Solo lecturas, livianas (el token tiene poco cupo por usuario): un pedido con el ganador, su
 * conjunto, las campañas y los conjuntos activos de la cuenta SIN su público; después el público
 * de unos pocos conjuntos BID CAP con el mismo pixel (para copiar su exclusión de compradores) y
 * los posteos de las BID CAP (para no armar otra con el mismo). Con `row` usa los datos de la
 * propuesta; sin ella, los saca del anuncio.
 */
export async function planBidCap(adId: string, row?: Row | null): Promise<BidCapPlan> {
  const head = row ?? await (async () => {
    const a = await metaGet<WAd>(adId, { fields: "id,name,account_id,adset_id,campaign{id,name}" });
    return { ad_id: adId, account_id: `act_${String(a.account_id ?? "").replace(/^act_/, "")}`, campaign_id: a.campaign?.id ?? "", campaign_name: a.campaign?.name ?? "", adset_id: a.adset_id, ad_name: a.name, target: null } as Row;
  })();
  const act = head.account_id;
  // El precio del libro (de la base): el de la oferta a la que manda la CBO donde ganó.
  const { ceilingPct } = await pilotSettings();
  const front = (await frontCeilings([head.campaign_id], ceilingPct / 100)).get(head.campaign_id) ?? null;
  const [info, ad, wset, camps, sets] = await metaBatch([
    `${act}?fields=currency`,
    `${adId}?fields=id,name,adset_id,campaign_id,effective_status,creative{id,effective_object_story_id,instagram_user_id,url_tags,contextual_multi_ads}`,
    `${head.adset_id}?fields=id,targeting,promoted_object,optimization_goal,billing_event,attribution_spec,destination_type,dsa_beneficiary,dsa_payor`,
    `${act}/campaigns?${qs({ fields: "id,bid_strategy", effective_status: JSON.stringify(["ACTIVE", "PAUSED"]), limit: "500" })}`,
    `${act}/adsets?${qs({ fields: "id,campaign_id,promoted_object,dsa_beneficiary,dsa_payor", effective_status: JSON.stringify(["ACTIVE"]), limit: "300" })}`,
  ], 30_000) as [{ currency?: string }, WAd, WSet, Page<{ id: string; bid_strategy?: string }>, Page<RefSet>];
  const problems: string[] = [];
  if ((info.currency ?? "").toUpperCase() !== "USD") problems.push(`la cuenta no está en USD (${info.currency})`);
  if (ad.campaign_id !== head.campaign_id) problems.push("el anuncio ya no está en la campaña CBO donde ganó");
  const post = ad.creative?.effective_object_story_id ?? null;
  if (!post) problems.push("el anuncio no tiene un posteo para reusar");

  const pixel = wset.promoted_object?.pixel_id ?? null;
  const bidCaps = new Set((camps.data ?? []).filter((c) => c.bid_strategy === BID_CAP).map((c) => c.id));
  const others = sets.data ?? [];
  const samePixel = others.filter((s) => pixel && s.promoted_object?.pixel_id === pixel && s.id !== wset.id);
  // De dónde copiar la exclusión de compradores: hasta 4 conjuntos BID CAP con su pixel (si no hay, otros con su pixel).
  const refIds = (samePixel.some((s) => bidCaps.has(s.campaign_id)) ? samePixel.filter((s) => bidCaps.has(s.campaign_id)) : samePixel).slice(0, 4).map((s) => s.id);
  // ¿Ese posteo ya corre en una BID CAP? (por ejemplo, el dueño la armó a mano mientras tanto)
  const [refs, theirs] = await Promise.all([
    refIds.length ? metaGet<Record<string, RefSet>>("", { ids: refIds.join(","), fields: "targeting" }) : Promise.resolve({} as Record<string, RefSet>),
    post && bidCaps.size ? metaGet<Page<{ campaign_id: string; creative?: { effective_object_story_id?: string } }>>(`${act}/ads`, {
      fields: "campaign_id,creative{effective_object_story_id}", limit: "500",
      filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: [...bidCaps] }]),
    }) : Promise.resolve({ data: [] } as Page<{ campaign_id: string; creative?: { effective_object_story_id?: string } }>),
  ]);
  const dupCampaign = (theirs.data ?? []).find((x) => post && x.creative?.effective_object_story_id === post)?.campaign_id ?? null;

  // Compradores a excluir: los del ganador y los de esos conjuntos; si no hay, el público «Compradores…» de ese pixel.
  let exclude: Aud[] = [
    ...((wset.targeting?.excluded_custom_audiences as Aud[] | undefined) ?? []),
    ...Object.values(refs).flatMap((s) => s?.targeting?.excluded_custom_audiences ?? []),
  ];
  if (!exclude.length && pixel) {
    const auds = await metaGet<Page<{ id: string; name: string; rule?: string }>>(`${act}/customaudiences`, { fields: "id,name,rule", limit: "200" });
    exclude = (auds.data ?? []).filter((a) => /compradores/i.test(a.name) && (a.rule ?? "").includes(pixel) && /purchase/i.test(a.rule ?? ""));
  }
  exclude = [...new Map(exclude.map((a) => [String(a.id), { id: String(a.id), name: a.name }])).values()];
  if (!exclude.length) problems.push(`no hay un público de compradores del pixel ${pixel ?? "(sin pixel)"} para excluirlos: creá «Compradores … (180d)» y probá de nuevo`);

  const targeting = bidCapTargeting(wset.targeting ?? {}, exclude);
  const refDsa = others.find((s) => bidCaps.has(s.campaign_id) && s.dsa_beneficiary) ?? others.find((s) => s.dsa_beneficiary);
  const dsa = wset.dsa_beneficiary ? { b: wset.dsa_beneficiary, p: wset.dsa_payor || wset.dsa_beneficiary }
    : needsDsa(targeting) && refDsa ? { b: refDsa.dsa_beneficiary!, p: refDsa.dsa_payor || refDsa.dsa_beneficiary! } : null;
  if (!dsa && needsDsa(targeting)) problems.push("llega a Europa y no hay datos de la DSA (beneficiario y pagador) para copiar");
  const cboName = head.campaign_name ?? "";
  const name = bidCapName(cboName, ad.name);
  const target = Number(head.target) || targetFor(name);
  if (!front) problems.push("la CBO no está vinculada a un checkout de acá: sin el precio del libro no se arma la escalera (vinculala desde la oferta)");
  const rungs = front ? ladderPcts(ceilingPct / 100).map((pct) => ({ pct, bid: ceilingFromFront(front.usd, pct), name: `Winner ${Math.round(pct * 100)} %` })) : [];
  if (rungs.some((r) => !(r.bid >= 1))) problems.push("las pujas de la escalera quedan por debajo de 1 USD");
  const po = Object.fromEntries(Object.entries({ pixel_id: pixel, custom_event_type: wset.promoted_object?.custom_event_type, custom_conversion_id: wset.promoted_object?.custom_conversion_id }).filter(([, v]) => v));
  return {
    act, adId, adName: ad.name, cboId: head.campaign_id, cboName, name, target, budget: BIDCAP_BUDGET, pixel, exclude, dsa, dupCampaign, problems,
    frontUsd: front?.usd ?? null, frontLabel: front ? frontLabel(front) : null, ceiling: front?.max ?? null, rungs,
    creative: post ? flat(bidCapCreative(ad.creative!, `${ad.name} · BID CAP`)) : {},
    campaign: { name, objective: "OUTCOME_SALES", status: "PAUSED", special_ad_categories: "[]", buying_type: "AUCTION", bid_strategy: BID_CAP, daily_budget: String(BIDCAP_BUDGET * 100) },
    adset: flat({
      status: "PAUSED",
      billing_event: wset.billing_event || "IMPRESSIONS", optimization_goal: wset.optimization_goal || "OFFSITE_CONVERSIONS",
      promoted_object: po, targeting,
      ...(wset.attribution_spec?.length ? { attribution_spec: wset.attribution_spec } : {}),
      ...(wset.destination_type && wset.destination_type !== "UNDEFINED" ? { destination_type: wset.destination_type } : {}),
      ...(dsa ? { dsa_beneficiary: dsa.b, dsa_payor: dsa.p } : {}),
    }),
  };
}

export async function promoteWinner(adId: string): Promise<PromoteResult> {
  const pre = await metaPressure();
  if (pre.pct >= BUSY_PCT) return { ok: false, error: `Meta está al ${Math.round(pre.pct)} % de su límite de consultas: probá de nuevo en ${pre.regainMin || 15} min.` };

  // Se toma la propuesta una sola vez (dos toques no arman dos campañas).
  const startIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db.from("meta_auto_winners")
    .update({ status: "creating", decided_at: startIso, updated_at: startIso, error: null })
    .eq("ad_id", adId).eq("status", "proposed").gt("expires_at", startIso).select("ad_id,account_id,campaign_id,campaign_name,adset_id,ad_name,target");
  if (claimErr) return { ok: false, error: claimErr.message };
  const w = claimed?.[0] as Row | undefined;
  if (!w) return { ok: false, error: "Esta propuesta ya no está pendiente: se usó, se descartó o venció." };
  const act = w.account_id;
  const ids: { creative?: string; campaign?: string; adsets: string[]; ads: string[] } = { adsets: [], ads: [] };
  let step = "leer el anuncio ganador";

  // Antes de crear nada: vuelve a quedar pendiente (se puede probar de nuevo). Después: queda pausado y con aviso.
  const fail = async (why: string): Promise<PromoteResult> => {
    const created = !!(ids.creative || ids.campaign || ids.adsets.length || ids.ads.length);
    if (ids.campaign) await metaPost(ids.campaign, { status: "PAUSED" }).catch(() => null);
    const error = created ? `Falló al ${step}: ${why}. Lo que se llegó a crear quedó PAUSADO.` : `No se pudo ${step}: ${why}`;
    await db.from("meta_auto_winners").update({
      status: created ? "failed" : "proposed", error, updated_at: new Date().toISOString(),
      new_campaign_id: ids.campaign ?? null, new_adset_id: ids.adsets.join(",") || null, new_ad_id: ids.ads.join(",") || null, new_creative_id: ids.creative ?? null,
    }).eq("ad_id", adId);
    await logActivity({
      kind: "bidcap_failed", accountId: act, campaignId: w.campaign_id, campaignName: w.campaign_name, adId,
      title: `BID CAP sin crear · ${w.ad_name ?? adId}`, body: `${error}${ids.campaign ? ` Campaña ${ids.campaign}.` : ""}`,
      link: `/admin/piloto/ganador/${adId}`, numbers: { ...ids },
      // Con algo creado es un error (push); si no se creó nada, se ve en pantalla y queda en Avisos.
      alert: { severity: created ? "error" : "warn", ref: `bidcap-fail:${adId}` },
    });
    return { ok: false, error };
  };

  try {
    // ---- 1. Leer y armar (sin escribir nada).
    const plan = await planBidCap(adId, w);
    if (plan.dupCampaign) {
      const error = `Su posteo ya corre en una BID CAP (campaña ${plan.dupCampaign}): no se crea otra.`;
      await db.from("meta_auto_winners").update({ status: "dismissed", error, updated_at: new Date().toISOString() }).eq("ad_id", adId);
      await resolveAlerts("meta_auto", [`win:${adId}`]);
      return { ok: false, error };
    }
    if (plan.problems.length) return fail(plan.problems.join("; "));
    const budgetCents = plan.budget * 100;

    // ---- 2. Crear todo PAUSADO. Primero el creativo (no sale a ningún lado por sí solo).
    step = "crear el creativo";
    ids.creative = (await metaPost<{ id: string }>(`${act}/adcreatives`, plan.creative)).id;
    step = "crear la campaña";
    ids.campaign = (await metaPost<{ id: string }>(`${act}/campaigns`, plan.campaign)).id;
    // La escalera: un conjunto por escalón (mismo público, pujas fijas) con su anuncio (el mismo creativo).
    for (const r of plan.rungs) {
      step = `crear el conjunto ${r.name}`;
      const set = (await metaPost<{ id: string }>(`${act}/adsets`, { ...plan.adset, name: r.name, bid_amount: String(Math.round(r.bid * 100)), campaign_id: ids.campaign })).id;
      ids.adsets.push(set);
      step = `crear el anuncio de ${r.name}`;
      ids.ads.push((await metaPost<{ id: string }>(`${act}/ads`, {
        name: plan.adName, adset_id: set, creative: JSON.stringify({ creative_id: ids.creative }), status: "PAUSED",
      })).id);
    }

    // ---- 3. Leer de vuelta y comparar con lo pedido, antes de prender nada.
    step = "verificar lo creado";
    type Read = Parameters<typeof checkBuilt>[0];
    const n = plan.rungs.length;
    const read = await metaBatch([
      `${ids.campaign}?fields=bid_strategy,daily_budget,objective,status`,
      ...ids.adsets.map((x) => `${x}?fields=bid_amount,status,promoted_object,targeting`),
      ...ids.ads.map((x) => `${x}?fields=status,effective_status,creative{id},issues_info`),
    ], 25_000).catch(() => Array(1 + 2 * n).fill(null)) as unknown[];
    const problems = [...new Set(plan.rungs.flatMap((r, i) => checkBuilt(
      { campaign: read[0] as Read["campaign"], adset: read[1 + i] as Read["adset"], ad: read[1 + n + i] as Read["ad"] },
      { bidCents: Math.round(r.bid * 100), budgetCents, pixelId: plan.pixel, exclude: plan.exclude.map((a) => a.id), creativeId: ids.creative! },
    ).map((p) => (p.includes("campaña") ? p : `${r.name}: ${p}`))))];
    if (problems.length) return fail(problems.join("; "));

    // ---- 4. Prender: el anuncio, el conjunto y al final la campaña (hasta ahí no sale nada).
    step = "prender los anuncios";
    for (const x of ids.ads) await metaPost(x, { status: "ACTIVE" });
    step = "prender los conjuntos";
    for (const x of ids.adsets) await metaPost(x, { status: "ACTIVE" });
    step = "prender la campaña";
    await metaPost(ids.campaign, { status: "ACTIVE" });
    step = "confirmar que quedó prendida";
    const back = await metaBatch([`${ids.campaign}?fields=status`, ...ids.adsets.map((x) => `${x}?fields=status`), ...ids.ads.map((x) => `${x}?fields=status,effective_status`)], 25_000) as { status?: string; effective_status?: string }[];
    const labels = ["la campaña", ...plan.rungs.map((r) => `el conjunto ${r.name}`), ...plan.rungs.map((r) => `el anuncio de ${r.name}`)];
    const off = labels.filter((_, i) => back[i]?.status !== "ACTIVE");
    if (off.length) return fail(`${off.join(", ")} no quedó prendido`);

    // ---- 5. Al piloto: la campaña (tope = 70 % del libro) y los 3 escalones marcados como escalera (puja fija).
    const at = new Date().toISOString();
    await db.from("bid_pilot_campaigns").upsert({
      campaign_id: ids.campaign, account_id: act, name: plan.name, enabled: true, ...defaultsFor(plan.name), target_cpa: plan.target,
      max_bid: plan.ceiling ?? Math.round(plan.target * 1.5 * 100) / 100, max_manual: false,
      front_usd: plan.frontUsd == null ? null : Math.round(plan.frontUsd * 100) / 100, front_label: plan.frontLabel, front_via: "vinculo",
      daily_budget: plan.budget, status: "ACTIVE", updated_at: at,
    }, { onConflict: "campaign_id" });
    await db.from("bid_pilot_adsets").upsert(plan.rungs.map((r, i) => ({
      adset_id: ids.adsets[i], campaign_id: ids.campaign, account_id: act, name: r.name, status: "ACTIVE", bid: r.bid,
      ladder: true, ladder_pct: r.pct, last_set_bid: r.bid, last_change_at: at, first_seen_at: at,
      last_change_reason: `Escalón de la escalera (${Math.round(r.pct * 100)} % del libro), creado por el Piloto Meta Ads.`,
      state: "escalera", reason: "Puja fija: el piloto solo lo apaga si el CPA de 3 días pasa el precio del libro.", updated_at: at,
    })), { onConflict: "adset_id" });
    await db.from("meta_auto_winners").update({
      status: "created", new_name: plan.name, new_campaign_id: ids.campaign, new_adset_id: ids.adsets.join(","), new_ad_id: ids.ads.join(","), new_creative_id: ids.creative, error: null, updated_at: at,
    }).eq("ad_id", adId);
    await resolveAlerts("meta_auto", [`win:${adId}`]);
    const st = back[1 + plan.rungs.length]?.effective_status;
    const review = st && st !== "ACTIVE" ? ` · anuncios ${["IN_PROCESS", "PENDING_REVIEW"].includes(st) ? "en revisión de Meta" : st}` : "";
    const ladder = plan.rungs.map((r) => `${Math.round(r.pct * 100)} % ${usd2(r.bid)}`).join(" / ");
    await logActivity({
      kind: "bidcap_created", accountId: act, campaignId: ids.campaign, campaignName: plan.name, adId, at, link: "/admin/piloto",
      title: `✅ BID CAP creada · ${plan.name}`,
      body: `Escalera ${ladder} USD (libro ${plan.frontLabel}) · ${plan.budget} USD/día · mismo posteo de «${plan.adName}» · excluye ${plan.exclude.map((a) => a.name ?? a.id).join(", ")}${review}.`,
      numbers: { ...ids, rungs: plan.rungs, frontUsd: plan.frontUsd, budget: plan.budget, exclude: plan.exclude, from: { campaign: w.campaign_id, adset: w.adset_id, ad: adId } },
      alert: { severity: "info", ref: `bidcap:${ids.campaign}` },
    });
    await sendPush("meta_auto", { title: `✅ BID CAP creada · ${short(plan.name)}`, body: `Escalera ${plan.rungs.map((r) => usd2(r.bid)).join(" / ")} · ${plan.budget}/día`, url: "/admin/piloto", tag: `bidcap:${ids.campaign}` });
    return { ok: true, name: plan.name, campaignId: ids.campaign, adsetIds: ids.adsets, adIds: ids.ads, campaignStatus: back[0]?.status ?? "ACTIVE" };
  } catch (e) {
    return fail(metaError(e));
  }
}

/** «Ahora no»: la propuesta se cierra (no se vuelve a proponer ese anuncio). */
export async function dismissWinner(adId: string) {
  const at = new Date().toISOString();
  const { data } = await db.from("meta_auto_winners").update({ status: "dismissed", decided_at: at, updated_at: at })
    .eq("ad_id", adId).eq("status", "proposed").select("ad_id,account_id,campaign_id,campaign_name,ad_name");
  const w = data?.[0];
  if (!w) return { ok: false as const, error: "Esta propuesta ya no está pendiente." };
  await resolveAlerts("meta_auto", [`win:${adId}`]);
  await logActivity({ kind: "winner_dismissed", accountId: w.account_id, campaignId: w.campaign_id, campaignName: w.campaign_name, adId, at, title: `Ganador descartado · ${w.ad_name ?? adId}`, body: "Tocaste «Ahora no»: no se vuelve a proponer." });
  return { ok: true as const };
}
