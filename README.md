# Saffron & Stone 🍽️

A modern, light-theme restaurant and premium café ordering experience. Browse a multi-cuisine menu, build a bag, choose UPI or cash on delivery in the demo checkout, and ask Olive for food recommendations.

## What's inside

- **Indian:** paneer tikka, butter chicken, biryani, dal makhani, masala dosa and chole bhature
- **Chinese:** chilli paneer, Hakka noodles, Schezwan rice, chicken Manchurian and dim sum
- **Italian:** Margherita and truffle mushroom pizza, arrabbiata and Alfredo pasta
- **Sushi & Japanese:** avocado cucumber rolls, salmon nigiri, prawn tempura rolls and edamame
- **Café favourites:** avocado toast, Spanish latte, iced matcha and croissants
- **Desserts & drinks:** Biscoff cheesecake, chocolate mousse, filter-coffee tiramisu, lemonade and smoothies

## Features

- Responsive light-theme storefront with animated reveals and menu-card interactions
- Cuisine/category filters generated from the menu data
- Shopping bag with quantity controls, subtotal, delivery fee and free-delivery threshold
- Checkout form with **UPI / QR** and **Cash on delivery** choices
- Olive food guide with recommendations by cuisine, dietary preference, craving and budget
- Keyboard- and mobile-friendly browser experience
- Vanilla HTML, CSS and JavaScript. No frontend build system required.

## Run locally

Open index.html in a browser, or run:

    python -m http.server 8000

Then visit http://localhost:8000.

## Payments and ordering: demo status

The UPI and cash-on-delivery options are currently **UI/demo choices only**. This prototype does not create a real restaurant order, send an order notification, generate a payment QR, open a UPI payment intent, or collect money.

To accept real UPI payments, configure the restaurant's verified merchant UPI ID or integrate a payment provider (for example, Razorpay or Cashfree) through a secure backend. Verify payment status server-side before marking an order paid. Do not put payment secrets in frontend JavaScript.

For real order fulfilment, add a backend API, database, restaurant/admin order dashboard, delivery-zone validation and customer notifications. Olive currently uses local menu-matching rules, not a hosted AI model. A production AI assistant should call a server-side endpoint and only recommend items actually present and available in the menu.

## Deployment

This is a static frontend. GitHub Pages can publish the repository root directly. In Settings → Pages, select Deploy from a branch, choose main and /(root). The Vercel project connected to this repository can also build the root static site.

## Project structure

    .
    ├── index.html
    ├── README.md
    └── Restaurant.zip   # Original uploaded project archive

## Before going live

Replace the sample restaurant name, address, hours, menu, prices and food photography with approved business details. Configure the merchant's verified UPI/payment gateway and a real backend before accepting customer orders.