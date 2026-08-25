/**
 * icon.svg  ->  icon.png (macOS/Linux) + icon.ico (Windows) + icon.icns (optional, macOS)
 *
 *   deno task icons        (aus dem Projektstamm)
 *
 * Rendert wird mit @resvg/resvg-js (Rust, vorkompiliert) — kein librsvg, kein
 * ImageMagick, kein Inkscape nötig. `.icns` entsteht per `iconutil` und wird
 * übersprungen, wenn das Tool fehlt; `deno desktop --icon` akzeptiert auf macOS
 * auch direkt die PNG.
 *
 * **Warum diese Datei in `tools/` liegt und nicht neben den Icons:**
 * `@resvg/resvg-js` bringt vorkompilierte Binaries mit und ist damit eine
 * npm-Abhängigkeit. Sobald am Compile-Root *irgendeine* npm-Abhängigkeit
 * hängt, bettet `deno compile` das komplette physische `node_modules` ins
 * Binary ein — auch das, was der Server nie anfasst. `tools/` ist deshalb ein
 * eigenständiges Deno-Projekt mit eigenem `node_modules`; gelesen und
 * geschrieben wird trotzdem in `../icons/`.
 */
import { Resvg } from "@resvg/resvg-js";
import { dirname, fromFileUrl, join } from "@std/path";

/** Ziel- und Quellverzeichnis: `icons/` im Projektstamm, eine Ebene höher. */
const here = join(dirname(fromFileUrl(import.meta.url)), "..", "icons");
const svg = await Deno.readTextFile(join(here, "icon.svg"));

/**
 * Rastert die SVG auf eine quadratische Kantenlänge.
 *
 * `asPng()` liefert einen node-`Buffer`; der ist zwar zur Laufzeit ein
 * `Uint8Array`, hat aber seit @types/node 22 eine unverträgliche Typangabe.
 * Der Umweg über den Konstruktor kostet nichts und hält `deno check` sauber.
 */
function render(size: number): Uint8Array {
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
}

// ---------------------------------------------------------------- PNG (1024px)
const png1024 = render(1024);
await Deno.writeFile(join(here, "icon.png"), png1024);
console.log("icon.png      1024x1024");

// ------------------------------------------------------------------------ ICO
// ICO-Verzeichnis mit PNG-Payloads (von Windows Vista an unterstützt).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map(render);
const header = new Uint8Array(6 + icoSizes.length * 16);
const view = new DataView(header.buffer);
view.setUint16(2, 1, true); // Typ 1 = Icon
view.setUint16(4, icoSizes.length, true);
let offset = header.length;
icoSizes.forEach((size, i) => {
  const at = 6 + i * 16;
  header[at] = size === 256 ? 0 : size; // 0 bedeutet 256
  header[at + 1] = size === 256 ? 0 : size;
  view.setUint16(at + 4, 1, true); // Farbebenen
  view.setUint16(at + 6, 32, true); // Bits pro Pixel
  view.setUint32(at + 8, icoPngs[i].length, true);
  view.setUint32(at + 12, offset, true);
  offset += icoPngs[i].length;
});
const ico = new Uint8Array(offset);
ico.set(header, 0);
let cursor = header.length;
for (const png of icoPngs) {
  ico.set(png, cursor);
  cursor += png.length;
}
await Deno.writeFile(join(here, "icon.ico"), ico);
console.log(`icon.ico      ${icoSizes.join(", ")}`);

// ----------------------------------------------------------------------- ICNS
const iconutil = await new Deno.Command("which", { args: ["iconutil"], stdout: "null", stderr: "null" })
  .output().then((r) => r.success).catch(() => false);

if (!iconutil) {
  console.log("icon.icns     übersprungen (iconutil nur auf macOS vorhanden)");
} else {
  const iconset = join(here, "icon.iconset");
  await Deno.mkdir(iconset, { recursive: true });
  for (
    const [size, scale] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [
      512,
      1,
    ], [512, 2]]
  ) {
    const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
    await Deno.writeFile(join(iconset, name), render(size * scale));
  }
  const out = await new Deno.Command("iconutil", {
    args: ["-c", "icns", iconset, "-o", join(here, "icon.icns")],
  }).output();
  await Deno.remove(iconset, { recursive: true });
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  console.log("icon.icns     16..512 @1x/@2x");
}
