// Eigene Illustrationen der Marke (docs/DESIGN.md 11): Silhouetten im Morgenlicht, nur Markenfarben.
// Erzeugt public/static/brand/*.v1.svg und das Vorschaubild og-default.v1.png (sharp kommt mit Next).
// Aufruf: node scripts/illustrations.mjs  — Ergebnis ist deterministisch (fester Zufallsstartwert).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "static", "brand");
const VERSION = "v1";

const C = {
  forest: "#202B23",
  night: "#18211B",
  deep: "#141B16",
  pine: "#2B3A30",
  moss: "#35473A",
  hover: "#415747",
  olive: "#4A5A44",
  sage: "#6F7D66",
  haze: "#A3AB95",
  mist: "#C9C8B8",
  sand: "#E8E3D8",
  offwhite: "#F7F5EF",
  brand: "#FF914D",
  brandLight: "#FFA66E",
};

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/** Fichte als gezackte Silhouette, Fuß bei (x, base). */
function fir(x, base, h, fill) {
  const w = h * 0.42;
  const p = [
    [0, -h], [0.22, -0.72], [0.12, -0.72], [0.36, -0.44], [0.2, -0.44], [0.5, -0.08],
    [0.06, -0.08], [0.06, 0], [-0.06, 0], [-0.06, -0.08], [-0.5, -0.08], [-0.2, -0.44],
    [-0.36, -0.44], [-0.12, -0.72], [-0.22, -0.72],
  ];
  const pts = p.map(([dx, dy], i) => (i === 0 ? `${r1(x)},${r1(base + dy)}` : `${r1(x + dx * w)},${r1(base + dy * h)}`));
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

/** Waldkante aus Fichten; `gaps` sind ausgesparte x-Bereiche (Sonne, Hochsitz). */
function treeline({ x0, x1, base, minH, maxH, fill, seed, gaps = [], step = [14, 26] }) {
  const rand = rng(seed);
  const out = [];
  for (let x = x0; x < x1; x += step[0] + rand() * (step[1] - step[0])) {
    const h = minH + rand() * (maxH - minH);
    if (gaps.some(([a, b]) => x > a && x < b)) continue;
    out.push(fir(x, base + rand() * 6, h, fill));
  }
  return out.join("");
}

/** Büchse mit Zielfernrohr, waagerecht, Kolben bei (0,0), Lauf nach rechts (Einheiten bei Personengröße 100). */
function rifle(fill) {
  return `<path d="M0 0 L13 -2.5 L21 -1.5 L25 -3.2 L31 -3.2 L31 0.8 L19 2.6 L3 5.5 Z" fill="${fill}"/>`
    + `<rect x="31" y="-3" width="40" height="2" fill="${fill}"/>`
    + `<rect x="25" y="-7.6" width="20" height="3" rx="1.2" fill="${fill}"/>`
    + `<rect x="24" y="-8.6" width="4" height="5" rx="1" fill="${fill}"/><rect x="42" y="-8.2" width="4" height="4.4" rx="1" fill="${fill}"/>`;
}

/**
 * Jäger von hinten bzw. seitlich gehend, Füße bei (x, base), Höhe 100·s.
 * vest: Signalweste in Orange (Gesellschaftsjagd); gun: Büchse geschultert; band: oranges Hutband.
 */
function hunter(x, base, s, { fill = C.deep, vest = false, gun = true, band = true, flip = false, cap = false, stride = 1 } = {}) {
  const body = vest ? C.brand : fill;
  const legs = `<path d="M-8 -47 L-1 -47 L${-4 - 4 * stride} -2 L${-6 - 4 * stride} 0 L${-12 - 4 * stride} 0 L${-11 - 4 * stride} -3 Z" fill="${fill}"/>`
    + `<path d="M1 -47 L8 -47 L${8 + 4 * stride} -3 L${13 + 4 * stride} -1 L${13 + 4 * stride} 0 L${4 + 4 * stride} 0 Z" fill="${fill}"/>`;
  const torso = `<path d="M-10 -80 Q0 -84 10 -80 L12 -44 L-12 -44 Z" fill="${body}"/>`
    + (vest ? `<rect x="-12" y="-58" width="24" height="3" fill="${C.sand}" opacity=".85"/>` : "")
    + `<path d="M10 -78 L15 -56 L13 -46 L10 -47 L11 -56 L8 -70 Z" fill="${fill}"/>`
    + `<path d="M-10 -78 L-15 -56 L-13 -46 L-10 -47 L-11 -56 L-8 -70 Z" fill="${fill}"/>`;
  const head = `<rect x="-3" y="-84" width="6" height="5" fill="${fill}"/><circle cx="0" cy="-88" r="6.5" fill="${fill}"/>`;
  const hat = cap
    ? `<path d="M-7 -91 Q0 -101 7 -91 Z" fill="${C.brand}"/><path d="M5 -92 L12 -91 L5 -90 Z" fill="${C.brand}"/>`
    : `<ellipse cx="0" cy="-92.5" rx="11" ry="2.4" fill="${fill}"/><path d="M-6 -93 Q-6 -102 0 -102 Q6 -102 6 -93 Z" fill="${fill}"/>`
      + (band ? `<rect x="-6" y="-95.6" width="12" height="2.6" fill="${C.brand}"/>` : "");
  // Geschultert: Kolben neben der Hüfte, Lauf an der Schulter vorbei nach oben, Zielfernrohr außen (von hinten gesehen).
  const gunPart = gun ? `<g transform="translate(18 -34) rotate(-82) scale(1.05 -1.05)">${rifle(fill)}</g><path d="M16 -40 L14 -80" stroke="${fill}" stroke-width="1.4"/>` : "";
  return `<g transform="translate(${r1(x)} ${r1(base)}) scale(${flip ? -s : s} ${s})">${gunPart}${legs}${torso}${head}${hat}</g>`;
}

/** Vorstehhund seitlich, Pfoten bei (x, base), Blick nach rechts. */
function dog(x, base, s, { fill = C.deep, collar = true, sit = false, flip = false } = {}) {
  const shape = sit
    ? `<path d="M-10 0 L-12 -10 Q-12 -20 -4 -26 L4 -30 L6 -38 L13 -40 L20 -37 L20 -34 L13 -33 L10 -24 L8 -14 L9 0 L5 0 L4 -10 L-2 -6 L-2 0 Z" fill="${fill}"/>`
      + `<path d="M-11 -4 Q-20 -2 -22 -8" stroke="${fill}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + `<path d="M8 -38 L6 -30 L10 -32 Z" fill="${fill}"/>`
      + (collar ? `<path d="M5 -31 L11 -32 L11 -30 L5 -29 Z" fill="${C.brand}"/>` : "")
    : `<path d="M-17 -17 Q-18 -26 -8 -26 L9 -26 L14 -34 L22 -34 L27 -30 L27 -28 L20 -27 L17 -20 L15 -14 L15 0 L12 0 L11 -13 L-9 -13 L-11 0 L-14 0 L-15 -13 Z" fill="${fill}"/>`
      + `<path d="M-16 -22 Q-24 -26 -28 -34" stroke="${fill}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + `<path d="M-6 -14 L-5 0 L-8 0 Z M6 -14 L8 0 L5 0 Z" fill="${fill}"/>`
      + `<path d="M16 -33 L14 -25 L18 -27 Z" fill="${fill}"/>`
      + (collar ? `<path d="M12 -30 L17 -31 L16 -28 L11 -27 Z" fill="${C.brand}"/>` : "");
  return `<g transform="translate(${r1(x)} ${r1(base)}) scale(${flip ? -s : s} ${s})">${shape}</g>`;
}

/** Rothirsch mit Trophäengeweih (Zwölfender), Hufe bei (x, base), Blick nach rechts. */
function stag(x, base, s, { fill = C.deep, flip = false } = {}) {
  const body = `<path d="M-30 -38 Q-34 -54 -18 -55 L12 -56 Q20 -58 22 -64 L28 -80 L34 -80 L46 -72 L47 -68 L36 -67 L32 -58 L28 -44 L26 -34 L24 -28 L22 0 L18 0 L18 -28 L4 -30 L-12 -30 L-16 -28 L-18 0 L-22 0 L-24 -28 Q-30 -30 -30 -38 Z" fill="${fill}"/>`
    + `<path d="M-14 -30 L-10 0 L-13 0 L-17 -28 Z M14 -30 L12 0 L9 0 L10 -30 Z" fill="${fill}"/>`
    + `<path d="M28 -79 L26 -86 L31 -81 Z" fill="${fill}"/>`;
  // Zwei Stangen als Lyra: hintere nach hinten, vordere nach vorn ausladend, je drei Sprossen und eine Krone.
  const antlers = `<g stroke="${fill}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M29 -82 C 22 -98, 12 -112, 6 -130"/><path d="M26 -90 L35 -97"/><path d="M19 -102 L28 -110"/><path d="M12 -116 L19 -126"/>`
    + `<path d="M6 -130 L0 -142"/><path d="M6 -130 L10 -144"/><path d="M7 -128 L-3 -133"/>`
    + `<path d="M32 -82 C 40 -98, 46 -112, 42 -132"/><path d="M36 -90 L47 -92"/><path d="M41 -102 L52 -106"/><path d="M45 -116 L54 -122"/>`
    + `<path d="M42 -132 L37 -144"/><path d="M42 -132 L46 -145"/><path d="M43 -128 L51 -138"/></g>`;
  return `<g transform="translate(${r1(x)} ${r1(base)}) scale(${flip ? -s : s} ${s})">${antlers}${body}</g>`;
}

/** Ansitzleiter mit Kanzel, Füße bei (x, base), Höhe etwa 150·s. */
function highSeat(x, base, s, { fill = C.deep, open = false } = {}) {
  const legs = `<path d="M-22 0 L-15 -100 M22 0 L15 -100" stroke="${fill}" stroke-width="4"/>`
    + `<path d="M-20 -30 L20 -30 M-17 -66 L17 -66 M-20 -30 L17 -66 M20 -30 L-17 -66" stroke="${fill}" stroke-width="2.2"/>`
    + `<path d="M-8 0 L-4 -100 M8 0 L4 -100 M-7 -20 L7 -20 M-6 -40 L6 -40 M-5 -60 L5 -60 M-4 -80 L4 -80" stroke="${fill}" stroke-width="2"/>`;
  const cabin = open
    ? `<path d="M-24 -100 L24 -100 L24 -128 M-24 -100 L-24 -128 M-24 -116 L24 -116" stroke="${fill}" stroke-width="3.2" fill="none"/>`
      + `<path d="M-28 -128 L0 -146 L14 -137" stroke="${fill}" stroke-width="3" fill="none"/>`
    : `<rect x="-24" y="-132" width="48" height="32" fill="${fill}"/><path d="M-30 -130 L0 -150 L30 -130 Z" fill="${fill}"/>`
      + `<rect x="-16" y="-126" width="32" height="9" fill="${C.brand}" opacity=".9"/>`;
  return `<g transform="translate(${r1(x)} ${r1(base)}) scale(${s})">${legs}${cabin}</g>`;
}

/** Höhenlinien wie im Banner (Markenmuster). */
function contours(cx, cy, scale, stroke, opacity) {
  const rings = [0, 1, 2, 3, 4].map((i) => {
    const rx = 60 + i * 46;
    const ry = 26 + i * 22;
    return `<path d="M${cx - rx} ${cy} C ${cx - rx} ${cy - ry * 1.2}, ${cx + rx * 0.7} ${cy - ry * 1.4}, ${cx + rx} ${cy - ry * 0.2} S ${cx + rx * 0.2} ${cy + ry * 1.1}, ${cx - rx} ${cy} Z"/>`;
  });
  return `<g fill="none" stroke="${stroke}" stroke-width="${1.4 / scale}" opacity="${opacity}" transform="scale(${scale})">${rings.join("")}</g>`;
}

function grass(x0, x1, base, fill, seed, height = 10) {
  const rand = rng(seed);
  let d = "";
  for (let x = x0; x < x1; x += 6 + rand() * 18) {
    const h = height * (0.5 + rand());
    d += `M${r1(x)} ${base} L${r1(x + 1.5 + rand() * 2)} ${r1(base - h)} L${r1(x + 3)} ${base} Z `;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

function svg(w, h, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${defs}</defs>${body}</svg>\n`;
}

const darkSky = (id, sunX, sunY) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.night}"/><stop offset=".62" stop-color="${C.moss}"/><stop offset="1" stop-color="${C.sage}"/></linearGradient>`
  + `<radialGradient id="${id}-glow" cx="${sunX}" cy="${sunY}" r="380" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.brand}" stop-opacity=".75"/><stop offset=".35" stop-color="${C.brand}" stop-opacity=".25"/><stop offset="1" stop-color="${C.brand}" stop-opacity="0"/></radialGradient>`;

const lightSky = (id, sunX, sunY) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.offwhite}"/><stop offset="1" stop-color="${C.sand}"/></linearGradient>`
  + `<radialGradient id="${id}-glow" cx="${sunX}" cy="${sunY}" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.brandLight}" stop-opacity=".55"/><stop offset="1" stop-color="${C.brandLight}" stop-opacity="0"/></radialGradient>`;

/** Startseiten-Banner 8 : 3; links ruhig für Text (dort liegt zusätzlich eine waldgrüne Abdunklung). */
function hero() {
  const W = 1200;
  const H = 450;
  const sun = [905, 300];
  return svg(W, H, darkSky("s", ...sun),
    `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
    + contours(780, 140, 1, C.sand, 0.1)
    + `<circle cx="${sun[0]}" cy="${sun[1]}" r="46" fill="${C.brand}"/>`
    + `<path d="M0 318 C 220 292, 420 276, 620 296 S 980 262, 1200 284 L1200 450 L0 450 Z" fill="${C.olive}"/>`
    + stag(1010, 286, 0.62, { fill: C.forest, flip: true })
    + treeline({ x0: -10, x1: 1220, base: 352, minH: 40, maxH: 96, fill: C.pine, seed: 7, gaps: [[820, 1060]] })
    + `<path d="M0 360 C 300 346, 700 356, 1200 340 L1200 450 L0 450 Z" fill="${C.pine}"/>`
    + highSeat(760, 372, 1.15, { fill: C.night })
    + `<path d="M0 418 C 380 404, 820 414, 1200 398 L1200 450 L0 450 Z" fill="${C.night}"/>`
    + grass(600, 1200, 410, C.night, 3, 12)
    + dog(1000, 432, 1.05)
    + hunter(1085, 434, 1.2, { flip: true }),
  );
}

/** Kategorie-Banner 3 : 1 auf hellem Grund (Kopf der Kategorieseiten). */
function kindBanner(kind) {
  const W = 1200;
  const H = 400;
  const scenes = {
    lease: () => {
      const sun = [930, 190];
      return [sun, `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
        + contours(260, 120, 1, C.mist, 0.55)
        + `<circle cx="${sun[0]}" cy="${sun[1]}" r="40" fill="${C.brand}"/>`
        + `<path d="M0 250 C 260 210, 520 220, 760 236 S 1060 214, 1200 222 L1200 400 L0 400 Z" fill="${C.mist}"/>`
        + treeline({ x0: 560, x1: 1220, base: 250, minH: 34, maxH: 70, fill: C.olive, seed: 11, gaps: [[880, 980]] })
        + `<path d="M0 286 C 300 256, 700 262, 1200 248 L1200 400 L0 400 Z" fill="${C.haze}"/>`
        + `<g stroke="${C.sage}" stroke-width="3" opacity=".55" fill="none"><path d="M40 400 C 200 330, 420 300, 640 280"/><path d="M200 400 C 360 330, 560 300, 760 278"/><path d="M380 400 C 520 340, 700 304, 880 274"/><path d="M560 400 C 700 346, 860 306, 1020 268"/><path d="M760 400 C 880 350, 1000 310, 1160 262"/></g>`
        + highSeat(930, 262, 0.52, { fill: C.forest })
        + `<path d="M0 352 C 320 334, 760 346, 1200 326 L1200 400 L0 400 Z" fill="${C.olive}"/>`
        + `<path d="M620 400 C 660 370, 720 350, 800 338 L828 338 C 760 352, 712 374, 690 400 Z" fill="${C.sand}" opacity=".8"/>`
        + grass(0, 1200, 352, C.olive, 5, 9)];
    },
    permit: () => {
      const sun = [600, 196];
      return [sun, `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
        + `<circle cx="${sun[0]}" cy="${sun[1]}" r="34" fill="${C.brand}"/>`
        + treeline({ x0: -10, x1: 1220, base: 262, minH: 50, maxH: 110, fill: C.haze, seed: 21, gaps: [[540, 660]], step: [12, 20] })
        + treeline({ x0: -10, x1: 470, base: 330, minH: 130, maxH: 230, fill: C.olive, seed: 22, step: [26, 44] })
        + treeline({ x0: 730, x1: 1220, base: 330, minH: 130, maxH: 230, fill: C.olive, seed: 23, step: [26, 44] })
        + `<path d="M0 300 C 300 280, 900 280, 1200 300 L1200 400 L0 400 Z" fill="${C.sage}"/>`
        + `<path d="M590 270 L612 270 C 640 320, 700 360, 780 400 L420 400 C 500 360, 560 320, 590 270 Z" fill="${C.sand}"/>`
        + treeline({ x0: -40, x1: 300, base: 410, minH: 260, maxH: 380, fill: C.forest, seed: 24, step: [60, 90] })
        + treeline({ x0: 930, x1: 1260, base: 410, minH: 260, maxH: 380, fill: C.forest, seed: 25, step: [60, 90] })
        + grass(300, 930, 400, C.olive, 9, 14)
        + hunter(600, 346, 1.2, { fill: C.forest, stride: 0.4 })];
    },
    driven_hunt: () => {
      const sun = [1010, 170];
      return [sun, `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
        + contours(240, 110, 1, C.mist, 0.55)
        + `<circle cx="${sun[0]}" cy="${sun[1]}" r="38" fill="${C.brand}"/>`
        + treeline({ x0: -10, x1: 1220, base: 252, minH: 60, maxH: 130, fill: C.olive, seed: 31, gaps: [[960, 1060]] })
        + `<path d="M0 252 C 400 240, 800 248, 1200 236 L1200 400 L0 400 Z" fill="${C.mist}"/>`
        + `<path d="M0 330 C 400 316, 800 324, 1200 310 L1200 400 L0 400 Z" fill="${C.haze}"/>`
        + grass(0, 1200, 330, C.haze, 13, 10)
        + hunter(470, 344, 1.0, { fill: C.forest, vest: true, flip: true })
        + dog(540, 346, 1.0, { fill: C.forest })
        + hunter(640, 348, 1.04, { fill: C.forest, vest: true, stride: 0.6 })
        + hunter(760, 342, 0.98, { fill: C.forest, vest: true, cap: true, flip: true })
        + dog(840, 344, 0.95, { fill: C.forest, sit: true, flip: true })
        + `<path d="M0 384 C 400 376, 800 384, 1200 372 L1200 400 L0 400 Z" fill="${C.olive}"/>`];
    },
    trophy_hunt: () => {
      const sun = [880, 150];
      return [sun, `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
        + `<circle cx="${sun[0]}" cy="${sun[1]}" r="38" fill="${C.brand}"/>`
        + `<path d="M0 230 L150 120 L230 170 L360 70 L470 160 L560 110 L700 230 Z" fill="${C.mist}"/>`
        + `<path d="M150 120 L178 140 L160 150 L130 135 Z M360 70 L398 102 L372 110 L350 98 L330 92 Z M560 110 L590 136 L566 140 L548 122 Z" fill="${C.offwhite}"/>`
        + `<path d="M480 260 L640 150 L760 220 L900 120 L1060 230 L1200 180 L1200 300 L480 300 Z" fill="${C.haze}"/>`
        + `<path d="M900 120 L940 148 L912 156 L884 142 L872 140 Z" fill="${C.offwhite}"/>`
        + treeline({ x0: -10, x1: 1220, base: 286, minH: 36, maxH: 74, fill: C.sage, seed: 41 })
        + `<path d="M0 290 C 300 270, 640 300, 1200 262 L1200 400 L0 400 Z" fill="${C.sage}"/>`
        // Jagdhütte mit Geweih am Giebel
        + `<g fill="${C.forest}"><rect x="150" y="262" width="170" height="74"/><path d="M134 266 L235 214 L336 266 Z"/><rect x="290" y="226" width="14" height="26"/></g>`
        + `<rect x="178" y="286" width="26" height="22" fill="${C.brand}"/><rect x="262" y="286" width="26" height="22" fill="${C.brand}"/><rect x="220" y="298" width="22" height="38" fill="${C.olive}"/>`
        + `<g stroke="${C.sand}" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M235 252 C 228 246, 222 238, 220 228 M235 252 C 242 246, 248 238, 250 228 M224 242 L216 240 M246 242 L254 240 M221 234 L214 230 M249 234 L256 230"/></g>`
        + `<path d="M0 360 C 360 340, 760 352, 1200 330 L1200 400 L0 400 Z" fill="${C.olive}"/>`
        + `<path d="M620 300 C 760 270, 900 262, 1080 280 L1200 290 L1200 330 C 1000 320, 800 320, 620 332 Z" fill="${C.olive}"/>`
        + stag(880, 296, 1.15, { fill: C.forest })
        + grass(0, 1200, 360, C.olive, 17, 10)];
    },
    helper: () => {
      const sun = [300, 180];
      return [sun, `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
        + contours(880, 110, 1, C.mist, 0.55)
        + `<circle cx="${sun[0]}" cy="${sun[1]}" r="38" fill="${C.brand}"/>`
        + treeline({ x0: -10, x1: 1220, base: 270, minH: 60, maxH: 150, fill: C.olive, seed: 51, gaps: [[250, 350]] })
        + `<path d="M0 270 C 400 260, 800 268, 1200 256 L1200 400 L0 400 Z" fill="${C.haze}"/>`
        + highSeat(560, 352, 1.15, { fill: C.forest, open: true })
        + hunter(470, 346, 0.98, { fill: C.forest, gun: false, cap: true, stride: 0.2 })
        + `<g transform="translate(470 346) scale(0.98)"><rect x="-40" y="-84" width="100" height="5" fill="${C.olive}" transform="rotate(-7 4 -82)"/></g>`
        + `<g fill="${C.olive}"><rect x="660" y="334" width="120" height="7"/><rect x="666" y="326" width="110" height="7"/><rect x="672" y="318" width="96" height="7"/></g>`
        + dog(720, 350, 1.1, { fill: C.forest, sit: true, flip: true })
        + `<path d="M0 352 C 400 342, 800 354, 1200 338 L1200 400 L0 400 Z" fill="${C.olive}"/>`
        + grass(0, 1200, 352, C.olive, 19, 10)];
    },
  };
  const [sun, body] = scenes[kind]();
  return svg(W, H, lightSky("s", ...sun), body);
}

/** Vorschaubild 1200 × 630 (og:image) mit Bildmarke; ohne Schrift, weil die Markenschrift beim Rendern fehlt. */
function ogImage() {
  const W = 1200;
  const H = 630;
  const sun = [860, 420];
  const mark = `<g transform="translate(150 175) scale(4.2)"><path d="M32 62 L13 37 A22 22 0 1 1 51 37 Z" fill="${C.brand}"/>`
    + `<g fill="none" stroke="${C.night}" stroke-width="2.8" stroke-linecap="square"><path d="M32 30 L24 21 L23 11"/><path d="M24 21 L18 18"/><path d="M32 30 L40 21 L41 11"/><path d="M40 21 L46 18"/></g>`
    + `<path d="M27 29 L37 29 L32 40 Z" fill="${C.night}"/></g>`;
  return svg(W, H, darkSky("s", ...sun),
    `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#s-glow)"/>`
    + contours(300, 230, 1, C.sand, 0.14)
    + `<circle cx="${sun[0]}" cy="${sun[1]}" r="58" fill="${C.brand}"/>`
    + `<path d="M0 450 C 260 420, 520 400, 760 420 S 1060 392, 1200 404 L1200 630 L0 630 Z" fill="${C.olive}"/>`
    + stag(980, 410, 0.8, { fill: C.forest, flip: true })
    + treeline({ x0: -10, x1: 1220, base: 488, minH: 50, maxH: 120, fill: C.pine, seed: 61, gaps: [[760, 1050]] })
    + `<path d="M0 500 C 300 484, 700 494, 1200 476 L1200 630 L0 630 Z" fill="${C.pine}"/>`
    + highSeat(700, 516, 1.45, { fill: C.night })
    + `<path d="M0 578 C 380 562, 820 574, 1200 556 L1200 630 L0 630 Z" fill="${C.night}"/>`
    + grass(500, 1200, 570, C.night, 23, 14)
    + dog(1000, 584, 1.3, { fill: C.deep })
    + hunter(1085, 588, 1.3, { flip: true })
    + mark,
  );
}

mkdirSync(OUT, { recursive: true });
const files = { [`hero.${VERSION}.svg`]: hero() };
for (const kind of ["lease", "permit", "driven_hunt", "trophy_hunt", "helper"]) files[`kind-${kind}.${VERSION}.svg`] = kindBanner(kind);
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
await sharp(Buffer.from(ogImage())).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(join(OUT, `og-default.${VERSION}.png`));
console.log(`${Object.keys(files).length} SVG und og-default.${VERSION}.png in ${OUT}`);
