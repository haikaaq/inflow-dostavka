// посредник между калькулятором и API кабинета ПЭК
// ключ API лежит в секретах Cloudflare и в страницу калькулятора не попадает
// секреты PEK_LOGIN это логин личного кабинета и PEK_KEY это ключ из раздела Ключи API
// пропускаем только расчёт стоимости и поиск отделения и только со своих сайтов

const PEK = 'https://kabinet.pecom.ru/api/v1/';
const ALLOWED_PATHS = ['calculator/calculateprice/', 'branches/findzonebyaddress/', 'branches/nearestdepartments/'];
const ALLOWED_ORIGINS = ['https://haikaaq.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('только POST', { status: 405, headers });
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('чужой сайт', { status: 403, headers });

    // путь после адреса посредника например /calculator/calculateprice/
    const path = new URL(request.url).pathname.replace(/^\/+/, '');
    if (!ALLOWED_PATHS.includes(path)) return new Response('этот метод не пропускаем', { status: 404, headers });

    const body = await request.text();
    if (body.length > 20000) return new Response('слишком большой запрос', { status: 413, headers });

    try {
      // при передаче секрета через консоль Windows в начало может попасть метка кодировки и перевод строки поэтому чистим
      const clean = s => String(s || '').replace(/[^\x21-\x7E]/g, '');
      const login = clean(env.PEK_LOGIN), key = clean(env.PEK_KEY);
      if (!login || !key) throw new Error('не заданы секреты PEK_LOGIN и PEK_KEY');
      const res = await fetch(PEK + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          Authorization: 'Basic ' + btoa(login + ':' + key),
        },
        body,
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { ...headers, 'Content-Type': 'application/json;charset=utf-8' },
      });
    } catch (e) {
      // ключ в текст ошибки не попадает только сообщение
      return new Response(JSON.stringify({ proxyError: String(e && e.message || e) }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json;charset=utf-8' },
      });
    }
  },
};
