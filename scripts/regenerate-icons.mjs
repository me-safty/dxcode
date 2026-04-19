#!/usr/bin/env node
// Regenerate every Workbench raster icon from the canonical SVG mark.
//
// Source of truth: assets/prod/logo.svg (transparent, currentColor workbench
// mark — bench top + 2 legs + 3 blocks). This script rasterizes that SVG into
// every PNG/ICO/ICNS the desktop, web, and marketing surfaces consume.
//
// For dev/nightly variants the workbench mark is composited on top of the
// existing blueprint-blue gradient backgrounds (which live next to this
// script's outputs as the prior assets/dev/blueprint-*.png and
// assets/nightly/blueprint-*.png files).
//
// Toolchain:
//   - sharp           SVG → PNG, compositing, resizing
//   - png-to-ico      Multi-resolution ICO encoder
//   - sips/iconutil   macOS-only path for .icns generation. Falls back to a
//                     pure-JS ICNS encoder when those binaries are absent.
//
// Usage:
//   bun run regenerate:icons
//   node scripts/regenerate-icons.mjs

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const PROD_DIR = join(repoRoot, "assets", "prod");
const DEV_DIR = join(repoRoot, "assets", "dev");
const NIGHTLY_DIR = join(repoRoot, "assets", "nightly");
const WEB_PUBLIC_DIR = join(repoRoot, "apps", "web", "public");
const DESKTOP_RES_DIR = join(repoRoot, "apps", "desktop", "resources");

const PROD_SVG_PATH = join(PROD_DIR, "logo.svg");

// Workbench mark SVG with the fill colour swapped to white so it composites
// legibly over the blueprint-blue background of the dev/nightly variants.
const WHITE_MARK_SVG = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="40" width="80" height="8" fill="white"/>
  <rect x="25" y="48" width="6" height="30" fill="white"/>
  <rect x="89" y="48" width="6" height="30" fill="white"/>
  <rect x="35" y="25" width="12" height="12" fill="white"/>
  <rect x="55" y="20" width="10" height="17" fill="white"/>
  <rect x="70" y="28" width="15" height="9" fill="white"/>
</svg>`;

// Windows ICO multi-res manifest. 256 must come last because some shells use
// the largest entry as the "high-quality" variant.
const WINDOWS_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Browser favicon.ico typically only needs the small sizes. 48 is included so
// Windows pinned-tile UIs render crisply without needing to re-stretch.
const FAVICON_ICO_SIZES = [16, 32, 48];

const log = (...args) => console.log("[regenerate-icons]", ...args);

async function rasterizePngFromSvg(svgBuffer, size) {
  return sharp(svgBuffer, { density: Math.max(72, Math.round((size / 120) * 72)) })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Recreate the layered blueprint composition from its constituent source
// images. The icon-composer file (assets/dev/blueprint-icon-composer.icon)
// describes a 3-layer stack — gpt-image background, foreground mark, paper
// texture — that we replay here so the workbench mark fully replaces the
// previous "T3" letters instead of being painted on top of them.
const ICON_COMPOSER_DIR = join(repoRoot, "assets", "dev", "blueprint-icon-composer.icon", "Assets");
const COMPOSER_BG_PATH = join(
  ICON_COMPOSER_DIR,
  "gpt-image-1.5-kn76n9hynne5q3qxy3g91chp2d84t871.png",
);
const COMPOSER_PAPER_PATH = join(ICON_COMPOSER_DIR, "Texturelabs_Paper_381XL.jpg");

// The blueprint outputs preserve a transparent rounded-square inset so the
// macOS / iOS launchers can apply their own corner masks. We replicate the
// inset from the original PNGs (the bounded mid-row range was 114..1938 of
// 2048, i.e. ~5.5% inset on each side).
const ROUNDED_SQUARE_INSET_FRACTION = 0.055;
const ROUNDED_SQUARE_CORNER_FRACTION = 0.225;

async function buildRoundedSquareMask(size) {
  const inset = Math.round(size * ROUNDED_SQUARE_INSET_FRACTION);
  const sideLen = size - 2 * inset;
  const radius = Math.round(sideLen * ROUNDED_SQUARE_CORNER_FRACTION);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="${inset}" y="${inset}" width="${sideLen}" height="${sideLen}" rx="${radius}" ry="${radius}" fill="white"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildBlueprintComposite(_unusedBgPath, outputSize, markPaddingFraction = 0.22) {
  // Layer 1: blueprint background, scaled 1.05x and centre-cropped to the
  // canvas (matches the icon-composer "scale: 1.05" position — slight zoom
  // with edge bleed clipped).
  const bgScaled = Math.round(outputSize * 1.05);
  const cropOffset = Math.round((bgScaled - outputSize) / 2);
  const baseCanvas = await sharp(COMPOSER_BG_PATH)
    .resize(bgScaled, bgScaled, { fit: "fill" })
    .extract({ left: cropOffset, top: cropOffset, width: outputSize, height: outputSize })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Layer 2: workbench mark in white, scaled to fill ~(1 - 2*padding) of the
  // canvas and centred.
  const markSize = Math.round(outputSize * (1 - 2 * markPaddingFraction));
  const markBuffer = await sharp(Buffer.from(WHITE_MARK_SVG), {
    density: Math.max(72, Math.round((markSize / 120) * 72)),
  })
    .resize(markSize, markSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Layer 3: paper texture at 50% opacity (matches translucency 0.5 in the
  // icon-composer stack). We resize the texture to the output dimensions and
  // downscale its alpha channel uniformly to 50%.
  const paperFill = await sharp(COMPOSER_PAPER_PATH)
    .resize(outputSize, outputSize, { fit: "cover" })
    .ensureAlpha(0.5)
    .png()
    .toBuffer();

  // Composite mark over background, then paper-texture over the result.
  const withMark = await sharp(baseCanvas)
    .composite([
      {
        input: markBuffer,
        top: Math.round((outputSize - markSize) / 2),
        left: Math.round((outputSize - markSize) / 2),
      },
    ])
    .png()
    .toBuffer();

  const withPaper = await sharp(withMark)
    .composite([{ input: paperFill, blend: "multiply" }])
    .png()
    .toBuffer();

  // Apply the rounded-square inset mask so the output has a transparent
  // border, matching the previous blueprint-*.png outputs.
  const mask = await buildRoundedSquareMask(outputSize);
  const masked = await sharp(withPaper)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return masked;
}

async function buildIco(sizes, source) {
  // png-to-ico accepts an array of PNG buffers (one per resolution).
  const pngs = [];
  for (const size of sizes) {
    pngs.push(await source(size));
  }
  return pngToIco(pngs);
}

function tryShellCommand(cmd) {
  const result = spawnSync(cmd, ["--help"], { stdio: ["ignore", "pipe", "pipe"] });
  // sips/iconutil emit usage to stdout/stderr regardless of exit code; presence
  // of the binary is what we care about, not exit status.
  return result.error === undefined;
}

function buildIcnsViaIconutil(pngsBySize, outputPath) {
  if (!tryShellCommand("/usr/bin/iconutil")) return false;
  if (!tryShellCommand("/usr/bin/sips")) return false;

  const iconsetRoot = mkdtempSync(join(tmpdir(), "workbench-iconset-"));
  const iconsetDir = join(iconsetRoot, "icon.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const [size, png] of pngsBySize) {
      writeFileSync(join(iconsetDir, `icon_${size}x${size}.png`), png);
    }
    const result = spawnSync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", outputPath], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`iconutil exited with status ${result.status}`);
    }
    return true;
  } finally {
    rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

// Pure-JS ICNS encoder. Used as a fallback when iconutil is unavailable.
//
// Apple's ICNS file format wraps a sequence of typed chunks. Each chunk has a
// 4-byte ASCII OSType, a 4-byte big-endian length (including the 8-byte
// header), and a payload. Modern macOS readers accept PNG payloads for the
// "ic07" (128px), "ic08" (256px), "ic09" (512px), "ic10" (1024px), "ic11"
// (32@2x = 64px), "ic12" (64@2x = 128px), "ic13" (256@2x = 512px) and "ic14"
// (512@2x = 1024px) chunks.
function buildIcnsManually(pngsBySize) {
  const TYPE_BY_SIZE = new Map([
    [16, "icp4"],
    [32, "icp5"],
    [64, "icp6"],
    [128, "ic07"],
    [256, "ic08"],
    [512, "ic09"],
    [1024, "ic10"],
  ]);
  const chunks = [];
  for (const [size, png] of pngsBySize) {
    const type = TYPE_BY_SIZE.get(size);
    if (!type) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(8 + png.length, 4);
    chunks.push(Buffer.concat([header, png]));
  }
  const totalLen = 8 + chunks.reduce((acc, c) => acc + c.length, 0);
  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, "ascii");
  fileHeader.writeUInt32BE(totalLen, 4);
  return Buffer.concat([fileHeader, ...chunks]);
}

async function writeIcnsFromMark({ outputPath, source, sizes }) {
  const pngsBySize = [];
  for (const size of sizes) {
    pngsBySize.push([size, await source(size)]);
  }
  if (buildIcnsViaIconutil(pngsBySize, outputPath)) {
    log("wrote", outputPath, "via iconutil");
    return;
  }
  const icns = buildIcnsManually(pngsBySize);
  writeFileSync(outputPath, icns);
  log("wrote", outputPath, "via pure-JS ICNS encoder");
}

async function writeFile(outputPath, buffer) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
  log("wrote", outputPath, `(${buffer.length} bytes)`);
}

async function main() {
  const prodSvg = readFileSync(PROD_SVG_PATH);

  // -------------------- Production raster set --------------------
  const prodMark = (size) => rasterizePngFromSvg(prodSvg, size);

  await writeFile(join(PROD_DIR, "workbench-macos-1024.png"), await prodMark(1024));
  await writeFile(join(PROD_DIR, "workbench-universal-1024.png"), await prodMark(1024));
  await writeFile(join(PROD_DIR, "workbench-web-favicon-16x16.png"), await prodMark(16));
  await writeFile(join(PROD_DIR, "workbench-web-favicon-32x32.png"), await prodMark(32));
  await writeFile(join(PROD_DIR, "workbench-web-apple-touch-180.png"), await prodMark(180));
  await writeFile(
    join(PROD_DIR, "workbench-windows.ico"),
    await buildIco(WINDOWS_ICO_SIZES, prodMark),
  );
  await writeFile(
    join(PROD_DIR, "workbench-web-favicon.ico"),
    await buildIco(FAVICON_ICO_SIZES, prodMark),
  );

  // -------------------- Dev/nightly composites --------------------
  // Both variants share the same blueprint stack today; the brief calls for
  // identical renditions in each directory.
  for (const variant of [
    { dir: DEV_DIR, label: "dev" },
    { dir: NIGHTLY_DIR, label: "nightly" },
  ]) {
    const compose = async (finalSize, markPadding = 0.22) =>
      buildBlueprintComposite(null, finalSize, markPadding);

    // Compose at the SAME pixel dimensions as the prior PNGs (2048×2048 for
    // the @1024 macos/universal/ios slots) so any downstream code that reads
    // exact dimensions keeps working.
    await writeFile(join(variant.dir, "blueprint-macos-1024.png"), await compose(2048));
    await writeFile(join(variant.dir, "blueprint-universal-1024.png"), await compose(2048));
    await writeFile(join(variant.dir, "blueprint-ios-1024.png"), await compose(2048));
    await writeFile(join(variant.dir, "blueprint-web-apple-touch-180.png"), await compose(180));
    await writeFile(join(variant.dir, "blueprint-web-favicon-16x16.png"), await compose(16, 0.1));
    await writeFile(join(variant.dir, "blueprint-web-favicon-32x32.png"), await compose(32, 0.12));

    // Windows ICO with the multi-res manifest. We re-render the composite at
    // each ICO frame size so small frames stay legible (a single resize from
    // 2048→16 muddies the workbench mark).
    const blueprintIcoSource = async (size) => compose(size, 0.18);
    await writeFile(
      join(variant.dir, "blueprint-windows.ico"),
      await buildIco(WINDOWS_ICO_SIZES, blueprintIcoSource),
    );

    // Web favicon ICO (only present in dev today, but emit for both for
    // future-proofing).
    if (existsSync(join(variant.dir, "blueprint-web-favicon.ico")) || variant.label === "nightly") {
      await writeFile(
        join(variant.dir, "blueprint-web-favicon.ico"),
        await buildIco(FAVICON_ICO_SIZES, (size) => compose(size, 0.1)),
      );
    }

    log(`finished ${variant.label} variant`);
  }

  // -------------------- Web public icons --------------------
  await writeFile(join(WEB_PUBLIC_DIR, "favicon-16x16.png"), await prodMark(16));
  await writeFile(join(WEB_PUBLIC_DIR, "favicon-32x32.png"), await prodMark(32));
  await writeFile(join(WEB_PUBLIC_DIR, "apple-touch-icon.png"), await prodMark(180));
  await writeFile(join(WEB_PUBLIC_DIR, "favicon.ico"), await buildIco(FAVICON_ICO_SIZES, prodMark));

  // -------------------- Desktop committed fallback resources --------------------
  // These are the dev/CI fallback icons; production builds substitute the
  // brand-assets PNGs at package time. We still ship transparent workbench
  // marks here so the bare `electron` launcher shows something on-brand.
  await writeFile(join(DESKTOP_RES_DIR, "icon.png"), await prodMark(512));
  await writeFile(join(DESKTOP_RES_DIR, "icon.ico"), await buildIco(WINDOWS_ICO_SIZES, prodMark));
  await writeIcnsFromMark({
    outputPath: join(DESKTOP_RES_DIR, "icon.icns"),
    source: prodMark,
    sizes: [16, 32, 64, 128, 256, 512, 1024],
  });

  log("done");
}

await main();
