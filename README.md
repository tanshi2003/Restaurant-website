# Saffron & Stone 🍽️

A modern, light-theme restaurant and premium café ordering experience with a large multi-cuisine menu, a veg/non-veg filter, a shopping bag and Olive, an AI food guide.

## Menu

The catalogue is generated from the supplied master menu and includes more than 1,000 food and drink entries across 32 collections:

- North Indian, paneer specialities, breads, South Indian, regional Indian, street food, kebabs, biryani and rice
- Chinese and Indo-Chinese, dim sum, Japanese, sushi, Korean and Thai
- Italian, Mexican, burgers, sandwiches, wraps and subs
- Breakfast, brunch, soups, snacks, salads and healthy bowls
- Seafood, kids' menu, combos, platters and meal deals
- Desserts, cakes, pastries, bakery, cookies, ice cream and frozen treats
- Coffee, tea, cold coffee, frappes, milkshakes, mocktails, juices, lassi, coolers and specialty drinks
- Extras and add-ons for pizza, burgers, pasta, drinks, sides and dips

The optional alcohol bar menu from the source list is not included.

## Features

- Cuisine/category browsing, full menu search and incremental show-more loading
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