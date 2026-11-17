# Design Engineer website

Static site built from the Design canvas ("Design Engineer — website, policies
& checkout"): landing page, About, Contact, Terms, Privacy, Cancellation &
refunds, Delivery, plus a 404 page. No framework and no dependencies; the only
script is `src/assets/site.js` (story player, build-receipt timer, contact form).

## 1. Fill in your details

Edit `site.config.json`. Every value still in `[BRACKETS]` shows on the site as
a placeholder:

| Key | Used on |
| --- | --- |
| `SITE_URL` | canonical links, sitemap (your domain, e.g. `https://designengineer.in`) |
| `PLUGIN_URL` | "Install the plugin" and "Choose Plus/Studio" buttons (Figma Community link) |
| `SUPPORT_EMAIL`, `PHONE`, `STREET_ADDRESS`, `PIN_CODE`, `POSTAL_ADDRESS`, `GRIEVANCE_EMAIL` | Contact, About, Terms, Privacy, Refunds, Delivery |
| `GST_NOTE` | after "Prices include applicable taxes" on Pricing and Terms; set to `""` once confirmed |
| `REFUND_LIMITS_NOTE` | Refunds page; set to `""` once the 7-day / 10-minute rule is confirmed |
| `DATA_REGION_NOTE` | Privacy page, e.g. `"Our database is hosted in Mumbai (ap-south-1)."` |

## 2. Build and preview

```bash
cd website
npm run build      # writes dist/ (warns about remaining placeholders)
npm run preview    # http://localhost:4321
```

## 3. Deploy to Cloudflare Pages

Your backend already runs on Cloudflare, so the site can live in the same
account:

```bash
cd website
npx wrangler login            # once
npm run deploy                # refuses to deploy while any [PLACEHOLDER] remains
```

That creates a Pages project called `design-engineer-site`. Then in the
Cloudflare dashboard: **Workers & Pages → design-engineer-site → Custom
domains → Set up a domain**.

Pages serves `about.html` at `/about`, uses `404.html` for missing pages, and
applies `_headers` (security headers, CSP) and `_redirects` (`/pricing`,
`/refund`, `/shipping`).

## 4. Point the backend at the site

Set `WEBSITE_URL` (e.g. `https://designengineer.in`) on the backend so the
checkout page links to your Terms, Refund policy and Contact pages.

## 5. Razorpay website review

Give Razorpay these links: `/about`, `/contact`, `/#pricing` (or `/pricing`),
`/terms`, `/privacy`, `/refunds`, `/delivery`.

## Changing the design

The canvas is the source of truth. After editing it, regenerate `src/` from
the canvas files (the conversion keeps `site.js`, the config tokens and the
Pages files) and run `npm run build` again.
