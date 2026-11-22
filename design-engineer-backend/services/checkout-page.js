'use strict';
// Server-rendered checkout page opened from the Figma plugin, styled like the
// Design Engineer website. All dynamic values are escaped; the Razorpay options
// are embedded with safeScript so they cannot break out of the <script>.

const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700&display=swap';

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://checkout.razorpay.com",
  "connect-src 'self' https://api.razorpay.com https://*.razorpay.com",
  'img-src https: data:',
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'frame-src https://*.razorpay.com https://api.razorpay.com',
  "form-action 'self'",
  "base-uri 'none'",
].join('; ');

function escaped(value) {
  return String(value).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
}
function safeScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function rupees(paise) {
  const n = paise / 100;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}
function siteLink(path) {
  const base = String(process.env.WEBSITE_URL || '').replace(/\/+$/, '');
  return /^https:\/\/[^\s"'<>]+$/.test(base) ? base + path : null;
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;font-family:'Instrument Sans',Inter,system-ui,sans-serif;color:#17171C;background-color:#E9E9EE;background-image:radial-gradient(#C4C4CF 1px,transparent 1.2px);background-size:24px 24px;min-height:100vh}
a{color:#0A5FB4}
header{background:rgba(255,255,255,.94);border-bottom:1px solid #D6D6DE}
.bar{max-width:1040px;margin:0 auto;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:700;font-size:17px}
.logo{width:28px;height:28px;border-radius:8px;background:#17171C;display:flex;align-items:center;justify-content:center}
.secure{display:flex;align-items:center;gap:8px;font-size:14px;color:#4A4F68}
main{max-width:1040px;margin:0 auto;padding:28px 24px 56px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
.note{flex:1 1 100%;background:#FFD23F;color:#2A2100;border-radius:16px;padding:14px 18px;font-size:15px;display:flex;flex-wrap:wrap;gap:6px 14px}
.card{flex:999 1 520px;min-width:0;background:#fff;border:2px solid #17171C;border-radius:20px;box-shadow:10px 10px 0 #0D99FF;padding:32px}
.chip{display:inline-block;background:#ECE7FF;color:#3B2C8F;font-size:13px;font-weight:700;padding:5px 12px;border-radius:999px;margin:0 0 12px}
h1{margin:0;font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:800;font-size:clamp(32px,5vw,44px);line-height:1;letter-spacing:-.03em}
dl{margin:24px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
dl div{background:#F1F1F4;border-radius:12px;padding:14px 16px}
dt{font-size:13px;color:#4A4F68}dd{margin:4px 0 0;font-size:18px;font-weight:600}
.total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #E3E5EE;margin-top:24px;padding-top:20px}
.total strong{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:36px;font-weight:800}
.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:58px;margin-top:22px;border:0;border-radius:999px;background:#0D99FF;color:#04223D;font:inherit;font-size:18px;font-weight:700;cursor:pointer}
.btn.dark{background:#17171C;color:#fff;width:auto;padding:0 26px;min-height:52px;font-size:16px}
.btn:focus-visible,a:focus-visible{outline:3px solid #0D99FF;outline-offset:3px}
.btn[disabled]{opacity:.6;cursor:progress}
.small{margin:14px 0 0;font-size:14px;line-height:1.55;color:#4A4F68}
.state{display:flex;flex-direction:column;gap:16px;align-items:flex-start}
.state[hidden]{display:none}
.icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ok{background:#3CC995}.bad{background:#FCEBEC}.wait{background:#FFF4CC}
.spin{width:56px;height:56px;border-radius:50%;border:5px solid #DCEFFF;border-top-color:#0D99FF;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.ref{background:#F1F1F4;border-radius:12px;padding:12px 14px;font-size:14px;color:#4A4F68;width:100%}
.ref code{color:#17171C}
.state p{margin:0;font-size:17px;line-height:1.55;color:#33343D}
.inline-msg{margin:12px 0 0;font-size:15px;color:#8A2A12}
aside{flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:16px}
.side{border-radius:18px;padding:22px}
.side h2{margin:0 0 8px;font-size:17px}
.side ul{margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.7}
.side p{margin:0;font-size:14px;line-height:1.6}
.orange{background:#FF6B3D;color:#17171C}.lav{background:#B9A6FF;color:#17171C}
.legal{background:#fff;border-radius:14px;padding:14px 16px;font-size:13px;line-height:1.7;color:#45464F}
`;

const LOGO = '<span class="logo" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#FFD23F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4 1.5 8 5 12"/><path d="M11 4l3.5 4L11 12"/></svg></span>';
const LOCK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12936A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function shell(title, inner) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escaped(title) + ' — Design Engineer</title>' +
    '<link rel="stylesheet" href="' + FONTS + '"><style>' + STYLE + '</style></head><body>' +
    '<header><div class="bar"><span class="brand">' + LOGO + 'Design Engineer</span><span class="secure">' + LOCK + 'Secure checkout</span></div></header>' +
    inner + '</body></html>';
}

// A message page for invalid, expired or unavailable checkout links.
function renderNotice(title, message) {
  return shell(title, '<main><section class="card" aria-labelledby="t"><h1 id="t">' + escaped(title) + '</h1>' +
    '<p class="small" style="font-size:17px;color:#33343D">' + escaped(message) + '</p></section></main>');
}

function renderCheckout({ planName, buildMinutes, amount, currency, keyId, orderId, token }) {
  const price = currency === 'INR' ? rupees(amount) : escaped(currency) + ' ' + (amount / 100).toFixed(2);
  const minutes = Number.isInteger(buildMinutes) && buildMinutes > 0 ? buildMinutes : null;
  const terms = siteLink('/terms'), refunds = siteLink('/refunds'), contact = siteLink('/contact');
  const legal = terms && refunds
    ? 'By paying you agree to the <a href="' + escaped(terms) + '">Terms</a> and the <a href="' + escaped(refunds) + '">Refund policy</a>.' +
      (contact ? ' Need help? <a href="' + escaped(contact) + '">Contact us</a>.' : '')
    : 'By paying you agree to the Design Engineer terms and refund policy.';
  const options = {
    key: keyId, amount, currency, order_id: orderId, name: 'Design Engineer',
    description: planName + ' plan, ' + (minutes ? minutes + ' build minutes, ' : '') + '30 days',
    theme: { color: '#0D99FF' },
  };
  const inner =
    '<main>' +
    '<div class="note"><strong>Opened from your Figma plugin</strong><span>This page is private to you and the link expires 15 minutes after it opened.</span></div>' +
    '<section class="card" aria-labelledby="t">' +
      '<div class="state" id="s-ready">' +
        '<div><p class="chip">' + escaped(planName) + ' plan</p>' +
        '<h1 id="t">' + (minutes ? minutes + ' build minutes, ready in seconds.' : 'Your ' + escaped(planName) + ' plan, ready in seconds.') + '</h1></div>' +
        '<dl style="width:100%">' +
          (minutes ? '<div><dt>Build minutes</dt><dd>' + minutes + ' minutes</dd></div>' : '') +
          '<div><dt>Period</dt><dd>30 days</dd></div>' +
          '<div><dt>Renewal</dt><dd>Manual, no auto-debit</dd></div>' +
        '</dl>' +
        '<div class="total" style="width:100%"><span style="font-size:17px;font-weight:600">Total</span><strong>' + price + '</strong></div>' +
        '<button class="btn" id="pay" type="button">Pay ' + price + ' securely with Razorpay</button>' +
        '<p class="inline-msg" id="ready-msg" role="status"></p>' +
        '<p class="small">Razorpay\'s payment window opens on this page. UPI, cards, netbanking and wallets are accepted.</p>' +
      '</div>' +
      '<div class="state" id="s-verifying" hidden role="status"><div class="spin" aria-hidden="true"></div>' +
        '<h1>Verifying your payment…</h1><p>We\'re confirming the payment with Razorpay. Don\'t pay again or close this tab yet. It usually takes a few seconds.</p></div>' +
      '<div class="state" id="s-success" hidden role="status"><span class="icon ok" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#06301B" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg></span>' +
        '<h1>Payment verified</h1><p>Your ' + escaped(planName) + ' plan is active' + (minutes ? ' with ' + minutes + ' build minutes' : '') + '. Go back to Figma. Your balance updates on its own within a few seconds.</p>' +
        '<div class="ref">Payment reference <code id="ref-ok"></code>. Razorpay emails you a receipt.</div><p class="small">You can close this tab.</p></div>' +
      '<div class="state" id="s-pending" hidden role="alert"><span class="icon wait" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5A00" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>' +
        '<h1>Payment received, confirming</h1><p>Razorpay took the payment but we couldn\'t confirm it yet. Please don\'t pay again. Your minutes usually appear in Figma within a few minutes. If they don\'t, contact support with the reference below.</p>' +
        '<div class="ref">Payment reference <code id="ref-pending"></code></div></div>' +
      '<div class="state" id="s-failed" hidden role="alert"><span class="icon bad" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C8303C" stroke-width="2.5" stroke-linecap="round"><path d="M12 7v6"/><path d="M12 17h.01"/></svg></span>' +
        '<h1>Payment didn\'t go through</h1><p id="fail-msg">No money was taken for this attempt. If your bank shows a debit, Razorpay reverses it automatically.</p>' +
        '<button class="btn dark" id="retry" type="button">Try again</button></div>' +
    '</section>' +
    '<aside><div class="side orange"><h2>How build minutes work</h2><ul><li>Each build uses exactly the time it runs</li><li>Waiting in the queue is free</li><li>Renew early and unused minutes carry over</li></ul></div>' +
      '<div class="side lav"><h2>Your AI usage is separate</h2><p>Builds use the AI account you connected. That provider bills you directly.</p></div>' +
      '<p class="legal">' + legal + '</p></aside>' +
    '</main>' +
    '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>' +
    '<script>(function(){var cfg=' + safeScript(options) + ';var token=' + safeScript(token) + ';' +
    'var $=function(id){return document.getElementById(id)};' +
    'function show(name){["ready","verifying","success","pending","failed"].forEach(function(n){$("s-"+n).hidden=n!==name});var h=$("s-"+name).querySelector("h1");if(h){h.setAttribute("tabindex","-1");h.focus()}}' +
    'function open(){$("ready-msg").textContent="";if(!window.Razorpay){$("ready-msg").textContent="Checkout could not load. Check your connection and refresh this page.";return}' +
    'var rz=new Razorpay(Object.assign({},cfg,{modal:{ondismiss:function(){$("ready-msg").textContent="Payment window closed. Nothing was charged.";}},' +
    'handler:function(result){show("verifying");' +
    'fetch("/billing/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({},result,{token:token}))})' +
    '.then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})' +
    '.then(function(x){if(x.ok&&x.d&&x.d.success){$("ref-ok").textContent=result.razorpay_payment_id;show("success")}else{$("ref-pending").textContent=result.razorpay_payment_id;show("pending")}})' +
    '.catch(function(){$("ref-pending").textContent=result.razorpay_payment_id;show("pending")});}}));' +
    'rz.on("payment.failed",function(r){var m=r&&r.error&&r.error.description;if(m)$("fail-msg").textContent=m+" No money was taken for this attempt.";show("failed")});rz.open()}' +
    '$("pay").addEventListener("click",open);$("retry").addEventListener("click",function(){show("ready");open()});})();</script>';
  return shell('Checkout', inner);
}


function renderSubscriptionCheckout({subscriptionId,token,keyId,planName,priceInr,buildMinutes}){
 const terms=siteLink('/terms'),refunds=siteLink('/refunds');
 const legal=terms&&refunds ? '<p class="small">Read our <a href="'+escaped(terms)+'">Terms</a> and <a href="'+escaped(refunds)+'">Cancellation and refund policy</a> before authorizing recurring payments.</p>' : '<p class="small">Review the Design Engineer terms and cancellation/refund policy before authorizing recurring payments.</p>';
 const options={key:keyId,subscription_id:subscriptionId,name:'Design Engineer',
   description:planName+' monthly membership · automatic renewal',theme:{color:'#0D99FF'}};
 const body='<main><section class="card"><p class="chip">'+escaped(planName)+' · monthly AutoPay</p>'+
 '<h1>Authorize automatic renewal</h1>'+
 '<p class="small">'+escaped(buildMinutes)+' build minutes per paid period. Monthly price: ₹'+
 escaped(priceInr.toLocaleString('en-IN'))+
 '. Your card or eligible UPI mandate is charged each month after authorization. You can cancel future renewal in Figma. If you cancel, paid benefits remain until the end of the paid period.</p>'+
 legal+
 '<button id="pay" class="btn" type="button">Authorize monthly AutoPay with Razorpay</button>'+
 '<p class="inline-msg" id="status" role="status"></p>'+
 '<p class="small">You will not receive paid minutes until Razorpay confirms a successful captured plan charge. Supported recurring payment methods depend on your bank and Razorpay account settings.</p></section></main>'+
 '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>'+
 '<script>(function(){var cfg='+safeScript(options)+';var token='+safeScript(token)+
 ';var label=document.getElementById("status");document.getElementById("pay").onclick=function(){'+
 'if(!window.Razorpay){label.textContent="Payment gateway unavailable.";return}'+
 'var rz=new Razorpay(Object.assign({},cfg,{handler:function(result){'+
 'label.textContent="Verifying mandate authorization…";'+
 'fetch("/billing/subscription/confirm",{method:"POST",headers:{"Content-Type":"application/json"},'+
 'body:JSON.stringify(Object.assign({},result,{token:token}))})'+
 '.then(function(r){if(!r.ok)throw Error();return r.json()})'+
 '.then(function(info){label.textContent=info.pendingActivation?"Mandate authorized. Your plan activates after the first captured payment. Return to Figma and refresh Plans.":"Your subscription is active. Return to Figma to see your paid minutes."})'+
 '.catch(function(){label.textContent="Authorization could not be verified. Check your plan in Figma before retrying."})'+
 '},modal:{ondismiss:function(){label.textContent="Authorization window closed. Check your subscription status in Figma before trying again."}}}));'+
 'rz.on("payment.failed",function(){label.textContent="Payment authorization failed. Please retry."});rz.open()'+
 '};})();</script>';
 return shell('Subscription authorization',body);
}
module.exports = { renderCheckout, renderSubscriptionCheckout, renderNotice, CHECKOUT_CSP: CSP, escaped, safeScript };
