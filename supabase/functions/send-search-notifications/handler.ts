// Ablauf der Function send-search-notifications (ADR 018, Review B2, B4, A5, A8, H8), ohne Umgebung: index.ts setzt
// RPC-Client, Mailer und SITE_URL ein, die Tests einen Mock. Zwei getrennte Schritte mit eigenen Zählern:
//   1. Suchauftrags-Mails: claim_search_notifications → senden → confirm (Erfolg) bzw. release (Fehler), je claim_id.
//   2. Moderations-Mails: claim_moderation_notifications → senden → confirm bzw. release, je claim_id.
// Logs und Antwort nur Zähler: keine Adressen, Titel, Namen, Begründungen oder Token.
import type { Mailer } from "../_shared/mail/mailer.ts";
import { unsubscribeHeaders, validToken } from "../_shared/mail/site.ts";
import {
  composeModerationMail,
  composeSearchMail,
  isDecision,
  language,
  type ModerationClaim,
  type SearchInfo,
  type SearchItem,
} from "./texts.ts";

export const FN = "send-search-notifications";

export type RpcError = { code?: string } | null;
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;

export type Deps = { rpc: Rpc; mailer: Mailer | null; siteUrl: string | null };

type SearchRecipient = {
  claim_id: string;
  email: string | null;
  language: string | null;
  unsubscribe_token: string | null;
  items: SearchItem[] | null;
  searches: SearchInfo[] | null;
};

type SearchClaim = { queue?: Record<string, unknown> | null; recipients?: SearchRecipient[] | null };

type ModerationRecipient = Omit<ModerationClaim, "decision"> & {
  claim_id: string;
  email: string | null;
  language: string | null;
  decision: string;
};

type Counts = Record<string, number>;

export function log(kind: string, result: string, counts: Counts = {}): void {
  console.log(JSON.stringify({ fn: FN, kind, result, ...counts }));
}

type Step = { status: "ok" | "unauthorized" | "claim_failed"; counts: Counts };

/** Nur Zahlen aus den Abgleichszählern übernehmen (listings, searches, filters, matches, failed_searches, dropped). */
function queueCounts(queue: Record<string, unknown> | null | undefined): Counts {
  const counts: Counts = {};
  for (const [key, value] of Object.entries(queue ?? {})) {
    if (/^[a-z_]{1,32}$/.test(key) && typeof value === "number" && Number.isFinite(value)) counts[`queue_${key}`] = value;
  }
  return counts;
}

/** Senden je Empfänger, danach Release der Fehlschläge und Confirm der Erfolge (nur claim_ids). */
async function deliver<T extends { claim_id: string }>(
  deps: Deps & { mailer: Mailer; siteUrl: string },
  secret: string,
  kind: "search" | "moderation",
  recipients: T[],
  compose: (recipient: T) => Parameters<Mailer["send"]>[0] | null,
): Promise<Counts> {
  const delivered: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  for (const recipient of recipients) {
    let mail: Parameters<Mailer["send"]>[0] | null;
    try {
      mail = compose(recipient);
    } catch {
      // Ungültiger Token oder Header: als Fehlschlag freigeben, der nächste Claim stellt einen neuen Token aus.
      failed.push(recipient.claim_id);
      continue;
    }
    if (!mail) {
      skipped++;
      continue;
    }
    try {
      await deps.mailer.send(mail);
      delivered.push(recipient.claim_id);
    } catch {
      failed.push(recipient.claim_id);
    }
  }
  let bookkeepingErrors = 0;
  if (failed.length) {
    const { error } = await deps.rpc(`release_${kind}_notifications`, { p_secret: secret, p_claim_ids: failed });
    if (error) bookkeepingErrors++;
  }
  if (delivered.length) {
    const { error } = await deps.rpc(`confirm_${kind}_notifications`, { p_secret: secret, p_claim_ids: delivered });
    if (error) bookkeepingErrors++;
  }
  return { recipients: recipients.length, sent: delivered.length, failed: failed.length, skipped, bookkeepingErrors };
}

async function searchStep(deps: Deps & { mailer: Mailer; siteUrl: string }, secret: string): Promise<Step> {
  const { data, error } = await deps.rpc("claim_search_notifications", { p_secret: secret });
  if (error) {
    const status = error.code === "42501" ? "unauthorized" : "claim_failed";
    log("search", status);
    return { status, counts: {} };
  }
  const claim = (data ?? {}) as SearchClaim;
  const recipients = Array.isArray(claim.recipients) ? claim.recipients : [];
  const site = deps.siteUrl;
  const counts = await deliver(deps, secret, "search", recipients, (r) => {
    if (!r.email || !r.items?.length) return null;
    if (!validToken(r.unsubscribe_token)) throw new Error("token");
    const lang = language(r.language);
    const mail = composeSearchMail(lang, site, r.items, r.searches ?? [], r.unsubscribe_token);
    return { to: r.email, ...mail, headers: unsubscribeHeaders(site, r.unsubscribe_token) };
  });
  log("search", "done", { ...queueCounts(claim.queue), ...counts });
  return { status: "ok", counts };
}

async function moderationStep(deps: Deps & { mailer: Mailer; siteUrl: string }, secret: string): Promise<Step> {
  const { data, error } = await deps.rpc("claim_moderation_notifications", { p_secret: secret });
  if (error) {
    const status = error.code === "42501" ? "unauthorized" : "claim_failed";
    log("moderation", status);
    return { status, counts: {} };
  }
  const recipients = (Array.isArray(data) ? data : []) as ModerationRecipient[];
  const site = deps.siteUrl;
  const counts = await deliver(deps, secret, "moderation", recipients, (r) => {
    if (!r.email || !isDecision(r.decision)) return null;
    const lang = language(r.language);
    // Dienstmail (A8): kein List-Unsubscribe.
    return { to: r.email, ...composeModerationMail(lang, site, { ...r, decision: r.decision }) };
  });
  log("moderation", "done", counts);
  return { status: "ok", counts };
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  const secret = request.headers.get("x-search-notify-secret") ?? "";
  const { mailer, siteUrl } = deps;
  if (!mailer) {
    log("all", "no_mailer");
    return Response.json({ error: "no_mailer" }, { status: 503 });
  }
  if (!siteUrl) {
    log("all", "invalid_site_url");
    return Response.json({ error: "invalid_site_url" }, { status: 503 });
  }
  const ready = { ...deps, mailer, siteUrl };
  const search = await searchStep(ready, secret);
  if (search.status === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
  // Getrennter Schritt (H8): ein Fehler im Suchauftrags-Claim hält die Moderations-Mails nicht auf.
  const moderation = await moderationStep(ready, secret);
  if (moderation.status === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
  const failedClaim = search.status === "claim_failed" || moderation.status === "claim_failed";
  const summary = (step: Step) => ({ recipients: step.counts.recipients ?? 0, sent: step.counts.sent ?? 0, failed: step.counts.failed ?? 0 });
  return Response.json(
    { ...(failedClaim ? { error: "claim_failed" } : {}), search: summary(search), moderation: summary(moderation) },
    { status: failedClaim ? 500 : 200 },
  );
}
