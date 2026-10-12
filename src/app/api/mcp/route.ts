import { createMcpHandler } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { verifyApiToken } from "@/lib/api-tokens";
import { INSTRUCTIONS, registerAll } from "@/lib/mcp/server";

/**
 * Servidor MCP (Streamable HTTP) para operar el negocio desde Claude:
 *   claude mcp add --transport http checkout https://<app>/api/mcp --header "Authorization: Bearer cp_..."
 *
 * Única forma de entrar: un token de API (api_tokens) creado en el panel.
 * Sin token válido, 401 antes de tocar el protocolo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler((server) => registerAll(server), {
  serverInfo: { name: "checkout-propio", version: "1.0.0" },
  instructions: INSTRUCTIONS,
});

async function authed(req: Request): Promise<Response> {
  const tokenName = await verifyApiToken(req.headers.get("authorization")).catch(() => null);
  if (!tokenName) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: send the header Authorization: Bearer cp_... with an API token created in the admin panel." },
        id: null,
      }),
      { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="checkout-propio"' } }
    );
  }
  // El nombre del token llega a cada herramienta (ctx.http.authInfo) y queda en mcp_audit.
  (req as Request & { auth?: AuthInfo }).auth = { token: "cp_…", clientId: tokenName, scopes: ["all"] };
  return handler(req);
}

export { authed as GET, authed as POST, authed as DELETE };
