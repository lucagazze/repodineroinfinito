import type { Metadata } from "next";
import { pageCtx, type PageProps } from "@/app/catalogo/_ui/ctx";
import { Shell, LegalDoc } from "@/app/catalogo/_ui/shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const c = await pageCtx(props, "/refund-policy");
  return c.meta(`${c.t.ui.docs.refund} · ${c.brand}`, c.t.ui.refundIntro);
}

export default async function RefundPolicyPage(props: PageProps) {
  const c = await pageCtx(props, "/refund-policy");
  return (
    <Shell c={c}>
      <LegalDoc c={c} doc="refund" intro={c.t.ui.refundIntro} />
    </Shell>
  );
}
