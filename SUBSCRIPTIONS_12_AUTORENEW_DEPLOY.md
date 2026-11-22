# Deployment 12 — Razorpay monthly subscriptions and upgrade rules

> This is an ADDITIVE release for existing Cloudflare + Supabase Deployment 06/09.
> Do not replace your database or run schema.sql on an existing database.
> Do not switch to live Razorpay until test mandates, webhooks and refunds pass.

## Product behavior

- Free: **Upgrade your plan** shows Plus and Studio.
- Plus: **Upgrade to Studio**; Plus cannot be purchased a second time.
- Studio: highest tier; no new upgrade/checkout offered.
- Active periods show their actual end date and, when AutoPay is enabled, next renewal date.
- Users cancel **automatic renewal** in Figma, with a confirmation step.
- Cancellation stops subsequent mandates; the already-paid entitlement remains until expiry.
- If the paid period ends without a captured renewal, \`minute_balance\` serves Free, and
  the new expiry RPC marks the old database membership expired without deleting history.
- Existing one-time Orders purchases remain prepaid and **do not silently become mandates**.
  A user must explicitly authorize a new monthly subscription to enable AutoPay.
- Razorpay authorization does **not** grant paid minutes. Only captured \`subscription.charged\`
  events verified against the provider and processed by an idempotent SQL transaction grant them.

## 1. Database migration (required BEFORE backend deployment)

With your current Supabase project backed up, in SQL Editor run once:

\`design-engineer-backend/supabase/012_recurring_subscriptions.sql\`

This requires all previous migrations up to \`011_flow_revamp.sql\`. It creates
\`recurring_subscriptions\`, \`expire_paid_membership\` and
\`apply_recurring_charge\`. The table is service-role-only (RLS enabled).
Never delete the existing \`payments\`, \`minute_wallets\` or \`user_subscriptions\`.

## 2. Razorpay test-mode dashboard

Enable Razorpay Subscriptions and recurring card payments; request activation of
**UPI AutoPay** if it is not offered. Availability depends on Razorpay, the UPI app,
the payer's bank and mandate limits. Create *two monthly plans*, interval=1:

| Plan | Charge each month | Environment key |
|---|---:|---|
| Plus | ₹799 | RAZORPAY_PLUS_PLAN_ID |
| Studio | ₹1,699 | RAZORPAY_STUDIO_PLAN_ID |

Their price/currency/frequency must match Supabase \`plans\`.
If your prices have changed, create plans with those actual amounts instead.
Razorpay's subscription API uses a finite \`total_count\`; this integration sets
120 cycles (ten years), not an unlimited lifetime mandate.

Both plan IDs MUST belong to the same Razorpay test/live account as its matching
\`RAZORPAY_KEY_ID\` and \`RAZORPAY_KEY_SECRET\`. Create separate Razorpay plans in
live mode before switching modes.

## 3. Cloudflare Worker secrets and redeploy

Set the following Cloudflare Worker secrets, using \`wrangler secret put <NAME>\`
inside \`cloudflare/\` (do NOT put values in GitHub, plugin or this document):

\`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\`, \`RAZORPAY_WEBHOOK_SECRET\`,
\`RAZORPAY_PLUS_PLAN_ID\`, \`RAZORPAY_STUDIO_PLAN_ID\`.

The Worker now forwards both additional plan IDs to its backend container.
Keep all existing Supabase, GitHub and gateway secrets unchanged.

From \`cloudflare/\`:
\`\`\`powershell
npm install
npm run check:deploy
npm run deploy
\`\`\`

Add or update the Razorpay webhook URL:
\`https://YOUR-WORKER.workers.dev/billing/webhook\`.

Subscribe to the events:
\`payment.captured\`, \`payment.refunded\`,
\`subscription.authenticated\`, \`subscription.activated\`,
\`subscription.charged\`, \`subscription.pending\`,
\`subscription.halted\`, \`subscription.cancelled\`,
\`subscription.completed\`.

The webhook secret is separate from the API key secret. Test and live accounts
need their own webhook secret and webhook setup.

## 4. Rebuild Figma plugin and website

From \`design-engineer-plugin/\`:
\`\`\`powershell
npm ci
$env:DESIGN_ENGINEER_API_URL="https://YOUR-WORKER.workers.dev"
npm run build
\`\`\`
Reload the local Figma manifest after building. Rebuild/deploy \`website/\` if it
is currently hosted separately; updating the Cloudflare backend does not redeploy
the static marketing/terms/refund pages.

## 5. Required test-mode acceptance checks

1. Free account → Upgrade your plan → Plus or Studio.
2. Plus → Upgrade to Studio, with exactly one new mandate and old mandate
   scheduled to stop, with no simultaneous active renewals after upgrade.
3. Studio → cannot initiate any new upgrade or open a stale checkout link.
4. Mandate authentication only → no paid minutes until a verified captured charge.
5. Test first and second \`subscription.charged\` events → one minute grant each.
6. Replay a webhook with same and different event IDs → no duplicate grant.
7. Simulate failed subscription charge → no minutes granted; UI shows status.
8. Cancel auto-renew → no new charges, paid benefits continue until displayed
   expiry, then Free with expiry notice.
9. Cancel pending authorization → no mandate should remain active.
10. Full refund → payment/entitlement reversal follows the existing atomic refund RPC.
11. Validate **card** and **UPI AutoPay** using available test methods, and confirm
    your Razorpay account has each recurring payment method enabled.
12. Test a pre-existing one-time Plus/Studio customer: no accidental automatic
    debit and no duplicate checkout.

## Launch gate

Automated CI uses mock payment-provider responses. It cannot confirm that
Razorpay Subscriptions / UPI AutoPay are enabled for your account, that live
webhooks are reaching your deployed Worker, or that a real charge can be
reconciled in Supabase. Test all twelve cases in test mode before enabling
production credentials. Review the updated website Terms and Cancellation/
Refunds content for your business and regulatory requirements before publishing.
