// Cloudflare Pages Function — /functions/checkout-webhook.js
// IMPORTANTE: usar ctx.waitUntil() para fire-and-forget
// Sem isso, Cloudflare cancela fetches pendentes ao retornar o Response

export async function onRequest({ request, env, waitUntil }) {
    const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL ||
        'https://script.google.com/macros/s/AKfycbx9ktIdeMZs8CtB_7IA7dgWTBxnLsGoMxUlpsQPYW6poGJjN7_aHhlCPAyRjOzZLHkjwA/exec';
    const GOOGLE_SCRIPT_SECRET = env.GOOGLE_SCRIPT_SECRET || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';

    // ── Verificar secret ──────────────────────────────────────────────────────
    if (WEBHOOK_SECRET) {
        const url = new URL(request.url);
        const receivedSecret = url.searchParams.get('secret') || '';
        if (receivedSecret !== WEBHOOK_SECRET) {
            console.warn('Webhook rejeitado: secret inválido');
            return new Response('OK', { status: 200 });
        }
    }

    if (request.method !== 'POST') {
        return new Response('OK', { status: 200 });
    }

    try {
        const payload = await request.json();

        console.log('Payment webhook received:', JSON.stringify({
            order_nsu: payload.order_nsu,
            invoice_slug: payload.invoice_slug || payload.slug,
            paid_amount: payload.paid_amount,
            capture_method: payload.capture_method,
        }));

        if (!payload.order_nsu) {
            console.warn('Webhook sem order_nsu — Sheets não atualizado');
            return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Atualizar Google Sheets — ctx.waitUntil() garante execução ────────
        const sheetsH = { 'Content-Type': 'application/json' };
        if (GOOGLE_SCRIPT_SECRET) sheetsH['X-Webhook-Secret'] = GOOGLE_SCRIPT_SECRET;

        waitUntil(
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: sheetsH,
                body: JSON.stringify({
                    action: 'update',
                    order_nsu: payload.order_nsu,
                    Pago: 'Sim',
                    invoice_slug: payload.invoice_slug || payload.slug || '',
                    amount: payload.amount || '',
                    paid_amount: payload.paid_amount || '',
                    installments: payload.installments || '',
                    capture_method: payload.capture_method || '',
                    transaction_nsu: payload.transaction_nsu || '',
                    receipt_url: payload.receipt_url || '',
                    payment_date: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                }),
            })
                .then(r => r.text().then(t => {
                    if (!r.ok) console.error(`Sheets update falhou: HTTP ${r.status} — ${t}`);
                    else console.log('Sheets update OK:', t);
                }))
                .catch(err => console.error('Sheets update error:', err))
        );

        // InfinitePay exige resposta em < 1 segundo
        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('Webhook error:', err);
        return new Response('OK', { status: 200 });
    }
}
