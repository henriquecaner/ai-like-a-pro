// Cloudflare Pages Function — /functions/create-checkout.js
// Deploy automático junto com o site no Cloudflare Pages
// Env vars configuradas em: Cloudflare Dashboard → Pages → ai-like-a-pro → Settings → Environment variables

const INFINITEPAY_HANDLE = 'leveltech';

function corsHeaders(origin) {
    const allowed = 'https://growthclub.pro';
    return {
        'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

// Handler para preflight CORS
export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin') || '';
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// Handler principal — POST do formulário de checkout
export async function onRequestPost({ request, env }) {
    const origin = request.headers.get('Origin') || '';
    const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

    const RESEND_API_KEY = env.RESEND_API_KEY;
    const REDIRECT_URL = env.REDIRECT_URL || 'https://growthclub.pro/success.html';
    const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL ||
        'https://script.google.com/macros/s/AKfycbx9ktIdeMZs8CtB_7IA7dgWTBxnLsGoMxUlpsQPYW6poGJjN7_aHhlCPAyRjOzZLHkjwA/exec';
    const GOOGLE_SCRIPT_SECRET = env.GOOGLE_SCRIPT_SECRET || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';

    // URL do webhook registrada no InfinitePay (aponta para este mesmo site)
    const WEBHOOK_BASE = 'https://growthclub.pro/checkout-webhook';
    const WEBHOOK_URL = WEBHOOK_SECRET
        ? `${WEBHOOK_BASE}?secret=${WEBHOOK_SECRET}`
        : WEBHOOK_BASE;

    try {
        const body = await request.json();
        const { nome, sobrenome, email, whatsapp, linkedin } = body;

        // Validação — campos obrigatórios
        if (!nome || !sobrenome || !email || !whatsapp) {
            return new Response(
                JSON.stringify({ error: 'Campos obrigatórios: nome, sobrenome, email, whatsapp' }),
                { status: 400, headers }
            );
        }

        // Validação e formatação do telefone
        const phoneDigits = String(whatsapp).replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 13) {
            return new Response(
                JSON.stringify({ error: 'Telefone inválido. Informe DDD + número (ex: 11999999999).' }),
                { status: 400, headers }
            );
        }
        const phone = '+' + (phoneDigits.startsWith('55') ? phoneDigits : '55' + phoneDigits);
        const fullName = `${String(nome).trim()} ${String(sobrenome).trim()}`;

        // ID único de pedido — crypto.randomUUID() disponível no Cloudflare Workers
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
            console.error('No checkout URL found in response:', checkoutText);
            return new Response(
                JSON.stringify({ error: 'Checkout criado mas URL não encontrada.', data: checkoutData }),
                { status: 502, headers }
            );
        }

        // ── Google Sheets — registrar lead (fire-and-forget) ──────────────────
        if (GOOGLE_SCRIPT_URL) {
            const sheetsH = { 'Content-Type': 'application/json' };
            if (GOOGLE_SCRIPT_SECRET) sheetsH['X-Webhook-Secret'] = GOOGLE_SCRIPT_SECRET;

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
                    if (!r.ok) console.error(`Google Sheets create falhou: HTTP ${r.status} — ${t}`);
                    else console.log('Google Sheets create OK:', r.status);
                }))
                .catch(err => console.error('Google Sheets create error:', err));
        } else {
            console.warn('GOOGLE_SCRIPT_URL não configurado — lead não salvo no Sheets');
        }

        // ── Email de notificação — fire-and-forget (não bloqueia o redirect) ──
        if (RESEND_API_KEY) {
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
                .catch(err => console.error('Resend error:', err));
        } else {
            console.warn('RESEND_API_KEY não configurado — email de notificação não enviado');
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
