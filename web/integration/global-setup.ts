import type { TestProject } from "vitest/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReachable, readLocalSupabase } from "./env";
import { acceptLegal, createSignedInUser, deleteUsers, jpeg, serviceClient, type Conn } from "./helpers";
import type { Fixture } from "./types";

// Baut einmal je Lauf drei Nutzer und deren Daten auf (wenige verifyOtp-Aufrufe wegen des
// Rate-Limits token_verifications) und löscht alles am Ende wieder:
// - A: Entwurf mit Foto, Jagdschein im privaten Bucket mit Verifizierungsantrag
// - B: freigegebene Anzeige mit Foto
// - A schreibt B zur Anzeige von B; C ist unbeteiligt.

function must<T>(result: { data: T | null; error: unknown }, step: string): T {
  if (result.error || result.data === null) {
    throw new Error(`Setup ${step}: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

export default async function setup(project: TestProject) {
  const local = readLocalSupabase();
  const required = process.env.CI === "true" || process.env.INTEGRATION_REQUIRED === "1";
  if (!local || !(await isReachable(local.url))) {
    if (required) throw new Error("Lokale Supabase nicht erreichbar (supabase start im Repo-Root).");
    console.warn("[integration] Lokale Supabase nicht erreichbar, API-Tests werden übersprungen.");
    project.provide("supabaseFixture", null);
    return;
  }

  const conn: Conn = local;
  const admin = serviceClient(conn);
  const createdIds: string[] = [];
  const uploaded: { bucket: string; path: string }[] = [];

  try {
    const [a, b, c] = await Promise.all([
      createSignedInUser(conn, "a"),
      createSignedInUser(conn, "b"),
      createSignedInUser(conn, "c"),
    ]);
    createdIds.push(a.id, b.id, c.id);

    // Alle drei stimmen den aktuellen Rechtstexten zu (Legal-Gate beim Inserieren, ab M3 Commit 6).
    await Promise.all([a, b, c].map((user) => acceptLegal(user.client)));

    const district = must(
      await admin.from("regions").select("id").eq("code", "DE-14612").single<{ id: string }>(),
      "Region",
    ).id;

    // A: Entwurf mit registriertem und hochgeladenem Foto
    const draftA = must(
      await a.client
        .from("listings")
        .insert({ kind: "helper", direction: "wanted", title: "Entwurf A geheim", content_language: "de", region_id: district })
        .select("id")
        .single<{ id: string }>(),
      "Entwurf A",
    ).id;
    // Fotos wie ADR 011: Zeile anlegen (Pfade setzt der Server), Verarbeitung simuliert der Service-Key.
    const draftPhotoA = await processedPhoto(a.client, draftA, jpeg(1));

    // A: Jagdschein und Verifizierungsantrag
    const docA = `${a.id}/jagdschein.jpg`;
    must(await a.client.storage.from("verification-docs").upload(docA, jpeg(2), { contentType: "image/jpeg" }), "Jagdschein A");
    uploaded.push({ bucket: "verification-docs", path: docA });
    const verificationA = must(
      await a.client.from("verifications").insert({ document_path: docA, document_type: "jagdschein" }).select("id").single<{ id: string }>(),
      "Verifizierung A",
    ).id;

    // B: Anzeige mit Foto, eingereicht und vom Server freigegeben
    const activeB = must(
      await b.client
        .from("listings")
        .insert({
          kind: "permit", direction: "offer", title: "Begehungsschein B", content_language: "de", region_id: district,
          description: "Begehungsschein im Revier bei Dresden, Rehwild und Schwarzwild.",
          attributes: { permit_scope: "selbststaendig", paid: true },
        })
        .select("id")
        .single<{ id: string }>(),
      "Anzeige B",
    ).id;
    // Pflichtangaben für das Absenden (Plan M3 6): Wildart und Ort mit PLZ des Kreises.
    must(await b.client.from("listing_species").insert({ listing_id: activeB, species_code: "roe_deer" }).select(), "Wildart B");
    must(
      await b.client.rpc("set_listing_location", { p_listing_id: activeB, p_region_id: district, p_postal_code: "01067", p_place_name: "Dresden" })
        .then((r) => ({ ...r, data: r.error ? null : true })),
      "Ort B",
    );
    const activePhotoB = await processedPhoto(b.client, activeB, jpeg(3));
    must(await b.client.from("listings").update({ status: "pending_review" }).eq("id", activeB).select(), "Anzeige B einreichen");
    must(
      await admin
        .from("listings")
        .update({ status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() })
        .eq("id", activeB)
        .select(),
      "Anzeige B freigeben",
    );

    // A schreibt B
    const conversation = must(
      await a.client.from("conversations").insert({ listing_id: activeB }).select("id").single<{ id: string }>(),
      "Unterhaltung",
    ).id;
    const message = must(
      await a.client.from("messages").insert({ conversation_id: conversation, body: "Geheime Nachricht von A" }).select("id").single<{ id: string }>(),
      "Nachricht",
    ).id;

    const strip = ({ id, email, token }: { id: string; email: string; token: string }) => ({ id, email, token });
    const fixture: Fixture = {
      ...conn,
      users: { a: strip(a), b: strip(b), c: strip(c) },
      ids: { district, draftA, activeB, conversation, message, verificationA },
      paths: { docA, draftPhotoA, activePhotoB },
    };
    project.provide("supabaseFixture", fixture);
  } catch (error) {
    // Vitest kann Fehler aus dem globalen Setup nicht immer ausgeben (Stacktrace-Mapping); Text sichern.
    console.error(`[integration] ${error instanceof Error ? error.message : String(error)}`);
    await cleanup();
    throw error;
  }

  async function processedPhoto(client: SupabaseClient, listingId: string, bytes: Blob): Promise<string> {
    const row = must(
      await client.from("listing_photos").insert({ listing_id: listingId, sort_order: 0 }).select("id, storage_path").single<{ id: string; storage_path: string }>(),
      "Foto registrieren",
    );
    must(await admin.storage.from("listing-photos").upload(row.storage_path, bytes, { contentType: "image/jpeg" }), "Foto ablegen (Server)");
    uploaded.push({ bucket: "listing-photos", path: row.storage_path });
    must(await admin.from("listing_photos").update({ processed_at: new Date().toISOString(), width: 1, height: 1 }).eq("id", row.id).select(), "Foto verarbeitet");
    return row.storage_path;
  }

  async function cleanup() {
    // Dateien zuerst (storage.objects hängt nicht per FK an den Nutzern), dann Konten (cascade).
    for (const bucket of ["listing-photos", "listing-uploads", "verification-docs"]) {
      const paths = uploaded.filter((u) => u.bucket === bucket).map((u) => u.path);
      for (const id of createdIds) {
        const { data } = await admin.storage.from(bucket).list(id, { limit: 1000 });
        for (const entry of data ?? []) {
          if (entry.id) paths.push(`${id}/${entry.name}`);
          else {
            const { data: nested } = await admin.storage.from(bucket).list(`${id}/${entry.name}`, { limit: 1000 });
            for (const file of nested ?? []) paths.push(`${id}/${entry.name}/${file.name}`);
          }
        }
      }
      if (paths.length > 0) await admin.storage.from(bucket).remove([...new Set(paths)]);
    }
    await deleteUsers(conn, createdIds);
  }

  return cleanup;
}
