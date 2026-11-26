// общие функции для тестов и для записи фикстур
// страницу калькулятора открываем в jsdom как есть без правок кода
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// fetchImpl получает url и параметры как у window.fetch
// fast true делает паузы между повторами нулевыми чтобы тест ошибок сети шёл быстро
// storage заранее кладёт значения в хранилище браузера а noStorage делает его недоступным как в приватном окне
function loadPage({ fetchImpl, fast = false, online = true, storage = null, noStorage = false } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://haikaaq.github.io/inflow-dostavka/',
    beforeParse(w) {
      if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      if (noStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('хранилище недоступно'); } });
      w.fetch = fetchImpl || (() => Promise.reject(new Error('сеть в тестах отключена')));
      w.Element.prototype.scrollIntoView = function () {};   // в jsdom нет прокрутки
      Object.defineProperty(w.navigator, 'onLine', { get: () => online });
      if (fast) { const st = w.setTimeout.bind(w); w.setTimeout = (f) => st(f, 0); }
    },
  });
  return dom.window;
}

// фикстура это объект где ключ тело запроса а значение ответ ПЭК
function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
}
// запросы к посреднику кабинета ПЭК идут отдельно если ответа кабинета нет считаем что он не ответил
function fixtureFetch(responses, log = [], cabinet = null, cabLog = []) {
  return async (url, opt = {}) => {
    const body = opt.body || '';
    if (String(url).includes('pek-proxy')) {
      cabLog.push(body);
      if (!cabinet) throw new Error('кабинет в тестах отключён');
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cabinet)) };
    }
    log.push(body);
    if (!(body in responses.requests)) throw new Error('нет фикстуры для запроса ' + body.slice(0, 200));
    const data = responses.requests[body].response;
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
  };
}

// выставить поле формы и сообщить странице об изменении
function setValue(w, id, value) {
  const el = w.document.getElementById(id);
  const tick = el.type === 'checkbox' || el.type === 'radio';
  if (tick) el.checked = value; else el.value = String(value);
  el.dispatchEvent(new w.Event(el.tagName === 'SELECT' || tick ? 'change' : 'input', { bubbles: true }));
}
const text = (w, id) => w.document.getElementById(id).textContent;
const rub = s => Number(String(s).replace(/[^\d]/g, ''));

// строки таблицы результата в виде объекта подпись → текст значения
function resultRows(w) {
  const out = {};
  w.document.querySelectorAll('#result tr').forEach(tr => { const td = tr.querySelectorAll('td'); if (td.length > 1) out[td[0].textContent] = td[1].textContent; });
  return out;
}

module.exports = { loadPage, readFixture, fixtureFetch, setValue, text, rub, resultRows, FIX };
