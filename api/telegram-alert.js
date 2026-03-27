module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ ok: false, error: 'telegram_not_configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const eventType = body.type || 'user.created';
    const payload = body.payload || {};

    if (eventType !== 'user.created') {
      return res.status(400).json({ ok: false, error: 'unsupported_event' });
    }

    const lines = [
      'NEW AL-MUDIR SIGNUP',
      '--------------------',
      'Name: ' + [payload.first_name, payload.last_name].filter(Boolean).join(' '),
      'Email: ' + (payload.email || 'N/A'),
      'Phone: ' + (payload.phone || 'N/A'),
      'Experience: ' + (payload.experience || 'N/A'),
      'Objective: ' + (payload.objectives || 'N/A')
    ];

    const telegramResponse = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n')
      })
    });

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramData.ok) {
      return res.status(502).json({ ok: false, error: 'telegram_send_failed', details: telegramData });
    }

    return res.status(200).json({ ok: true, telegram: telegramData.result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'server_error', message: error.message });
  }
};