#!/usr/bin/env bash
# Verschlüsselte Datenbanksicherung (M10, docs/CLOUD-SETUP.md 4.5). Aufruf: backup.sh <zielordner>
# Umgebung:
#   BACKUP_DB_URL         Session-Pooler-URL (IPv4, Port 5432, Nutzer postgres.<ref>) mit Passwort; GitHub-Secret
#   BACKUP_AGE_RECIPIENT  öffentlicher age-Schlüssel (age1…); der private Schlüssel liegt nur beim Inhaber
#   AGE                   optional anderes age-Programm (lokale Tests)
# Drei Dumps wie von Supabase empfohlen (Rollen, Schema, Daten), als tar.gz gepackt und nur verschlüsselt
# geschrieben; der Klartext liegt nur im temporären Ordner und wird am Ende gelöscht. Fotos in Storage sind nicht
# enthalten.
set -euo pipefail

out=${1:?Zielordner fehlt}
: "${BACKUP_DB_URL:?BACKUP_DB_URL fehlt}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT fehlt}"
case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT ist kein age-Schlüssel" >&2; exit 1 ;; esac
age=${AGE:-age}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

supabase db dump --remote="$BACKUP_DB_URL" --role-only -f "$work/roles.sql"
supabase db dump --remote="$BACKUP_DB_URL" -f "$work/schema.sql"
supabase db dump --remote="$BACKUP_DB_URL" --data-only --use-copy -f "$work/data.sql"

stamp=$(date -u +%Y%m%dT%H%MZ)
mkdir -p "$out"
tar -C "$work" -czf - roles.sql schema.sql data.sql | $age -r "$BACKUP_AGE_RECIPIENT" -o "$out/huntery-db-$stamp.tar.gz.age"
echo "Sicherung: huntery-db-$stamp.tar.gz.age ($(wc -c < "$out/huntery-db-$stamp.tar.gz.age") Bytes)"
