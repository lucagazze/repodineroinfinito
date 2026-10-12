import { createMcpHandler } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { partnerForToken } from "@/lib/partner-scope";
import { PARTNER_INSTRUCTIONS, registerPartnerTools } from "@/lib/mcp/partner-tools";

/**
 * MCP del socio (Streamable HTTP), aparte del del dueño:
 *   claude mcp add --transport http socio https://<app>/api/mcp-socio --header "Authorization: Bearer cs_..."
 * Solo con el token del socio (Socios › «Token para su IA»); ve y toca únicamente sus ofertas (partner-tools).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler((server) => registerPartnerTools(server), {
  serverInfo: { name: "checkout-propio-socio", version: "1.0.0" },
  instructions: PARTNER_INSTRUCTIONS,
});

async function authed(req: Request): Promise<Response> {
  const email = await partnerForToken(req.headers.get("authorization")).catch(() => null);
  if (!email) {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer cs_... (the partner token el dueño gave you)." }, id: null }),
      { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="checkout-propio-socio"' } },
    );
  }
  (req as Request & { auth?: AuthInfo }).auth = { token: "cs_…", clientId: email, scopes: ["partner"] };
  return handler(req);
}

export { authed as GET, authed as POST, authed as DELETE };
