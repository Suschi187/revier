// Edge Function send-search-notifications (ADR 018): von pg_cron jede Minute per pg_net aufgerufen (Cron-Job
// search-notifications, ohne Vault-URL inaktiv). Versendet Suchauftrags- und Moderations-Mails in getrennten
// Schritten (handler.ts). Das Geheimnis im Header x-search-notify-secret prüfen die RPCs gegen den Vault (SHA-256).
// verify_jwt = false: Der Aufruf kommt aus der Datenbank ohne Nutzer-JWT. Nur POST. SITE_URL wird beim Start
// geprüft; ohne gültige SITE_URL oder ohne Mailer antwortet die Function mit 503.
import { createClient } from "@supabase/supabase-js";
import { mailerFromEnv } from "../_shared/mail/mailer.ts";
import { parseSiteUrl } from "../_shared/mail/site.ts";
import { handle, log, type Rpc } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rpc: Rpc = (fn, args) => admin.rpc(fn, args);

const SITE = parseSiteUrl(Deno.env.get("SITE_URL"));
if (!SITE) log("all", "invalid_site_url");

Deno.serve((request) => handle(request, { rpc, mailer: mailerFromEnv(), siteUrl: SITE }));
