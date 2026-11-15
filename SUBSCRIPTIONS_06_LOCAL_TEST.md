# Design Engineer Deployment 06 — minute subscriptions + Razorpay

**Branch:** `design-engineer-subscriptions-minutes-razorpay-06` created from
`design-engineer-cloudflare-deployment-05`. The deployed branch is not modified.

## Plan and allowance settings — stored in Supabase, NOT hardcoded in the plugin

| Plan slug | Default allowance | Default price | Renewal |
| --- | --- | --- | --- |
| free | 40 minutes, once per account | ₹0 | Lifetime trial |
| plus | 100 minutes | ₹799 | 30 days, manual payment |
| studio | 200 minutes | ₹1,699 | 30 days, manual payment |

Defaults are seeded by migration 008. All amounts are example prices that you
can change in Supabase. The Figma dashboard and server fetch them each time
rather than keeping separate values in code.

**Change plan values (SQL Editor)**:

```sql
update public.plans set build_minutes=120, price_inr=999 where slug='plus';
update public.plans set build_minutes=240, price_inr=1899 where slug='studio';
select slug,build_minutes,price_inr,currency from public.plans
where slug in ('free','plus','studio') order by sort_order;
```

The same `build_minutes` column controls the UI balance and the server-side
admission rules. Balance refreshes in Figma approximately every 5 seconds.
Active job reservations are calculated separately from actual seconds already
consumed. Changing a plan's allowance during a running job also affects
metering's exhaustion check.

**Billing measurement:** a build is billed for elapsed *job execution seconds*
after a dedicated Container starts, not number of screens or time in the Queue.
An implementation reserves up to 15 minutes initially and gets charged only
for actual elapsed time, with unused reservation released after completion.
When time runs out, the job is stopped and marked failed. The agent itself
might have separate provider usage charges (BYOK). The shared API Container
and OAuth requests do not consume user implementation minutes.

## 1. Supabase setup — staging project first

After base `schema.sql` and Deployment 05's `007_implementation_jobs.sql`,
run:

`design-engineer-backend/supabase/008_minute_billing.sql`

For a new clean project, `design-engineer-backend/supabase/schema.sql`
contains the full merged base schema + 007 + 008. Existing projects should
run **008 only**, to preserve their existing data.

The migration adds `plans.build_minutes`, `minute_wallets` and
`minute_reservations`, plus transactional stored functions to reserve,
meter and settle seconds. It locks down the existing payments and subscription
tables: only backend service-role credentials may create or alter entitlements.

**Never** enable client-side update permissions on `user_subscriptions`,
`payments`, `minute_wallets` or `minute_reservations`. Minute balances
cannot be set by Figma requests.

## 2. Razorpay test-mode setup

Create **Razorpay Test Mode** credentials at https://dashboard.razorpay.com/.
Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a newly chosen
`RAZORPAY_WEBHOOK_SECRET` (independent of the key secret) in your local
`design-engineer-backend/.env`. Never commit keys.

The backend supports:
- Server-side order creation in INR, using the amount from `plans.price_inr`.
- Short-lived checkout links and Razorpay Standard Checkout in an external tab.
- Server-side HMAC-SHA256 checkout signature verification.
- Payment API verification for the correct order, exact amount, currency and
  `captured` status.
- A webhook at `https://YOUR-BACKEND/billing/webhook`, using the raw payload
  and the separate webhook secret. Subscribe to `payment.captured` and
  `payment.refunded` events.
- Idempotent payment-grant stored function to avoid duplicate credit grants
  from checkout callback + webhook delivery.

From the repository root:

```powershell
git fetch origin
git switch design-engineer-subscriptions-minutes-razorpay-06
git pull origin design-engineer-subscriptions-minutes-razorpay-06

cd design-engineer-backend
npm ci
# Localhost-only testing: override the Cloudflare gateway secret for this
# PowerShell process, without editing the .env used for cloud deployment.
$env:GATEWAY_SHARED_SECRET=""
$env:BACKEND_URL="http://localhost:4000"
npm start
```

Then, in another terminal:

```powershell
cd design-engineer-plugin
$env:DESIGN_ENGINEER_API_URL="http://localhost:4000"
npm ci
npm run build
```

Reimport/reload the *development* Figma plugin using `manifest.json`.
Test sign-in, open Account → Plans & minutes and see Free 40 minutes.
Use Razorpay test cards/UPI in the opened browser page to purchase Plus/Studio.
Payment status and minutes should change within 5 seconds after verification.
For webhook tests against localhost, expose a **temporary HTTPS testing URL**
using a secure development tunnel and point the Razorpay test webhook to that
URL; `localhost` alone cannot receive Razorpay's external webhooks.

**Local limitation:** the Cloudflare Queue and per-job Container orchestration
are Cloudflare services; they are not replicated by merely starting
`node server.js`. The production implementation path is protected by Worker
job dispatch. For a complete metered coding-job end-to-end test, deploy this
branch to a separate Cloudflare staging Worker and Supabase project first.

## 3. Cloudflare staging deployment (never overwrite Deployment 05)

Create a **new staging Worker name and staging queue names** in a separate
Wrangler environment before deploying this branch. The checked-in
`cloudflare/wrangler.jsonc` still uses the Deployment 05 production name,
so **do not run `npm run deploy` against the existing Cloudflare account
from this branch until you've explicitly created a staging configuration**.

If you later decide to promote this branch, run `008_minute_billing.sql` in
the target Supabase project, then upload the three Razorpay Worker secrets:

```powershell
cd cloudflare
$env:CLOUDFLARE_ACCOUNT_ID="YOUR_ACCOUNT_ID"
.\scripts\upload-secrets.ps1
```

The script uploads existing eight backend secrets as well as optional Razorpay
values when present. It never prints secret values. The Worker passes payment
keys only to the backend Containers, never to the Figma plugin.

Use a different webhook URL and webhook secret for Razorpay **test vs live**.
To go live, replace the full set of test keys with live values in Cloudflare
and enable webhook events for the live Razorpay account. Never mix test and
live keys in one runtime. Payment provider onboarding, tax configuration,
settlement and Razorpay account approval are external steps.

## 4. Billing security and behavior

- **Free**: 40 minutes total per Supabase user, not monthly.
- **Paid**: full 30-day prepaid period purchased with Razorpay; unused minutes
  do not roll over. Renewal requires another explicit payment; this branch
  does **not** set up automatic recurring Razorpay Subscriptions or mandates.
- Plan prices, names, enabled state and allowances come from the DB. Change
  them there; only seed defaults are in the migration.
- Multiple concurrent jobs are allocated time atomically and cannot
  overspend their last available seconds. A job can reserve up to 15 minutes
  and is charged by actual elapsed wall-clock execution seconds.
- Payment amounts are always calculated server-side from Supabase plan data.
  A plugin cannot grant itself minutes or mark an unpaid order paid.
- Subscription management is **individual user-level**, not pooled team
  minutes. Razorpay payments use INR.
- Refunds can deactivate a current paid entitlement after a verified full
  refund; support/finance must reconcile chargebacks and disputes manually.
- Because billing, payment-provider eligibility, and runtime cost are
  consequential, test all flows with Razorpay Test Mode and disposable
  GitHub repositories before any public release.

## 5. Manual test checklist

1. Create a new user; check 40 free minutes and no payment required.
2. Change free `build_minutes` to 41 in Supabase, refresh; UI and API
   must show 41 without a code rebuild. Restore to 40 afterward.
3. Start a staging Cloudflare job; verify live seconds decrease in
   Supabase/Figma and the reservation releases on completion.
4. Start two jobs together; verify reserved seconds prevent double-spending.
5. Set a plan's allowance below a running job's used seconds; verify
   the metering process stops the job.
6. Exhaust minutes; verify new implementation is denied with HTTP 402 and
   navigates to Plans & minutes.
7. Pay in Razorpay Test Mode; verify exactly one 30-day entitlement is granted.
8. Deliver the test webhook twice; verify no extra minutes are granted.
9. Change Plus/Studio prices in Supabase; verify checkout charges the
   new DB-derived amount (in paise), not a client-provided amount.
10. Confirm 30-day expiry falls back to the user's remaining lifetime free
    allowance. Do not publish while any of these fail.

## Official references

- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
- https://razorpay.com/docs/webhooks/
- https://developers.cloudflare.com/containers/
