#!/usr/bin/env bash
# Überträgt die Cloud-Konfiguration einer Umgebung (docs/CLOUD-SETUP.md 1.5). Aufruf: config.sh <stage|prod> <diff|push>
# Baut einen temporären Arbeitsordner aus supabase/cloud/<umgebung>.toml und einer Kopie von supabase/templates,
# weil `supabase config push` Vorlagen nur innerhalb des Arbeitsordners annimmt.
set -euo pipefail
env=${1:?stage oder prod}
action=${2:?diff oder push}
root=$(cd "$(dirname "$0")/../.." && pwd)
config="$root/supabase/cloud/$env.toml"
[ -f "$config" ] || { echo "Keine Konfiguration: $config" >&2; exit 1; }
ref=$(sed -n 's/^project_id = "\([a-z]*\)"$/\1/p' "$config")
[ -n "$ref" ] || { echo "project_id fehlt in $config" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/supabase"
cp "$config" "$work/supabase/config.toml"
cp -R "$root/supabase/templates" "$work/supabase/templates"

case "$action" in
  diff) supabase config diff --workdir "$work" --remote="$ref" ;;
  push) supabase config push --workdir "$work" --remote="$ref" --yes ;;
  *) echo "Aktion: diff oder push" >&2; exit 1 ;;
esac
