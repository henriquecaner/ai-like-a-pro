// Cloudflare Pages Function — /functions/checkout-webhook.js
// Recebe o webhook do InfinitePay quando o pagamento é aprovado
// e atualiza a coluna "Pago" no Google Sheets

export async function onRequest({ request, env }) {
    const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL;
    const GOOGLE_SCRIPT_SECRET = env.GOOGLE_SCRIPT_SECRET || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';

    // ── Verificar o secret se estiver configurado ─────────────────────────
    // O secret é passado como query param na webhook_url registrada no InfinitePay
    if (WEBHOOK_SECRET) {
        const url = new URL(request.url);
        const receivedSecret = url.searchParams.get('secret') || '';
        if (receivedSecret !== WEBHOOK_SECRET) {
            // Retorna 200 para não alertar possíveis atacantes com um 401
            console.warn('Webhook rejeitado: secret inválido ou ausente');
            return new Response('OK', { status: 200 });
        }
    }

    // InfinitePay envia POST quando o pagamento é aprovado
    if (request.method !== 'POST') {
        return new Response('OK', { status: 200 });
    }

    try {
        const payload = await request.json();

        console.log('Payment webhook received:', JSON.stringify({
            order_nsu: payload.order_nsu,
            invoice_slug: payload.invoice_slug || payload.slug,
            amount: payload.amount,
            paid_amount: payload.paid_amount,
            capture_method: payload.capture_method,
            transaction_nsu: payload.transaction_nsu,
        }));

        // Sem order_nsu não há como localizar o lead no Sheets
        if (!payload.order_nsu) {
            console.warn('Webhook sem order_nsu — Sheets não atualizado');
            return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Atualizar Google Sheets — Pago = Sim (fire-and-forget) ───────────
        if (GOOGLE_SCRIPT_URL) {
            const sheetsH = { 'Content-Type': 'application/json' };
            if (GOOGLE_SCRIPT_SECRET) sheetsH['X-Webhook-Secret'] = GOOGLE_SCRIPT_SECRET;

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
                    else console.log('Sheets update OK:', r.status);
                }))
                .catch(err => console.error('Sheets update error:', err));
        } else {
            console.warn('GOOGLE_SCRIPT_URL não configurado — Sheets não atualizado');
        }

        // InfinitePay exige resposta em < 1 segundo
        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('Webhook error:', err);
        // Sempre retorna 200 para InfinitePay não retentar indefinidamente
        return new Response('OK', { status: 200 });
    }
}
