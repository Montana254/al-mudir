module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Endpoint intentionally disabled after product reset.
  return res.status(410).json({
    ok: false,
    error: 'endpoint_disabled',
    message: 'Telegram alert pipeline is disabled for the current clean deployment.'
  });
};