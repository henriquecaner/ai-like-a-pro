// Cloudflare Pages Function — /functions/create-checkout.js
// IMPORTANTE: usar ctx.waitUntil() para fire-and-forget
// Sem isso, Cloudflare cancela fetches pendentes ao retornar o Response

const INFINITEPAY_HANDLE = 'leveltech';

function corsHeaders(origin) {
    const allowed = 'https://growthclub.pro';
    return {
        'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin') || '';
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ctx é o terceiro parâmetro — necessário para ctx.waitUntil()
export async function onRequestPost({ request, env, waitUntil }) {
    const origin = request.headers.get('Origin') || '';
    const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

    const RESEND_API_KEY = env.RESEND_API_KEY;
    const REDIRECT_URL = env.REDIRECT_URL || 'https://growthclub.pro/success.html';
    const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL ||
        'https://script.google.com/macros/s/AKfycbx9ktIdeMZs8CtB_7IA7dgWTBxnLsGoMxUlpsQPYW6poGJjN7_aHhlCPAyRjOzZLHkjwA/exec';
    const GOOGLE_SCRIPT_SECRET = env.GOOGLE_SCRIPT_SECRET || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';

    const WEBHOOK_BASE = 'https://growthclub.pro/checkout-webhook';
    const WEBHOOK_URL = WEBHOOK_SECRET
        ? `${WEBHOOK_BASE}?secret=${WEBHOOK_SECRET}`
        : WEBHOOK_BASE;

    try {
        const body = await request.json();
        const { nome, sobrenome, email, whatsapp, linkedin } = body;

        if (!nome || !sobrenome || !email || !whatsapp) {
            return new Response(
                JSON.stringify({ error: 'Campos obrigatórios: nome, sobrenome, email, whatsapp' }),
                { status: 400, headers }
            );
        }

        const phoneDigits = String(whatsapp).replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 13) {
            return new Response(
                JSON.stringify({ error: 'Telefone inválido. Informe DDD + número (ex: 11999999999).' }),
                { status: 400, headers }
            );
        }
        const phone = '+' + (phoneDigits.startsWith('55') ? phoneDigits : '55' + phoneDigits);
        const fullName = `${String(nome).trim()} ${String(sobrenome).trim()}`;
        const orderNsu = `LIKEAPRO-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

        // ── Criar link de checkout no InfinitePay ──────────────────────────────
        const infinitePayPayload = {
            handle: INFINITEPAY_HANDLE,
            items: [{ quantity: 1, price: 19700, description: 'AI LIKE A PRO - Grupo 1', sku: 'UFX8029' }],
            customer: { name: fullName, email: String(email).trim(), phone_number: phone },
            order_nsu: orderNsu,
            redirect_url: REDIRECT_URL,
            webhook_url: WEBHOOK_URL,
        };

        const checkoutRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(infinitePayPayload),
        });

        const checkoutText = await checkoutRes.text();
        console.log('InfinitePay response:', checkoutRes.status, checkoutText);

        if (!checkoutRes.ok) {
            return new Response(
                JSON.stringify({ error: 'Erro ao criar checkout. Tente novamente.', detail: checkoutText }),
                { status: 502, headers }
            );
        }

        let checkoutData;
        try { checkoutData = JSON.parse(checkoutText); }
        catch { checkoutData = { url: checkoutText.trim() }; }

        const checkoutUrl =
            checkoutData.url ||
            checkoutData.checkout_url ||
            checkoutData.link ||
            checkoutData.payment_url;

        if (!checkoutUrl) {
            return new Response(
                JSON.stringify({ error: 'Checkout criado mas URL não encontrada.', data: checkoutData }),
                { status: 502, headers }
            );
        }

        // ── Google Sheets — ctx.waitUntil() mantém o Worker vivo até concluir ─
        const sheetsH = { 'Content-Type': 'application/json' };
        if (GOOGLE_SCRIPT_SECRET) sheetsH['X-Webhook-Secret'] = GOOGLE_SCRIPT_SECRET;

        waitUntil(
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: sheetsH,
                body: JSON.stringify({
                    action: 'create',
                    Nome: nome,
                    Sobrenome: sobrenome,
                    Email: String(email).trim(),
                    Telefone: phone,
                    LinkedIn: linkedin || '',
                    Pago: 'Não',
                    order_nsu: orderNsu,
                    items: 'AI LIKE A PRO - Grupo 1',
                    created_at: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    checkout_url: checkoutUrl,
                }),
            })
                .then(r => r.text().then(t => {
                    if (!r.ok) console.error(`Sheets create falhou: HTTP ${r.status} — ${t}`);
                    else console.log('Sheets create OK:', t);
                }))
                .catch(err => console.error('Sheets create error:', err))
        );

        // ── Email de notificação — ctx.waitUntil() garante execução ───────────
        if (RESEND_API_KEY) {
            waitUntil(
                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                    },
                    body: JSON.stringify({
                        from: 'AI Like a PRO <noreply@mail.thelevel.com.br>',
                        to: 'caner@thelevel.com.br',
                        subject: '🚀 Novo lead — checkout LIKE A PRO',
                        text: [
                            'Novo lead no checkout AI Like a PRO',
                            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                            '',
                            `Nome:      ${fullName}`,
                            `E-mail:    ${String(email).trim()}`,
                            `WhatsApp:  ${phone}`,
                            `LinkedIn:  ${linkedin || 'Não informado'}`,
                            '',
                            `Order NSU: ${orderNsu}`,
                            `Data:      ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                            `Checkout:  ${checkoutUrl}`,
                        ].join('\n'),
                    }),
                })
                    .then(r => console.log('Resend email:', r.status))
                    .catch(err => console.error('Resend error:', err))
            );
        }

        return new Response(JSON.stringify({ checkout_url: checkoutUrl }), { status: 200, headers });

    } catch (err) {
        console.error('Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Erro interno. Tente novamente.' }),
            { status: 500, headers }
        );
    }
}
