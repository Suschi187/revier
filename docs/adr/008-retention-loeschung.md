# ADR 008: Retention und Löschung

Status: angenommen (M1, technischer Default). **Keine Rechtsberatung, anwaltliche Prüfung offen (SPEC 7.2/7.3).**

## Kontext
DSGVO (Datensparsamkeit, Recht auf Löschung), App-Store-Pflicht zur Account-Löschung und DSA-Pflichten für die Moderation müssen zusammenpassen.

## Entscheidung
- Fristen stehen in `private.app_settings` und sind konfigurierbar. Die Startwerte sind Platzhalter:
  - `verification_document_days` = 30: Dokument nach der Entscheidung löschen
  - `account_deletion_grace_days` = 0: Frist zwischen Löschantrag und harter Löschung
  - `audit_log_months` = 24
  - `handled_reports_months` = 12
- Verifizierung: Nach der Frist wird nur die Datei gelöscht (`document_path` wird NULL, `document_deleted_at` wird gesetzt). Die Zeile bleibt bis zur Account-Löschung.
- Account-Löschung:
  - Der Löschantrag setzt `profiles.deleted_at`. Das Profil verschwindet sofort aus der öffentlichen Sicht.
  - Danach folgt die harte Löschung über `auth.admin.deleteUser`, und `on delete cascade` räumt die Daten ab.
  - Dateien in Storage löscht der Lösch-Job über die Storage-API.
- Audit- und Moderationsdaten bleiben pseudonymisiert: `audit_log.actor_id` und `reports.reporter_id`/`handled_by` werden NULL. Meldeziele werden ohne FK gespeichert (`target_type`, `target_id`).
- Die Jobs (pg_cron, Edge Function für Storage) folgen in M9. M1 legt nur Schema, Spalten und Einstellungen an.

## Löschregeln je Fremdschlüssel

| Fremdschlüssel | on delete |
|---|---|
| `profiles.user_id → auth.users` | cascade |
| `private.user_roles.user_id → auth.users` | cascade |
| `listings.owner_id → profiles` | cascade |
| `listings.region_id → regions` | restrict |
| `regions.parent_id → regions` | restrict |
| `listing_photos.listing_id`, `listing_species.listing_id` → listings | cascade |
| `listing_species.species_code → game_species` | restrict |
| `private.listing_location_offsets.listing_id → listings` | cascade |
| `favorites.user_id → profiles`, `favorites.listing_id → listings` | cascade |
| `saved_searches.user_id → profiles` | cascade |
| `conversations.listing_id → listings` | set null (Chats bleiben als Beweis, Entscheidung Review M1) |
| `conversations.owner_id`/`interested_id → profiles` | cascade |
| `messages.conversation_id → conversations` | cascade |
| `messages.sender_id → profiles` | cascade |
| `blocks.blocker_id`/`blocked_id → profiles` | cascade |
| `reports.reporter_id`, `reports.handled_by → profiles` | set null |
| `verifications.user_id → profiles` | cascade |
| `verifications.reviewed_by → profiles` | set null |
| `reviews.*_id` → conversations/profiles | cascade |
| `devices.user_id → profiles` | cascade |
| `audit_log.actor_id → profiles` | set null |

Löscht ein Besitzer nur eine Anzeige, bleiben die Chats für beide Seiten erhalten, angezeigt als „Anzeige gelöscht“. Gesperrte Nutzer können keine Anzeigen löschen, und Admins entfernen Anzeigen über den Status `removed` (auditiert) statt per DELETE.

Bekannte Folge: Bei einer Account-Löschung verschwinden auch die Chats beim Gegenüber. Ob sie dort bleiben müssen oder dürfen, ist rechtlich zu prüfen.

## Rechtlich zu prüfen
Speicherdauer der Jagdscheine, DSA Art. 16/17/20 (Begründungen, Beschwerdefrist von mindestens 6 Monaten), Beweissicherung bei Betrug, Nachrichten nach einer Löschung, Aufbewahrungspflichten (im MVP ohne Zahlungen voraussichtlich keine).
