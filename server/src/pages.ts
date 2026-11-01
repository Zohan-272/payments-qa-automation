/** Minimal server-rendered pages for the UI tests. Intentionally plain HTML + a little JS. */
const layout = (title: string, body: string, script = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px}
label{display:block;margin-top:12px;font-size:14px} input{width:100%;padding:8px;box-sizing:border-box}
button{margin-top:16px;padding:10px 16px;cursor:pointer} .error{color:#b00020;margin-top:12px} .ok{color:#0a7a2f;margin-top:12px}
.row{display:flex;gap:12px} .row>div{flex:1}
</style></head><body>${body}<script>${script}</script></body></html>`;

export const checkoutPage = () =>
  layout(
    'Demo checkout',
    `<h1>Demo checkout</h1>
<p>Demo T-shirt: <strong id="price">$20.00</strong> (mock payments, no real money)</p>
<form id="checkout-form" novalidate>
  <label>Card number<input id="card-number" name="card-number" autocomplete="off" placeholder="4242 4242 4242 4242"></label>
  <div class="row">
    <div><label>Expiry (MM/YY)<input id="card-expiry" name="card-expiry" autocomplete="off" placeholder="12/34"></label></div>
    <div><label>CVC<input id="card-cvc" name="card-cvc" autocomplete="off" placeholder="123"></label></div>
  </div>
  <button type="submit" id="pay-button">Pay $20.00</button>
</form>
<div id="message" role="alert"></div>`,
    `
const form = document.getElementById('checkout-form');
const message = document.getElementById('message');
function show(text, cls) { message.textContent = text; message.className = cls; }
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const number = document.getElementById('card-number').value.replace(/\\s+/g, '');
  const expiry = document.getElementById('card-expiry').value.trim();
  const cvc = document.getElementById('card-cvc').value.trim();
  if (!number) return show('Enter a card number.', 'error');
  const m = /^(\\d{2})\\/(\\d{2})$/.exec(expiry);
  if (!m) return show('Enter the expiry as MM/YY.', 'error');
  if (!/^\\d{3,4}$/.test(cvc)) return show('Enter a valid CVC.', 'error');
  show('Processing...', '');
  const orderId = 'order_' + Math.random().toString(36).slice(2, 10);
  const res = await fetch('/merchant/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, amount: 2000, currency: 'usd',
      card: { number, exp_month: Number(m[1]), exp_year: 2000 + Number(m[2]), cvc } }),
  });
  const body = await res.json();
  if (!res.ok) return show(body.error.message, 'error');
  if (body.status === 'requires_action') { window.location.href = body.next_action.redirect_to_url.url + '?order=' + orderId; return; }
  window.location.href = '/checkout/result?payment_intent=' + body.id + '&order=' + orderId;
});`,
  );

export const threeDsPage = (id: string) =>
  layout(
    '3-D Secure',
    `<h1>Bank authentication</h1>
<p>Simulated 3-D Secure challenge for <code id="intent-id">${id}</code>.</p>
<button id="complete-auth">Complete authentication</button>
<button id="fail-auth">Fail authentication</button>`,
    `
const params = new URLSearchParams(location.search);
async function finish(result) {
  await fetch('/merchant/api/3ds/${id}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result }) });
  window.location.href = '/checkout/result?payment_intent=${id}&order=' + (params.get('order') || '');
}
document.getElementById('complete-auth').onclick = () => finish('success');
document.getElementById('fail-auth').onclick = () => finish('failure');`,
  );

export const resultPage = () =>
  layout(
    'Payment result',
    `<h1>Payment result</h1>
<div id="result" role="status">Loading...</div>
<div id="order-status"></div>`,
    `
const params = new URLSearchParams(location.search);
(async () => {
  const res = await fetch('/merchant/api/intents/' + params.get('payment_intent'));
  const intent = await res.json();
  const el = document.getElementById('result');
  if (intent.status === 'succeeded') { el.textContent = 'Payment succeeded'; el.className = 'ok'; }
  else { el.textContent = 'Payment failed: ' + (intent.last_payment_error ? intent.last_payment_error.message : intent.status); el.className = 'error'; }
  const order = params.get('order');
  if (order) {
    // The order status is set by the signed webhook, so poll until it changes.
    for (let i = 0; i < 40; i++) {
      const r = await fetch('/merchant/orders/' + order);
      if (r.ok) {
        const o = await r.json();
        if (o.status !== 'pending') { document.getElementById('order-status').textContent = 'Order status: ' + o.status; return; }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
})();`,
  );
