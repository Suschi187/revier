import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { TILE_NAME_RE, tilesDir } from "@/lib/map/tiles";
import { parseRange } from "@/lib/map/range";

// Kartendatei mit Range-Requests (ADR 016, Review A1). Nur in der Entwicklung bzw. mit MAP_TILES_DIR aktiv; in Prod
// liefert der Objektspeicher bzw. das CDN /tiles/ vor Next aus. Keine Zugriffsprotokolle mit Range-Headern: Die
// Bereiche verraten die betrachtete Kachel.

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function serve(request: Request, name: string, withBody: boolean): Response {
  const dir = tilesDir();
  if (!dir || !TILE_NAME_RE.test(name)) return notFound();
  const file = path.resolve(dir, name);
  if (path.dirname(file) !== dir) return notFound();
  let size: number;
  let mtime: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return notFound();
    size = stat.size;
    mtime = stat.mtimeMs;
  } catch {
    return notFound();
  }
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
    ETag: `"${size.toString(16)}-${Math.trunc(mtime).toString(16)}"`,
    // Versionierter Dateiname (Build-Datum): unveränderlich.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const [start, end, status] = range.kind === "partial" ? [range.start, range.end, 206] : [0, size - 1, 200];
  const body = withBody ? (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream) : null;
  return new Response(body, {
    status,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

export async function GET(request: Request, ctx: RouteContext<"/tiles/[name]">): Promise<Response> {
  return serve(request, (await ctx.params).name, true);
}

export async function HEAD(request: Request, ctx: RouteContext<"/tiles/[name]">): Promise<Response> {
  return serve(request, (await ctx.params).name, false);
}
