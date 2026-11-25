#!/usr/bin/env node
"use strict";
const sharp = require("sharp");

// Creates one AI-generated, dish-specific image file per menu entry.
// Requires POLLINATIONS_API_KEY. Images are saved locally and referenced by menu-data.js.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = process.cwd();
const MENU_FILE = path.join(ROOT, "menu-data.js");
const ASSET_DIR = path.join(ROOT, "assets", "dishes");
const MANIFEST_FILE = path.join(ASSET_DIR, "manifest.json");
const API_KEY = process.env.POLLINATIONS_API_KEY;
const MODEL = process.env.IMAGE_MODEL || "black-forest-labs/flux.1-schnell";
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.IMAGE_CONCURRENCY || 2)));
const WIDTH = 640;
const HEIGHT = 480;
const JPEG_QUALITY = 78;
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? Math.max(0, Number(process.argv[LIMIT_ARG + 1] || 0)) : 0;

if (!API_KEY) {
  console.error("Missing POLLINATIONS_API_KEY. Add it as a GitHub Actions secret; never put it in source code.");
  process.exit(1);
}

function slugify(value) {
  return String(value || "dish").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "dish";
}
function hashNumber(value) {
  const hash = crypto.createHash("sha256").update(String(value)).digest();
  return hash.readUInt32BE(0);
}
function promptFor(dish, attempt) {
  const name = String(dish.name || "restaurant dish").trim();
  const cuisine = String(dish.cuisine || dish.cat || "restaurant").trim();
  const section = String(dish.section || "").trim();
  const subcategory = String(dish.subcategory || "").trim();
  const details = [subcategory, section].filter(Boolean).join(", ");
  const isDrink = /drink|beverage|coffee|tea|mocktail|juice|smoothie|lassi|milkshake|frappe/i.test([name, cuisine, details].join(" "));
  const isDessert = /dessert|bakery|cake|pastry|ice cream|cookie|sweet/i.test([name, cuisine, details].join(" "));
  const isAddon = dish.kind === "addon" || /extras? & add-ons/i.test(cuisine);
  let framing = "one complete plated serving, photographed at a natural 35-degree food-photography angle";
  if (isDrink) framing = "one finished drink in an elegant glass or cup, photographed at a natural 35-degree café photography angle";
  if (isDessert) framing = "one finished dessert portion on a refined dessert plate, photographed at a natural 35-degree pastry photography angle";
  if (isAddon) framing = "a clear, appetising close-up of this exact topping or add-on, served in a small ceramic dish";
  const variation = ["soft window light with a pale stone surface", "warm diffused daylight on a light neutral tabletop", "clean editorial café lighting with subtle natural shadows", "bright restaurant menu lighting with a cream backdrop"][attempt % 4];
  return "Create a photorealistic premium restaurant menu photograph of the exact dish named: " + name + ". Cuisine: " + cuisine + ". Menu section: " + details + ". The food itself must visibly match the named dish and its customary real-world ingredients, shape, cooking method, plating and garnish. Do not substitute a different dish, do not make a generic cuisine platter, and do not add unrelated foods. Show " + framing + ". " + variation + ". Beautiful but believable restaurant styling, appetising natural food texture, crisp focus on the dish, elegant cream or pale stone setting, professional commercial food photography, landscape 4:3 composition. No text, no letters, no menu, no logo, no watermark, no collage, no people, no hands, no utensils obscuring the food. Distinct composition for this menu item; visual variation seed " + hashNumber(name + "|" + dish.id + "|" + attempt) + ".";
}
function extensionFor(contentType) {
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/webp/i.test(contentType)) return "webp";
  if (/image\/avif/i.test(contentType)) return "avif";
  if (/image\/jpeg|image\/jpg/i.test(contentType)) return "jpg";
  throw new Error("Image provider returned unsupported content type: " + contentType);
}
async function requestImage(dish, attempt) {
  const prompt = promptFor(dish, attempt);
  const seed = hashNumber("saffron-stone|" + dish.id + "|" + dish.name + "|" + attempt);
  const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) + "?model=" + encodeURIComponent(MODEL) + "&width=" + WIDTH + "&height=" + HEIGHT + "&seed=" + seed + "&nologo=true";
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + API_KEY, Accept: "image/jpeg,image/png,image/webp,image/avif" },
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    const error = new Error("Image API returned HTTP " + response.status + ": " + body);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "";
  const rawBytes = Buffer.from(await response.arrayBuffer());
  if (rawBytes.length < 4000) throw new Error("Generated image was unexpectedly small (" + rawBytes.length + " bytes).");
  const bytes = await sharp(rawBytes).rotate().resize(WIDTH, HEIGHT, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  const extension = "jpg";
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  return { bytes, extension, digest, seed, prompt };
}
async function withRetry(dish, knownHashes) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await requestImage(dish, attempt);
      if (knownHashes.has(result.digest)) {
        console.warn("Duplicate image bytes for " + dish.name + "; generating a different composition.");
        continue;
      }
      knownHashes.add(result.digest);
      return result;
    } catch (error) {
      if ([401, 402, 403].includes(error.status)) throw error;
      if (attempt === 4) throw error;
      const wait = Math.min(15000, 1500 * (2 ** attempt));
      console.warn("Retry " + (attempt + 1) + "/4 for " + dish.name + ": " + error.message);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw new Error("Could not produce a unique image for " + dish.name);
}
async function main() {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const source = await fs.readFile(MENU_FILE, "utf8");
  const match = source.match(/window\.MENU_ITEMS\s*=\s*(\[.*?\]);\s*window\.MENU_SUMMARY\s*=\s*(\{.*?\});/s);
  if (!match) throw new Error("Could not parse window.MENU_ITEMS and window.MENU_SUMMARY from menu-data.js.");
  const dishes = JSON.parse(match[1]);
  const summary = JSON.parse(match[2]);
  let manifest = { version: 1, model: MODEL, generatedAt: null, entries: [] };
  try { manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const knownHashes = new Set((manifest.entries || []).map(entry => entry.sha256).filter(Boolean));
  const pending = [];
  for (const dish of dishes) {
    if (!dish || !dish.id || !dish.name) continue;
    if (typeof dish.img === "string" && dish.img.startsWith("assets/dishes/")) {
      try { await fs.access(path.join(ROOT, dish.img)); continue; } catch { /* regenerate missing local asset */ }
    }
    pending.push(dish);
  }
  const selected = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  console.log("Menu entries: " + dishes.length + " | images already ready: " + (dishes.length - pending.length) + " | queued this run: " + selected.length + " | model: " + MODEL);
  if (!selected.length) {
    console.log("Every menu item already has its own local image file. Nothing to generate.");
    return;
  }
  let cursor = 0;
  let generated = 0;
  let fatalError = null;
  const failures = [];
  let writeQueue = Promise.resolve();
  const persist = () => {
    writeQueue = writeQueue.then(async () => {
      await fs.writeFile(MENU_FILE, "window.MENU_ITEMS = " + JSON.stringify(dishes) + ";\nwindow.MENU_SUMMARY = " + JSON.stringify({ ...summary, uniqueDishImages: dishes.filter(d => typeof d.img === "string" && d.img.startsWith("assets/dishes/")).length }) + ";\n");
      manifest.model = MODEL;
      manifest.generatedAt = new Date().toISOString();
      manifest.entries = manifest.entries || [];
      await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
    });
    return writeQueue;
  };
  async function worker() {
    while (!fatalError) {
      const index = cursor++;
      if (index >= selected.length) return;
      const dish = selected[index];
      try {
        const image = await withRetry(dish, knownHashes);
        const fileName = String(dish.id).padStart(4, "0") + "-" + slugify(dish.name) + "." + image.extension;
        const relativePath = "assets/dishes/" + fileName;
        await fs.writeFile(path.join(ASSET_DIR, fileName), image.bytes);
        dish.img = relativePath;
        manifest.entries = (manifest.entries || []).filter(entry => entry.id !== dish.id);
        manifest.entries.push({ id: dish.id, name: dish.name, file: relativePath, sha256: image.digest, seed: image.seed, model: MODEL });
        generated++;
        await persist();
        console.log("[" + generated + "/" + selected.length + "] " + dish.name + " -> " + relativePath);
      } catch (error) {
        failures.push({ id: dish.id, name: dish.name, error: error.message });
        console.error("Could not generate image for " + dish.name + ": " + error.message);
        if ([401, 402, 403].includes(error.status)) {
          fatalError = error;
          return;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await persist();
  const ready = dishes.filter(d => typeof d.img === "string" && d.img.startsWith("assets/dishes/")).length;
  const pendingAfter = dishes.length - ready;
  console.log("\nImage generation summary:");
  console.log("Generated this run: " + generated);
  console.log("Unique local images ready: " + ready + "/" + dishes.length);
  console.log("Still pending: " + pendingAfter);
  console.log("Failed this run: " + failures.length);
  if (fatalError) console.error("Generation stopped by the provider. Check the key, permissions or spending budget, then rerun; existing images will be skipped.");
  if (failures.length) await fs.writeFile(path.join(ASSET_DIR, "generation-errors.json"), JSON.stringify(failures, null, 2) + "\n");
  if (failures.length || fatalError || (generated === 0 && pendingAfter > 0)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
