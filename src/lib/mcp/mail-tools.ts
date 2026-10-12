import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/secrets";
import { defineTool, getStore, storeArg, UserError } from "./util";

/** La casilla de correo (SMTP del proveedor) desde la que cada tienda manda sus mails. */
export function registerMailTools(server: McpServer) {
  defineTool(server, "set_store_smtp", {
    title: "Set the store's sending mailbox (SMTP)",
    kind: "write",
    external: true,
    description:
      "Connect the mailbox a store sends its emails from (delivery, upsell, cart recovery) — e.g. host smtp.yourprovider.com, port 465 SSL; username = the full address, e.g. info@yourbrand.com. The password is verified against the server first (nothing is saved if login fails), then stored encrypted. Optionally sends a test email to `test_to`. From then on the store sends through this mailbox; if it fails, the API provider (Brevo/Postmark) is used as fallback. `remove: true` disconnects it.",
    input: z.object({
      store: storeArg,
      username: z.string().email().optional(),
      password: z.string().min(1).max(200).optional(),
      host: z.string(),
      port: z.number().int().default(465),
      test_to: z.string().email().optional(),
      remove: z.boolean().default(false),
    }),
    handler: async ({ store, username, password, host, port, test_to, remove }) => {
      const s = await getStore(store);
      if (remove) {
        await db.from("store_mail").delete().eq("store_id", s.id);
        return { removed: true, store };
      }
      if (!username || !password) throw new UserError("Pass username (full email address) and password.");
      const nodemailer = await import("nodemailer");
      const tx = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: username, pass: password }, connectionTimeout: 10_000 });
      try {
        await tx.verify();
      } catch (e) {
        throw new UserError(`Login to ${host}:${port} as ${username} failed: ${(e as Error).message}. Nothing was saved.`);
      }
      const { error } = await db.from("store_mail").upsert({
        store_id: s.id, host, port, username, password_enc: encrypt(password), updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      let test: string | null = null;
      if (test_to) {
        const info = await tx.sendMail({
          from: `"${s.display_name || s.name}" <${username}>`, to: test_to, replyTo: s.support_email,
          subject: `Test · ${s.display_name || s.name}`,
          html: `<p>Mail de prueba de <b>${s.display_name || s.name}</b> enviado por ${host} desde ${username}.</p><p>Si llegó acá, la entrega por esta casilla funciona.</p>`,
        });
        test = info.messageId ?? "sent";
      }
      return { saved: true, store, host, port, username, test_sent: test };
    },
  });
}
