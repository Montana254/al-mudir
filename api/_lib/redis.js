'use strict';

// Upstash Redis REST API client — no dependencies, uses native fetch (Node 18+)
async function redis(...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('redis_not_configured');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error('redis_http_' + res.status + ': ' + text.slice(0, 200));
  }

  const data = await res.json();
  if (data.error) throw new Error('redis_cmd: ' + data.error);
  return data.result;
}

module.exports = { redis };
