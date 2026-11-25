# Saffron & Stone 🍽️

A polished restaurant ordering website concept for a modern Indian kitchen. Browse the menu, add dishes to your bag, review totals, and ask Olive, the built-in food guide, for recommendations.

## Features

- Responsive light-theme restaurant website with animated section reveals and hover states
- Filterable menu across mains, small plates, desserts and drinks
- Shopping bag with quantity controls, subtotal, delivery fee and free delivery threshold
- Demo checkout form with customer and delivery details
- Olive food guide with local, rule-based menu recommendations
- Vanilla HTML, CSS and JavaScript. No build system required

## Run locally

Open `index.html` in a browser, or run:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deployment

This is a static website. GitHub Pages can publish the repository root directly. In **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/(root)`.

## Important demo limitations

This is a front-end prototype. Checkout currently shows a demo confirmation only. It does not save orders, send them to a restaurant, process payments, calculate real delivery availability, or connect to a live chatbot/AI model. The Olive assistant uses simple local rules to recommend items from the menu. For production ordering, connect a secure backend, database, payment provider and an AI service through server-side APIs. Never expose API keys in browser code.

## Project structure

```
.
├── index.html
└── README.md
```

## Customise before launch

Replace the sample restaurant identity, address, hours, prices, menu and Unsplash food photography with the real restaurant details.