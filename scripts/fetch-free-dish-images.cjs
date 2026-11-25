#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const ROOT = process.cwd();
const MENU_FILE = path.join(ROOT, "menu-data.js");
const ASSET_DIR = path.join(ROOT, "assets", "dishes");
const MANIFEST_FILE = path.join(ASSET_DIR, "manifest.json");
const ATTRIBUTION_FILE = path.join(ASSET_DIR, "ATTRIBUTION.md");
const PLACEHOLDER = "assets/dishes/image-pending.svg";
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? Math.max(0, Number(process.argv[LIMIT_ARG + 1] || 25)) : 25;
const RETRY_NO_MATCH = process.argv.includes("--retry-no-match");
const PAGE_SIZE = 20;
const WAIT_MS = 1300;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);
const STOP_WORDS = new Set([
  "and","with","the","of","in","on","a","an","style","special","classic","house",
  "favourite","favorite","signature","combo","platter","meal","set","served",
  "fresh","freshly","prepared","restaurant","cafe","café","menu","food","dish",
  "veg","vegetarian","nonveg","non-veg","non","vegan","small","large","regular",
  "mini","family","portion","piece","pieces","full","half","single","double"
]);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const normalise = value => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

function meaningfulTokens(name) {
  return normalise(name).split(" ").filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function parseMenu(source) {
  const match = source.match(/window\.MENU_ITEMS\s*=\s*(\[.*?\]);\s*window\.MENU_SUMMARY\s*=\s*(\{.*?\});/s);
  if (!match) throw new Error("Could not parse MENU_ITEMS and MENU_SUMMARY from menu-data.js.");
  return { items: JSON.parse(match[1]), summary: JSON.parse(match[2]) };
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SaffronAndStoneMenu/1.0 (openly licensed food photo sourcing)"
        },
        signal: AbortSignal.timeout(45000)
      });
      if (response.status === 429 || response.status >= 500) {
        const error = new Error("Openverse returned HTTP " + response.status);
        error.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        await wait(Math.max(retryAfter * 1000, 1500 * (attempt + 1)));
        lastError = error;
        continue;
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 350);
        throw new Error("Openverse search failed: HTTP " + response.status + " " + detail);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(1000 * (attempt + 1));
    }
  }
  throw lastError || new Error("Openverse search did not respond.");
}

function scoreCandidate(dish, result) {
  const tokens = meaningfulTokens(dish.name);
  if (!tokens.length) return 0;
  const title = normalise(result.title);
  const tags = (result.tags || []).map(tag => normalise(typeof tag === "string" ? tag : tag.name)).filter(Boolean);
  const combined = title + " " + tags.join(" ");
  const exactPhrase = normalise(dish.name);
  if (exactPhrase.length > 2 && title.includes(exactPhrase)) return 1;
  let matched = 0;
  let titleMatched = 0;
  for (const token of tokens) {
    const inTitle = (" " + title + " ").includes(" " + token + " ");
    const inTags = tags.some(tag => (" " + tag + " ").includes(" " + token + " "));
    if (inTitle || inTags) matched++;
    if (inTitle) titleMatched++;
  }
  const coverage = matched / tokens.length;
  // Require at least one meaningful title match; tag-only generic food photos are rejected.
  if (!titleMatched) return 0;
  if (tokens.length === 1 && matched !== 1) return 0;
  if (tokens.length >= 2 && coverage < 0.67) return 0;
  // Penalise results whose title looks like a broad cuisine or restaurant category.
  const broadTerms = ["restaurant","cuisine","food menu","indian food","chinese food","italian food","buffet"];
  const broadPenalty = broadTerms.some(term => title === term) ? 0.25 : 0;
  return Math.max(0, coverage * 0.85 + (titleMatched / tokens.length) * 0.15 - broadPenalty);
}

function resultAllowed(result) {
  const license = String(result.license || "").toLowerCase();
  return ALLOWED_LICENSES.has(license) && result.category === "photograph" && result.thumbnail;
}

async function searchDish(dish, usedIds, usedHashes) {
  const query = normalise(dish.name);
  if (!query) return null;
  const params = new URLSearchParams({
    q: query,
    license: "cc0,by,by-sa,pdm",
    license_type: "modification",
    category: "photograph",
    filter_dead: "true",
    mature: "false",
    page_size: String(PAGE_SIZE),
    page: "1"
  });
  const endpoint = "https://api.openverse.org/v1/images/?" + params.toString();
  const data = await fetchJson(endpoint);
  const results = Array.isArray(data.results) ? data.results : [];
  const ranked = results
    .filter(result => resultAllowed(result) && !usedIds.has(result.id))
    .map(result => ({ result, score: scoreCandidate(dish, result) }))
    .filter(candidate => candidate.score >= 0.67)
    .sort((a, b) => b.score - a.score);
  for (const candidate of ranked) {
    const result = candidate.result;
    try {
      const thumbUrl = result.thumbnail + (result.thumbnail.includes("?") ? "&" : "?") + "full_size=false&compressed=true";
      const response = await fetch(thumbUrl, {
        headers: { "User-Agent": "SaffronAndStoneMenu/1.0 (openly licensed food photo sourcing)" },
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 3000 || bytes.length > MAX_DOWNLOAD_BYTES) continue;
      const jpeg = await sharp(bytes).rotate().resize(900, 675, { fit: "cover", position: "attention" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      const digest = hash(jpeg);
      if (usedHashes.has(digest)) continue;
      usedHashes.add(digest);
      usedIds.add(result.id);
      return {
        bytes: jpeg,
        digest,
        score: candidate.score,
        source: {
          id: result.id,
          title: result.title || dish.name,
          creator: result.creator || "Unknown creator",
          creator_url: result.creator_url || "",
          license: result.license,
          license_version: result.license_version || "",
          license_url: result.license_url || "",
          source_url: result.foreign_landing_url || result.detail_url || "",
          image_url: result.url || "",
          provider: result.provider || "",
          attribution: result.attribution || ""
        }
      };
    } catch (error) {
      console.warn("Could not download candidate for " + dish.name + ": " + error.message);
    }
  }
  return null;
}

function safeSlug(value) {
  return normalise(value).replace(/\s+/g, "-").slice(0, 64) || "dish";
}

function attributionMarkdown(items) {
  const rows = [
    "# Dish image credits",
    "",
    "Images are sourced from Openverse. Each entry records the source page and licence returned by the provider. Verify licence details before commercial publication; Openverse notes that it cannot guarantee the accuracy of licence metadata.",
    ""
  ];
  for (const dish of items) {
    const credit = dish.imageCredit;
    if (!credit) continue;
    if (credit.license === "AI-generated") {
      rows.push("- **" + dish.name + "** — AI-generated image (previously generated).");
    } else if (credit.source_url) {
      rows.push("- **" + dish.name + "** — [" + (credit.title || "Image source") + "](" + credit.source_url + ") by " + (credit.creator || "Unknown creator") +
        "; licence [" + (credit.license || "unknown") + "](" + (credit.license_url || credit.source_url) + ").");
    }
  }
  rows.push("");
  return rows.join("\n");
}

async function main() {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const source = await fs.readFile(MENU_FILE, "utf8");
  const { items, summary } = parseMenu(source);
  let manifest = { version: 2, source: "Openverse", entries: [] };
  try { manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const manifestById = new Map((manifest.entries || []).map(entry => [String(entry.id), entry]));
  const usedIds = new Set((manifest.entries || []).map(entry => entry.openverse_id).filter(Boolean));
  const usedHashes = new Set((manifest.entries || []).map(entry => entry.sha256).filter(Boolean));
  const pending = [];
  for (const dish of items) {
    const imagePath = String(dish.img || "");
    const existingLocal = imagePath.startsWith("assets/dishes/") && imagePath !== PLACEHOLDER;
    if (existingLocal) {
      try { await fs.access(path.join(ROOT, imagePath)); dish.imageStatus = "ready"; continue; }
      catch { /* source missing locally: retry it */ }
    }
    if (dish.imageStatus === "no-match" && !RETRY_NO_MATCH) continue;
    pending.push(dish);
  }
  const selected = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  console.log("Menu entries: " + items.length +
    " | already have local image: " + (items.length - pending.length) +
    " | queued in this batch: " + selected.length +
    " | source: Openverse (free, openly licensed)");

  let generated = 0;
  let noMatch = 0;
  let failed = 0;
  const failures = [];
  for (const dish of selected) {
    try {
      await wait(WAIT_MS);
      const found = await searchDish(dish, usedIds, usedHashes);
      if (!found) {
        dish.img = PLACEHOLDER;
        dish.imageStatus = "no-match";
        dish.imageCredit = { creator: "", license: "", source_url: "", license_url: "", attribution: "No suitable openly licensed photo found yet" };
        noMatch++;
        console.log("[NO MATCH] " + dish.name + " — left on neutral placeholder.");
        continue;
      }
      const fileName = String(dish.id).padStart(4, "0") + "-" + safeSlug(dish.name) + ".jpg";
      const relativeFile = "assets/dishes/" + fileName;
      await fs.writeFile(path.join(ROOT, relativeFile), found.bytes);
      dish.img = relativeFile;
      dish.imageStatus = "ready";
      dish.imageSha256 = found.digest;
      dish.imageCredit = {
        title: found.source.title,
        creator: found.source.creator,
        creator_url: found.source.creator_url,
        license: found.source.license,
        license_version: found.source.license_version,
        license_url: found.source.license_url,
        source_url: found.source.source_url,
        provider: found.source.provider,
        attribution: found.source.attribution
      };
      manifest.entries = (manifest.entries || []).filter(entry => String(entry.id) !== String(dish.id));
      manifest.entries.push({
        id: dish.id,
        name: dish.name,
        file: relativeFile,
        sha256: found.digest,
        match_score: found.score,
        openverse_id: found.source.id,
        title: found.source.title,
        creator: found.source.creator,
        creator_url: found.source.creator_url,
        license: found.source.license,
        license_version: found.source.license_version,
        license_url: found.source.license_url,
        source_url: found.source.source_url,
        image_url: found.source.image_url,
        provider: found.source.provider,
        attribution: found.source.attribution
      });
      generated++;
      console.log("[FOUND " + generated + "] " + dish.name + " -> " + relativeFile + " (" + found.source.license + ", match " + found.score.toFixed(2) + ")");
    } catch (error) {
      failed++;
      failures.push({ id: dish.id, name: dish.name, error: error.message });
      console.error("[ERROR] " + dish.name + ": " + error.message);
      if (/429|rate limit/i.test(error.message)) {
        console.error("Openverse rate limit reached; stop this batch and retry later.");
        break;
      }
    }
    await fs.writeFile(MENU_FILE, "window.MENU_ITEMS = " + JSON.stringify(items) + ";\nwindow.MENU_SUMMARY = " +
      JSON.stringify({
        ...summary,
        totalMenuEntries: items.length,
        uniqueLocalImages: items.filter(d => d.imageStatus === "ready").length,
        imagesPending: items.filter(d => d.imageStatus !== "ready").length,
        imageSource: "Openverse openly licensed photographs"
      }) + ";\n");
    manifest.version = 2;
    manifest.source = "Openverse";
    manifest.updatedAt = new Date().toISOString();
    await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
  }

  await fs.writeFile(MENU_FILE, "window.MENU_ITEMS = " + JSON.stringify(items) + ";\nwindow.MENU_SUMMARY = " +
    JSON.stringify({
      ...summary,
      totalMenuEntries: items.length,
      uniqueLocalImages: items.filter(d => d.imageStatus === "ready").length,
      imagesPending: items.filter(d => d.imageStatus !== "ready").length,
      imageSource: "Openverse openly licensed photographs"
    }) + ";\n");
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(ATTRIBUTION_FILE, attributionMarkdown(items));

  const ready = items.filter(d => d.imageStatus === "ready").length;
  const remaining = items.length - ready;
  const notFound = items.filter(d => d.imageStatus === "no-match").length;
  const report = [
    "## Free dish photo sourcing progress",
    "",
    "| Measure | Count |",
    "|---|---:|",
    "| Total menu entries | " + items.length + " |",
    "| Unique local image files | " + ready + " |",
    "| Still without a matched photo | " + remaining + " |",
    "| Marked no suitable result yet | " + notFound + " |",
    "| Downloaded this run | " + generated + " |",
    "| Search/download errors | " + failed + " |",
    "",
    "Source: Openverse. Allowed licences: CC0, PDM, CC BY and CC BY-SA. No paid image API is used.",
    ""
  ].join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  if (failures.length && generated === 0 && noMatch === 0) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
