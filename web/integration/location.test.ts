import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { anonClient, rest, serviceClient, userClient } from "./helpers";

// Standortverfremdung v2 über die echte API (ADR 006, Plan M3 4.3 „Integration“, QA M3 Zwischenstand).
// Prüft Ring, Stabilität, Rundweg gelesener Werte, kein Orakel über fremde Anzeigen, Admin/Server,
// Fehlermeldungen ohne Koordinaten.

const f = fixture();

type Point = { lon: number; lat: number };

/** Liest einen Punkt aus der Antwort von PostgREST (EWKB als Hex oder GeoJSON). */
function parsePoint(value: unknown): Point {
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "hex");
    const little = bytes[0] === 1;
    const type = little ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
    const offset = type & 0x20000000 ? 9 : 5;
    const read = (o: number) => (little ? bytes.readDoubleLE(o) : bytes.readDoubleBE(o));
    return { lon: read(offset), lat: read(offset + 8) };
  }
  const geo = value as { coordinates: [number, number] };
  return { lon: geo.coordinates[0], lat: geo.coordinates[1] };
}

function distanceM(a: Point, b: Point): number {
  const r = 6_371_008;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const ewkt = (p: Point) => `SRID=4326;POINT(${p.lon} ${p.lat})`;

describe.skipIf(!f)("Standort: Verfremdung über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;
  const created: string[] = [];
  // Punkte bei Dresden im Kreis Sächsische Schweiz-Osterzgebirge (DE-14628, 1654 km²): Dresden selbst liegt unter
  // 400 km² und erlaubt keinen Punkt (ADR 016). Nah genug am Centroid für die Plausibilität (80 km).
  const p1: Point = { lon: 13.7012, lat: 51.0313 };
  const p2: Point = { lon: 13.7451, lat: 51.0572 };
  let district = "";
  let otherDistrict = "";

  beforeAll(async () => {
    const regions = await anonClient(fx).from("regions").select("id, code").in("code", ["DE-14628", "DE-14627"]);
    district = regions.data?.find((r) => r.code === "DE-14628")?.id ?? "";
    otherDistrict = regions.data?.find((r) => r.code === "DE-14627")?.id ?? "";
  });

  afterAll(async () => {
    if (created.length) await serviceClient(fx).from("listings").delete().in("id", created);
  });

  async function insert(user: typeof a, point: Point | null, title: string) {
    const res = await userClient(fx, user)
      .from("listings")
      .insert({ kind: "lease", direction: "offer", title, content_language: "de", region_id: district, display_location: point ? ewkt(point) : null })
      .select("id, display_location")
      .single<{ id: string; display_location: unknown }>();
    expect(res.error).toBeNull();
    created.push(res.data!.id);
    return res.data!;
  }

  async function read(id: string): Promise<unknown> {
    const { data } = await serviceClient(fx).from("listings").select("display_location").eq("id", id).single<{ display_location: unknown }>();
    return data!.display_location;
  }

  let l1 = "";
  let first: unknown = null;

  it("Insert mit Punkt: Ausgabe liegt 2,28–5,72 km vom Eingabepunkt", async () => {
    const row = await insert(a, p1, "QA Standort 1");
    l1 = row.id;
    first = row.display_location;
    const d = distanceM(parsePoint(first), p1);
    expect(d).toBeGreaterThan(2280);
    expect(d).toBeLessThan(5720);
  });

  it("PATCH mit demselben Punkt, Titeländerung und Rundweg des gelesenen Werts ändern den Punkt nicht", async () => {
    const client = userClient(fx, a);
    expect((await client.from("listings").update({ display_location: ewkt(p1) }).eq("id", l1)).error).toBeNull();
    expect(await read(l1)).toEqual(first);
    expect((await client.from("listings").update({ title: "QA Standort 1b" }).eq("id", l1)).error).toBeNull();
    expect(await read(l1)).toEqual(first);
    expect((await client.from("listings").update({ display_location: first }).eq("id", l1)).error).toBeNull();
    expect(await read(l1)).toEqual(first);
  });

  it("Zweite Anzeige desselben Besitzers: Abstand der Ausgaben = Abstand der Zellen (konstanter Versatz)", async () => {
    const row = await insert(a, p2, "QA Standort 2");
    const dIn = distanceM(p1, p2);
    const dOut = distanceM(parsePoint(first), parsePoint(row.display_location));
    expect(Math.abs(dOut - dIn)).toBeLessThan(1415); // höchstens eine Zellendiagonale
  });

  it("Anderer Besitzer am selben Punkt bekommt einen anderen Punkt (kein Orakel)", async () => {
    const row = await insert(b, p1, "QA Standort fremd");
    expect(row.display_location).not.toEqual(first);
    expect(distanceM(parsePoint(row.display_location), p1)).toBeGreaterThan(2280);
  });

  it("C setzt keinen Punkt an der Anzeige von A; Antwort wie bei einer unbekannten id", async () => {
    const own = await rest(fx, `listings?id=eq.${l1}`, { token: c.token, method: "PATCH", body: { display_location: ewkt(p2) }, headers: { Prefer: "return=representation" } });
    const unknown = await rest(fx, `listings?id=eq.00000000-0000-4000-8000-000000000000`, { token: c.token, method: "PATCH", body: { display_location: ewkt(p2) }, headers: { Prefer: "return=representation" } });
    expect(own.status).toBe(unknown.status);
    expect(await own.text()).toBe(await unknown.text());
    expect(await read(l1)).toEqual(first);
  });

  it("Server (service_role) setzt keinen Punkt, darf ihn aber entfernen", async () => {
    const admin = serviceClient(fx);
    const set = await admin.from("listings").update({ display_location: ewkt(p2) }).eq("id", created[1]);
    expect(set.error?.code).toBe("42501");
    const cleared = await admin.from("listings").update({ display_location: null }).eq("id", created[1]);
    expect(cleared.error).toBeNull();
  });

  it("Unplausibler Punkt → 23514, Meldung ohne Koordinaten; andere Geometrien werden abgelehnt", async () => {
    const far = await userClient(fx, a)
      .from("listings")
      .insert({ kind: "lease", direction: "offer", title: "QA weit weg", content_language: "de", region_id: district, display_location: "SRID=4326;POINT(11.123456 48.654321)" })
      .select("id");
    expect(far.error?.code).toBe("23514");
    const text = JSON.stringify(far.error);
    expect(text).not.toMatch(/11\.12|48\.65|POINT/);

    const line = await userClient(fx, a)
      .from("listings")
      .insert({ kind: "lease", direction: "offer", title: "QA Linie", content_language: "de", region_id: district, display_location: "SRID=4326;LINESTRING(13.70 51.03, 13.71 51.04)" })
      .select("id");
    expect(line.error).not.toBeNull();
    expect(JSON.stringify(line.error)).not.toMatch(/13\.70|51\.03/);
  });

  it("Kreiswechsel mit zurückgeschicktem gelesenem Punkt entfernt den Punkt (keine zweite Stichprobe)", async () => {
    const row = await insert(a, p1, "QA Kreiswechsel");
    const res = await userClient(fx, a).from("listings").update({ region_id: otherDistrict, display_location: row.display_location }).eq("id", row.id);
    expect(res.error).toBeNull();
    expect(await read(row.id)).toBeNull();
  });

  it("Kreis unter 400 km² (Dresden): kein Punkt, Feldcode ohne Koordinaten (ADR 016)", async () => {
    const res = await userClient(fx, a)
      .from("listings")
      .insert({ kind: "lease", direction: "offer", title: "QA kleiner Kreis", content_language: "de", region_id: fx.ids.district, display_location: ewkt(p1) })
      .select("id");
    expect(res.error?.code).toBe("23514");
    expect(res.error?.hint).toBe('{"fields":["place.point.small_district"]}');
    expect(JSON.stringify(res.error)).not.toMatch(/13\.70|51\.03/);
  });

  it("Ableitung und Secret sind über die API nicht erreichbar", async () => {
    expect((await rest(fx, "rpc/listings_blur_location", { token: a.token, method: "POST", body: {} })).status).toBe(404);
    expect((await rest(fx, "decrypted_secrets", { token: a.token, headers: { "Accept-Profile": "vault" } })).status).toBe(406);
    expect((await rest(fx, "app_settings", { token: a.token, headers: { "Accept-Profile": "private" } })).status).toBe(406);
  });
});
