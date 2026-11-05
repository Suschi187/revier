// Edge Function send-chat-notifications (ADR 017, Review B2, A6, A7): von pg_cron jede Minute per pg_net aufgerufen.
// Prüft das Geheimnis im Header über die RPC (claim_chat_notifications vergleicht es mit dem Vault), holt fällige
// Empfänger, versendet je Empfänger eine Mail, gibt bei einem erkannten Fehler den Claim frei und meldet Erfolge
// zurück (confirm_chat_notifications setzt die Versuche auf 0).
// verify_jwt = false: Der Aufruf kommt aus der Datenbank ohne Nutzer-JWT. Nur POST.
// Logs nur Zahlen: keine Adressen, keine Namen, keine Titel, kein Nachrichtentext.
import { createClient } from "@supabase/supabase-js";
import { type Mailer, SmtpMailer } from "./mailer.ts";
import { composeMail, type Conversation, language } from "./texts.ts";

type Claim = { recipient_id: string; email: string | null; language: string; conversations: Conversation[] | null };

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function mailerFromEnv(): Mailer | null {
  const host = Deno.env.get("SMTP_HOST");
  const from = Deno.env.get("MAIL_FROM");
  if (!host || !from) return null;
  return new SmtpMailer(host, Number(Deno.env.get("SMTP_PORT") ?? "1025"), from);
}

function log(result: string, counts: Record<string, number> = {}): void {
  console.log(JSON.stringify({ fn: "send-chat-notifications", result, ...counts }));
}

export async function handle(request: Request, mailer: Mailer | null, siteUrl: string): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  const secret = request.headers.get("x-chat-notify-secret") ?? "";
  if (!mailer) {
    log("no_mailer");
    return Response.json({ error: "no_mailer" }, { status: 503 });
  }
  const { data, error } = await admin.rpc("claim_chat_notifications", { p_secret: secret });
  if (error) {
    const unauthorized = error.code === "42501";
    log(unauthorized ? "unauthorized" : "claim_failed");
    return Response.json({ error: unauthorized ? "unauthorized" : "claim_failed" }, { status: unauthorized ? 401 : 500 });
  }
  const claims = (data ?? []) as Claim[];
  const failed: string[] = [];
  const delivered: string[] = [];
  for (const claim of claims) {
    if (!claim.email || !claim.conversations?.length) continue;
    const lang = language(claim.language);
    const mail = composeMail(lang, siteUrl, claim.conversations);
    try {
      await mailer.send({ to: claim.email, ...mail });
      delivered.push(claim.recipient_id);
    } catch {
      failed.push(claim.recipient_id);
    }
  }
  if (failed.length) {
    await admin.rpc("release_chat_notifications", { p_secret: secret, p_recipients: failed });
  }
  // Erfolg setzt die Versuche zurück (QA M7 F4): Ein früherer Fehlschlag kürzt sonst die Versuche späterer Mails.
  if (delivered.length) {
    await admin.rpc("confirm_chat_notifications", { p_secret: secret, p_recipients: delivered });
  }
  const sent = delivered.length;
  log("done", { recipients: claims.length, sent, failed: failed.length });
  return Response.json({ recipients: claims.length, sent, failed: failed.length });
}

Deno.serve((request) => handle(request, mailerFromEnv(), (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "")));
