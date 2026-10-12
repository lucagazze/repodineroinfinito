import { Globe } from "lucide-react";
import { scopeFor } from "@/lib/admin/offers";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { countryName } from "@/lib/admin-data";
import { Card, PageHead, Badge, Empty, Flag, Table } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const LOCAL_METHODS: [string, string, string][] = [
  ["EUR", "Italia, España, Portugal, Bélgica, Austria…", "Satispay, Bizum, MB Way, Multibanco, Bancontact, EPS, iDEAL"],
  ["BRL", "Brasil", "Pix"],
  ["MXN", "México", "OXXO"],
  ["PLN", "Polonia", "BLIK"],
  ["USD", "Estados Unidos y el resto", "Klarna, Affirm, Afterpay, Cash App, Amazon Pay"],
];

/** Markets, solo para mirar: en qué moneda paga cada país. */
export default async function Markets({ params }: { params: Promise<{ offer: string }> }) {
  const sc = await scopeFor((await params).offer);
  const store = sc.store;
  const [{ data: markets }, rates] = await Promise.all([
    db.from("markets").select("id,name,currency,countries").eq("store_id", store.id).order("name"),
    getRates(),
  ]);

  return (
    <>
      <PageHead title="Markets" icon={<Globe className="h-[18px] w-[18px]" />} color="#0ea5e9"
        sub="En qué moneda paga cada país. Cobrar en la moneda local es lo que habilita sus métodos de pago." />

      <div className="ad-grid g-21">
        <Card title="Mercados con precio propio" sub="Esos países pagan el precio cargado en cada producto para esa moneda." pad={false}>
          {markets?.length ? (
            <Table head={["Mercado", "Países", { label: "1 US$ =", num: true, hideM: true }]}>
              {markets.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.name}</b> <Badge tone="brand">{m.currency}</Badge></td>
                  <td>
                    {m.countries?.length
                      ? <span className="flex flex-wrap gap-1.5">{m.countries.map((c: string) => <span key={c} className="inline-flex items-center whitespace-nowrap text-[12px]"><Flag cc={c} />{countryName(c)}</span>)}</span>
                      : <span className="text-zinc-400">sin países</span>}
                  </td>
                  <td className="num hide-m">{m.currency !== "USD" && rates[m.currency] ? rates[m.currency].toFixed(2) : "—"}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty title="Sin mercados" icon={<Globe className="h-5 w-5" />}>Todos los países pagan con conversión automática desde USD.</Empty>}
        </Card>

        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="El resto de los países">
            <p className="ad-note">
              Si un país no está en un mercado, paga en su moneda local convirtiendo el precio en USD al tipo de cambio del día,
              con redondeo de vidriera (146,43 → 146,90). Argentina y los países sin moneda compatible pagan en USD.
            </p>
          </Card>
          <Card title="Qué métodos habilita cada moneda" pad={false}>
            <Table head={["Moneda", "Métodos"]}>
              {LOCAL_METHODS.map(([cur, where, methods]) => (
                <tr key={cur}>
                  <td style={{ width: 80 }}><Badge tone="brand">{cur}</Badge>{rates[cur] && cur !== "USD" ? <span className="sub">1 US$ = {rates[cur].toFixed(2)}</span> : null}</td>
                  <td><b>{methods}</b><span className="sub">{where}</span></td>
                </tr>
              ))}
            </Table>
            <p className="ad-note px-5 pb-4 pt-3">Cada método tiene que estar activado en Stripe → Configuración → Métodos de pago.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
