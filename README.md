# Saffron & Stone 🍽️

A modern, light-theme restaurant and premium café ordering experience with a large multi-cuisine menu, a veg/non-veg filter, a shopping bag and Olive, an AI food guide.

## Menu

The catalogue is generated from the supplied master menu and includes more than 1,000 food and drink entries across 32 collections, organised into 17 browseable top-level categories:

- North Indian, paneer specialities, breads, South Indian, regional Indian, street food, kebabs, biryani and rice
- Chinese and Indo-Chinese, dim sum, Japanese, sushi, Korean and Thai
- Italian, Mexican, burgers, sandwiches, wraps and subs
- Breakfast, brunch, soups, snacks, salads and healthy bowls
- Seafood, kids' menu, combos, platters and meal deals
- Desserts, cakes, pastries, bakery, cookies, ice cream and frozen treats
- Coffee, tea, cold coffee, frappes, milkshakes, mocktails, juices, lassi, coolers and specialty drinks
- Extras and add-ons for pizza, burgers, pasta, drinks, sides and dips

The optional alcohol bar menu from the source list is not included. Dish photos use a varied image pool selected by dish name and menu section; the collection is illustrative, not 1,089 individually licensed photos.

## Features

- Explore Menu opens a category picker; selecting a category jumps to that collection's dishes
- Dish-aware food photography with multiple image choices matched by dish type
- Full menu search and incremental show-more loading
- **All / Veg / Non-veg / Check with kitchen** dietary filter. Items whose names do not establish their ingredients are kept out of the Veg and Non-veg filters until the kitchen confirms them.
- Shopping bag with quantity controls, subtotal, delivery fee and free-delivery threshold
- Demo checkout with UPI / QR and cash-on-delivery choices
- Olive, a multi-turn AI assistant for food details and recommendations
- Responsive light theme with hover states and animated section reveals
- Vanilla HTML, CSS and JavaScript for the frontend

## Run locally

Open index.html in a browser, or run:

    python -m http.server 8000

Then visit http://localhost:8000.

The AI chat endpoint runs as a Vercel serverless function under /api/chat. To test chat locally, use the Vercel CLI and configure GEMINI_API_KEY in your local environment.

## Connect Olive to Gemini

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. In the Vercel project for this repository, open **Settings → Environment Variables**.
3. Add **GEMINI_API_KEY** with the API key value. Keep it server-side; never put it in index.html or menu-data.js.
4. Add it to the Production environment (and Preview if you want preview deployments to use the bot), save, then redeploy.
5. The browser on GitHub Pages calls the Vercel chat function at **https://restaurant-website.vercel.app/api/chat**. If your Vercel production domain is different, set window.RESTAURANT_CHAT_ENDPOINT in the page to https://YOUR-VERCEL-DOMAIN/api/chat.

The API uses gemini-3.5-flash-lite by default. You can override it with the Vercel environment variable GEMINI_MODEL.

Olive can explain common food styles and suggest listed menu items. Exact recipes, allergens, cross-contamination and kitchen availability are not stored in this sample catalogue, so the bot is instructed not to guess.

## Payments and ordering: demo status

UPI / QR and cash-on-delivery are checkout choices in this prototype. The site does not create a real restaurant order, generate a payment QR, launch a UPI intent, collect money or send notifications. Live payments need a verified merchant UPI ID or payment gateway plus server-side payment verification. Real order fulfilment needs a database, order API and restaurant/admin dashboard.

**Sample prices:** the master menu attachment contained dish names and categories, not confirmed restaurant prices. Newly generated catalogue prices are illustrative placeholders and must be reviewed before accepting real orders.

## Deployment

GitHub Pages can publish the static frontend. The api/chat.js serverless function and Gemini integration run on Vercel; a static GitHub Pages host cannot execute that API route. The configured Vercel chat endpoint is therefore used by the GitHub Pages frontend.

## Files

    .
    ├── index.html
    ├── menu-data.js
    ├── README.md
    └── api/
        └── chat.js

## Before going live

Replace the sample restaurant identity, address, hours, menu prices and food photography with approved business details. Verify every dietary label and allergen detail with the kitchen. Items marked Check with kitchen are intentionally not included in either Veg or Non-veg results until confirmed. Configure a real payment provider and order-management backend before accepting customer orders.
## Generate one unique photo for every menu entry

The repository includes a resumable GitHub Actions image generator. It creates one separate, dish-specific image file for each menu entry (including add-ons), checks image file hashes so identical files are not reused, updates the menu data with the local image path, and commits completed assets directly to `main`.

### One-time setup

1. Create a secret API key at [Pollinations](https://enter.pollinations.ai/). The current image-generation API requires an authenticated secret key; image calls spend from the account/key budget. Set a spending cap that you are comfortable with and restrict the key to the image model if possible.
2. In this GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**.
3. Name the secret `POLLINATIONS_API_KEY` and paste the key value there. Do not paste it into chat, the website, or a committed file.

### Generate the images

1. Open the repository's **Actions** tab.
2. Choose **Generate unique dish photos**.
3. Click **Run workflow** on `main`. Leave the limit at `0` to generate all remaining images, or enter a smaller number to do a batch.
4. The workflow saves each image under `assets/dishes/`, updates `menu-data.js`, and commits completed batches to `main`. Rerun the workflow to resume; existing local images are skipped.

The default model is FLUX.1 Schnell at 640 × 480, then images are resized and compressed to JPEG (quality 78) before they are committed. The workflow uses a unique prompt and seed for each item and rejects identical image files. AI image generation is not guaranteed to reproduce every recipe perfectly, so review the resulting menu photos before using them commercially. Generated assets are AI-created and should be reviewed for accuracy.

**Cost note:** 1,089 separate images require 1,089 generation calls. The total charge depends on the live model price and your Pollinations account. The workflow does not run until you manually trigger it with your secret configured. It commits each completed batch to `main` and triggers the GitHub Pages deployment. It will stop if the provider rejects requests because of an exhausted budget or key permissions.

## Free dish image sourcing (no paid API)

The repository uses the Openverse public API to search for openly licensed photographs. Openverse permits anonymous API access, subject to rate limits. The downloader filters to CC0, Public Domain Mark, CC BY and CC BY-SA photographs, and searches by the exact menu-item name. It downloads unique images, records the creator/source/licence, and stores the credit list at `assets/dishes/ATTRIBUTION.md`.

### Run an image batch

1. Open **Actions → Source free dish photos**.
2. Select the `main` branch and run the workflow. The default batch is 25 dishes.
3. Open the run's **Summary** tab to see how many images were found, how many still need images, and how many had no suitable result.
4. Repeat batches to process the remaining dishes. To retry dishes previously marked with no matching result, choose the `retry_no_match` option.

No API key or payment is required. Openverse rate limits still apply. Some rare or very specific dishes may not have an accurately matched, openly licensed photograph; those are left on a neutral placeholder rather than assigned an unrelated food image. Review every photo and its licence before commercial use. Openverse itself cautions that licence metadata may not always be accurate.

The former paid Pollinations image-generation workflow has been removed. The 125 already-created local AI images are preserved; the remaining menu entries are now handled by the free Openverse workflow.


## Image progress and no-match dishes

The **Source free dish photos** GitHub Actions run has a **Summary** tab with the exact live counts:
- Unique local images ready
- Total catalogue entries still without a matched image
- Not searched yet
- Searched, no suitable openly licensed photo found
- Visible menu entries after hiding no-match dishes

Dishes marked `no-match` are hidden from the customer-facing category picker, menu results and Olive recommendations. Their records remain in `menu-data.js` with their IDs and `no-match` status, so they can be retried later by enabling the workflow's `retry_no_match` option. When a matching photo is found, the dish automatically returns to the visible menu.
