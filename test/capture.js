// записывает настоящие ответы API ПЭК в test/fixtures
// запуск вручную командой node test/capture.js когда нужен новый снимок тарифов
// тесты сами в сеть не ходят
const fs = require('fs');
const path = require('path');
const { loadPage, setValue, FIX } = require('./lib');

const API = 'https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php';
const DATE = new Date().toISOString().slice(0, 10);
const SPB = -463, SHODNYA = 67201;

function recorder() {
  const requests = {};
  const f = async (url, opt = {}) => {
    const res = await fetch(url, opt);
    const data = await res.json();
    requests[opt.body] = { response: data };
    return { ok: res.ok, status: res.status, json: async () => data };
  };
  return { f, requests };
}
function save(name, note, requests) {
  fs.mkdirSync(FIX, { recursive: true });
  const file = path.join(FIX, name);
  fs.writeFileSync(file, JSON.stringify({ captured: DATE, source: API, note, requests }, null, 1));
  console.log('записано', file, Object.keys(requests).length, 'ответов');
}
// тело запроса в том же виде что делает функция pek на странице
function body(places, fromId, toId, extra = []) {
  const q = [];
  places.forEach((pl, k) => pl.forEach(v => q.push(`places[${k}][]=${v}`)));
  q.push(`take[town]=${fromId}`, `deliver[town]=${toId}`, ...extra);
  return q.join('&');
}
async function direct(rec, label, places, fromId, toId, extra) {
  const b = body(places, fromId, toId, extra);
  await rec.f(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b });
  rec.requests[b].label = label;
  await new Promise(r => setTimeout(r, 400));
}

(async () => {
  // 1 сводная по 15 городам через саму страницу для одноместной и шестиместной
  for (const model of ['one', 'six']) {
    const rec = recorder();
    const w = loadPage({ fetchImpl: rec.f });
    setValue(w, 'model', model);
    await w.calcMatrix();
    save(`matrix_${model}_${DATE}.json`, `сводная по 15 городам, модель ${model}, 1 кабина, Сходня, как отправляет калькулятор`, rec.requests);
  }

  // опыты случаев а и б разовые их фикстуры от 25.11 храним как доказательство и без нужды не перезаписываем
  // запуск с ними node test/capture.js cases
  const withCases = process.argv.includes('cases');

  // 2 случай а одноместная до Санкт Петербурга стоя как было до 25.11 и плашмя плюс длина короба от 2 до 2.5 м
  if (withCases) {
    const rec = recorder();
    const w = loadPage({ fetchImpl: rec.f });
    setValue(w, 'model', 'one');
    const flat = w.placesForOneCabin();                                         // ширина длина высота объём вес и два нуля
    // так калькулятор отправлял короба до 25.11 ширина толщина высота
    const asIs = flat.map((p, i) => { const b = [[350,1200,2400],[280,1000,2300],[150,1000,2100],[400,1000,250]][i]; return [b[1] / 1000, b[0] / 1000, b[2] / 1000, ...p.slice(3)]; });
    await direct(rec, 'одноместная как сейчас (высота 2,4)', asIs, SHODNYA, SPB);
    await direct(rec, 'одноместная плашмя (длина 2,4)', flat, SHODNYA, SPB);
    for (const L of [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 3.0, 4.0]) {
      const v = Math.ceil(1.2 * 0.35 * L * 1000) / 1000;
      await direct(rec, `короб 1,2×0,35, стоя, высота ${L}`, [[1.2, 0.35, L, v, 150, 0, 0]], SHODNYA, SPB);
      await direct(rec, `короб 1,2×0,35, плашмя, длина ${L}`, [[1.2, L, 0.35, v, 150, 0, 0]], SHODNYA, SPB);
    }
    // где именно порог по высоте
    for (const H of [1.6, 1.7, 1.8, 1.9]) {
      const v = Math.ceil(1.2 * 0.35 * H * 1000) / 1000;
      await direct(rec, `короб 1,2×0,35, стоя, высота ${H}`, [[1.2, 0.35, H, v, 150, 0, 0]], SHODNYA, SPB);
    }
    save(`case_a_${DATE}.json`, 'случай а: доставка до адреса около 27 000 ₽, Санкт-Петербург, забор Сходня', rec.requests);
  }

  // 3 случай б груз 400 кг 4 на 1.3 на 0.7 до Санкт Петербурга двумя способами ввода
  if (withCases) {
    const rec = recorder();
    await direct(rec, '400 кг, длина 4, ширина 1,3, высота 0,7', [[1.3, 4, 0.7, 3.64, 400, 0, 0]], SHODNYA, SPB);
    await direct(rec, '400 кг, ширина 1,3, длина 0,7, высота 4', [[1.3, 0.7, 4, 3.64, 400, 0, 0]], SHODNYA, SPB);
    await direct(rec, '400 кг, длина 4, ширина 1,3, высота 0,7, Москва → Москва', [[1.3, 4, 0.7, 3.64, 400, 0, 0]], SHODNYA, -446);
    save(`case_b_${DATE}.json`, 'случай б: 400 кг, 4 × 1,3 × 0,7 м, калькулятор дал 6800, Артём ждал около 8000', rec.requests);
  }

  // 4 страховка две кабины и сверка с Челябинском через саму страницу
  {
    const rec = recorder();
    const w = loadPage({ fetchImpl: rec.f });
    setValue(w, 'model', 'one');
    setValue(w, 'strah', 500000);
    await w.calcOne();
    setValue(w, 'strah', 0);
    setValue(w, 'model', 'two'); setValue(w, 'qty', 2);
    await w.calcOne();
    setValue(w, 'qty', 1);
    setValue(w, 'to', 'Челябинск, ул. Витебская, 4');
    for (const m of ['four', 'six']) { setValue(w, 'model', m); await w.calcOne(); }
    save(`misc_${DATE}.json`, 'страховка 500 000 ₽ для одноместной, две двухместные до Санкт-Петербурга, Four и Six до Челябинска', rec.requests);
  }
})().catch(e => { console.error(e); process.exit(1); });
