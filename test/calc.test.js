// тесты калькулятора доставки ПЭК
// ответы ПЭК берём из test/fixtures поэтому тесты не ходят в сеть
// известные ошибки помечены todo они видны в отчёте но не роняют прогон
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPage, readFixture, fixtureFetch, setValue, text, rub, resultRows } = require('./lib');

const DATE = '2026-11-25';
const ALL = { requests: {} };
for (const f of fs.readdirSync(path.join(__dirname, 'fixtures'))) Object.assign(ALL.requests, readFixture(f).requests);
const byLabel = (file, label) => Object.values(readFixture(file).requests).find(r => r.label === label).response;
const clientRound = x => Math.ceil(x / 100) * 100;
// поправка сайта pecom.ru к автоперевозке по умолчанию 10 процентов
const SITE = 1;
// первое число в строке до знака рубля с копейками
const money = s => Number(String(s).split('₽')[0].replace(/[^\d,]/g, '').replace(',', '.'));
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pek_matrix_2026-11-11.json'), 'utf8'));
const MATRIX_NAME = { one: 'Одноместная', six: 'Шестиместная' };

function page(opts = {}) {
  const log = [];
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, log), ...opts });
  return { w, log };
}

test('страница загружается и список моделей заполнен', () => {
  // регрессия к письму Артёма 16.11 про тонкую чёрную строку вместо списка
  const { w } = page();
  const opts = [...w.document.getElementById('model').options].map(o => o.value);
  assert.deepEqual(opts, ['one', 'oneh', 'two', 'four', 'six']);
  assert.equal(w.document.getElementById('model').value, 'two');
  assert.match(text(w, 'boxSummary'), /6 коробов/);
});

test('по умолчанию до терминала со своим довозом 3000 и коэффициентом 1,2', () => {
  const { w } = page();
  assert.equal(w.document.getElementById('take').checked, false);
  assert.equal(w.document.getElementById('own').value, '3 000');
  assert.equal(w.document.getElementById('coef').value, '1.2');
});

test('места одной кабины: вес сходится с весом модели', () => {
  const { w } = page();
  for (const [m, kg] of [['one', 420], ['oneh', 520], ['two', 600], ['four', 700], ['six', 950]]) {
    setValue(w, 'model', m);
    const p = w.placesForOneCabin();
    assert.equal(p.reduce((s, x) => s + x[4], 0), kg, m);
  }
});

test('короба плашмя: длина самая большая сторона а высота самая маленькая', () => {
  const { w } = page();
  for (const m of ['one', 'oneh', 'two', 'four', 'six']) {
    setValue(w, 'model', m);
    for (const p of w.placesForOneCabin()) assert.ok(p[1] >= p[0] && p[0] >= p[2], m + ' ' + Array.from(p).join(' '));
  }
  setValue(w, 'model', 'one');
  assert.deepEqual(Array.from(w.placesForOneCabin()[0].slice(0, 3)), [1.2, 2.4, 0.35]);   // ширина длина высота
});

test('модели видны в списке даже без скрипта', () => {
  // письмо Артёма 16.11 тонкая чёрная строка вместо списка
  // список берётся из HTML поэтому старый браузер который не выполнит скрипт всё равно его покажет
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const doc = new JSDOM(html).window.document;
  const opts = [...doc.getElementById('model').options].map(o => o.value);
  assert.deepEqual(opts, ['one', 'oneh', 'two', 'four', 'six']);
  assert.equal(doc.getElementById('model').value, 'two');
});

test('скрипт без синтаксиса который не понимают браузеры до 2020 года', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const js = html.split('<script>')[1].split('</script>')[0].replace(/const TOWNS_RAW = ".*";/, '');
  assert.ok(!/\?\.[a-zA-Z_[(]/.test(js), 'есть ?.');
  assert.ok(!/\?\?/.test(js), 'есть ??');
});

// короба и вес из письма Артёма от 9 ноября как он их написал
const ARTEM = {
  one: { kg: 420, boxes: ['350х1200х2400', '280х1000х2300', '150х1000х2100', '400х1000х250'] },
  oneh: { kg: 520, boxes: ['350х1200х2400', '300х1200х1400', '180х1400х2100', '150х1000х2100', '250х500х2100'] },
  two: { kg: 600, boxes: ['350х1200х2400 150', '300х1000х2100 130', '400х1200х2100 150', '150х1000х2100 150', '700х250х2100 100', '600х800х1000 50'] },
  four: { kg: 700, boxes: ['350х1500х2400', '300х1200х2100', '400х1500х2100', '300х1300х2100', '300х700х2100', '600х800х1300'] },
  six: { kg: 950, boxes: ['350х1100х2400', '350х1100х2400', '300х1200х2100', '350х1100х2100', '350х1100х2100', '150х1000х2100', '150х1000х2100', '700х300х2100', '600х800х1800'] },
};

test('форма коробов: подписи длина ширина высота и данные Артёма', () => {
  const { w } = page();
  const heads = [...w.document.querySelectorAll('#boxes th')].map(t => t.textContent.trim());
  assert.deepEqual(heads, ['№', 'Длина, мм', 'Ширина, мм', 'Высота, мм', 'Вес, кг', '']);
  assert.ok(!/толщ/i.test(w.document.body.textContent), 'на странице не должно быть слова толщина');
  for (const [m, a] of Object.entries(ARTEM)) {
    setValue(w, 'model', m);
    assert.equal(w.document.getElementById('totalKg').value, String(a.kg), m + ' вес');
    const rows = [...w.document.querySelectorAll('#boxes tbody tr')].map(tr => [...tr.querySelectorAll('input')].map(i => i.value));
    assert.equal(rows.length, a.boxes.length, m + ' число коробов');
    a.boxes.forEach((txt, i) => {
      const [dims, kg] = txt.split(' ');
      // в форме стороны стоят от большей к меньшей длина ширина высота
      const sorted = dims.split('х').map(Number).sort((x, y) => y - x).map(String);
      assert.deepEqual(rows[i].slice(0, 3), sorted, `${m} короб ${i + 1}`);
      assert.equal(rows[i][3], kg || '', `${m} короб ${i + 1} вес`);
    });
    // в ПЭК уходит то же самое плашмя длина самая большая высота самая маленькая
    const p = w.placesForOneCabin();
    a.boxes.forEach((txt, i) => {
      const s = txt.split(' ')[0].split('х').map(Number).sort((x, y) => y - x);
      assert.deepEqual(Array.from(p[i].slice(0, 3)), [s[1] / 1000, s[0] / 1000, s[2] / 1000], `${m} место ${i + 1}`);
    });
  }
});

test('короб введён в другом порядке: результат тот же', () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  const before = Array.from(w.placesForOneCabin()[0].slice(0, 3));
  // вводим высоту 2400 а длину 350 как сделал бы человек по старым подписям
  const inp = [...w.document.querySelectorAll('#boxes tbody tr')][0].querySelectorAll('input');
  [['350', 0], ['1200', 1], ['2400', 2]].forEach(([v, j]) => { inp[j].value = v; inp[j].dispatchEvent(new w.Event('input', { bubbles: true })); });
  assert.deepEqual(Array.from(w.placesForOneCabin()[0].slice(0, 3)), before);
});

test('пустой размер: сообщение про длину ширину и высоту', async () => {
  const w = loadPage({ fetchImpl: async () => { throw new Error('не должен звать'); } });
  const inp = w.document.querySelector('#boxes input');
  inp.value = ''; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  await w.calcOne();
  assert.match(text(w, 'resErr'), /длину, ширину и высоту/);
});

test('переключатель: по умолчанию свой довоз, видно только поле выбранного варианта', () => {
  const { w } = page();
  const $ = id => w.document.getElementById(id);
  assert.equal($('pickOwn').checked, true);
  assert.equal($('take').checked, false);
  assert.equal($('ownBox').hidden, false);
  assert.equal($('fromBox').hidden, true);
  setValue(w, 'take', true);
  assert.equal($('pickOwn').checked, false);
  assert.equal($('ownBox').hidden, true);
  assert.equal($('fromBox').hidden, false);
  setValue(w, 'pickOwn', true);
  assert.equal($('ownBox').hidden, false);
  assert.equal($('fromBox').hidden, true);
});

test('раздел 3 Отправка с точным адресом производства', () => {
  const { w } = page();
  const heads = [...w.document.querySelectorAll('main > section h2')].map(h => h.textContent.trim());
  assert.deepEqual(heads.slice(0, 3), ['1Что везём', '2Куда', '3Отправка']);
  const sec3 = w.document.querySelectorAll('main > section')[2];
  assert.ok(sec3.contains(w.document.getElementById('take')) && sec3.contains(w.document.getElementById('calc')));
  assert.match(w.document.getElementById('prodAddr').textContent, /г\. Химки, мкрн Сходня, ул\. Ленинградская, д\. 4/);
});

test('количество кабин: кнопки плюс и минус, не меньше 1', () => {
  const { w } = page();
  const $ = id => w.document.getElementById(id);
  $('qtyMinus').click();
  assert.equal($('qty').value, '1');
  $('qtyPlus').click(); $('qtyPlus').click();
  assert.equal($('qty').value, '3');
  assert.match($('boxSummary').textContent, /Всего: 3 кабины, 11,43 м³/);   // двухместная 3.81 м³ на 3 кабины
  assert.equal($('qtyMinus').classList.contains('off'), false);
  $('qtyMinus').click();
  assert.equal($('qty').value, '2');
  setValue(w, 'qty', 0);
  $('qtyMinus').click();
  assert.equal($('qty').value, '1');
  assert.equal($('qtyMinus').classList.contains('off'), true);
});

test('расчёт через кабинет ПЭК: цифры как на сайте pecom.ru', async () => {
  // настоящий ответ кабинета 26.11 одноместная из Сходни в Петербург объявленная стоимость 100
  const cab = readFixture('cabinet_one_spb_2026-11-26.json');
  const pub = [], sent = [];
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, pub, cab.response, sent) });
  setValue(w, 'model', 'one');
  await w.calcOne();
  // калькулятор отправил те же места что ввели на сайте и адрес производства
  const req = JSON.parse(sent[0]);
  assert.deepEqual(req.cargos, cab.request.cargos);
  assert.equal(req.pickup.address, cab.request.pickup.address);
  assert.equal(req.delivery.address, 'Санкт-Петербург');
  assert.equal(req.isInsurancePrice, 100);
  assert.equal(pub.length, 0, 'публичный расчёт не нужен');
  const r = resultRows(w);
  assert.equal(money(r['Автоперевозка']), 11459.45);
  assert.equal(money(r['Доставка груза (до адреса)']), 3047.5);
  assert.equal(money(r['Страхование груза']), 575.1);
  assert.equal(money(r['Ориентировочная сумма до адреса']), 15082.05);
  assert.equal(r['Срок в пути'], '2 - 3 дн.');
  assert.doesNotMatch(text(w, 'resErr'), /приблизительный/);
  // забор машиной ПЭК 4025 как на сайте
  setValue(w, 'take', true);
  await w.calcOne();
  assert.equal(money(resultRows(w)['Забор груза']), 4025);
});

test('кабинет не ответил: публичный расчёт с пометкой приблизительно', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  await w.calcOne();
  assert.match(text(w, 'resErr'), /Расчёт приблизительный/);
  assert.equal(money(resultRows(w)['Автоперевозка']), 10417.68);
});

test('пункт отправки по умолчанию Сходня', () => {
  const { w } = page();
  assert.equal(w.document.getElementById('from').value, '67201');
});

test('коэффициент: быстрые кнопки и запоминание', () => {
  const { w } = page();
  const btns = [...w.document.querySelectorAll('[data-coef]')].map(b => b.dataset.coef);
  assert.deepEqual(btns, ['1', '1.1', '1.2', '1.25', '1.3']);
  w.document.querySelector('[data-coef="1.25"]').click();
  assert.equal(w.document.getElementById('coef').value, '1.25');
  assert.equal(w.localStorage.getItem('coef'), '1.25');
  // ручной ввод тоже запоминается
  setValue(w, 'coef', 1.15);
  assert.equal(w.localStorage.getItem('coef'), '1.15');
  // новая страница берёт сохранённое значение
  const w2 = loadPage({ storage: { coef: '1.3' } });
  assert.equal(w2.document.getElementById('coef').value, '1.3');
  // без хранилища страница работает и ставит 1,2
  const w3 = loadPage({ noStorage: true });
  assert.equal(w3.document.getElementById('coef').value, '1.2');
});

for (const model of ['one', 'six']) {
  test(`сводная по 15 городам: ${MATRIX_NAME[model]}`, async () => {
    const { w, log } = page();
    setValue(w, 'model', model);
    await w.calcMatrix();
    assert.equal(log.length, 15);
    const fx = Object.values(readFixture(`matrix_${model}_${DATE}.json`).requests).map(r => r.response);
    const rows = [...w.document.querySelectorAll('#matrixTable tbody tr')].map(tr => [...tr.children].map(td => td.textContent));
    assert.equal(rows.length, 15);
    rows.forEach((r, i) => {
      const j = fx[i];
      const auto = Math.round(j.auto[2] * SITE * 100) / 100;
      const door = auto + j.deliver[2];
      assert.equal(rub(r[3]), Math.round(door), r[0] + ' ПЭК до адреса');
      assert.equal(rub(r[4]), clientRound((door + 3000) * 1.2), r[0] + ' клиенту до адреса');
      assert.equal(rub(r[5]), clientRound((auto + 3000) * 1.2), r[0] + ' клиенту до терминала');
    });
  });

  test(`тарифы ПЭК 25.11 против снимка 11.11: ${MATRIX_NAME[model]}`, () => {
    // снимок 11.11 делали для Химок а сейчас Сходня но филиал один Москва Восток
    // сравниваем только перевозку потому что забор и доставка зависят от того как лежит короб
    const snap = SNAPSHOT[MATRIX_NAME[model]].c;
    const fx = Object.values(readFixture(`matrix_${model}_${DATE}.json`).requests).map(r => r.response);
    let compared = 0;
    for (const j of fx) {
      const name = j.deliver[1];
      if (!snap[name]) continue;
      compared++;
      assert.equal(j.auto[2], snap[name][1], name + ' перевозка');
    }
    assert.ok(compared >= 8);
  });
}

test('расчёт одной кабины: строки результата и формула', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  await w.calcOne();
  const r = resultRows(w);
  // одноместная плашмя до Петербурга расчёт ПЭК 10417.68 доставка 3047.5
  assert.equal(money(r['Автоперевозка']), 10417.68);
  assert.equal(money(r['Доставка груза (до адреса)']), 3047.5);
  assert.equal(rub(r['Клиенту до адреса (×1.2)']), clientRound((10417.68 + 3047.5 + 3000) * 1.2));
  assert.equal(rub(r['Клиенту до терминала ПЭК (×1.2)']), clientRound((10417.68 + 3000) * 1.2));
  assert.equal(w.document.getElementById('siteAdj'), null);
});

test('коэффициент клиента 1,25 как в примере Артёма', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  setValue(w, 'coef', 1.25);
  await w.calcOne();
  const r = resultRows(w);
  assert.equal(rub(r['Клиенту до терминала ПЭК (×1.25)']), clientRound((10417.68 + 3000) * 1.25));
  // пример Артёма из письма 9 ноября 43850 плюс 3000 умножить на 1.25 у него сумма округлена до 47000 и вышло 58750
  const j = { auto: ['', '', 43850] };
  setValue(w, 'coef', 1.25);
  assert.equal(w.totals(j).clientTerminal, 58600);
});

test('округление клиенту всегда вверх до 100 ₽', () => {
  const { w } = page();
  setValue(w, 'coef', 1);
  setValue(w, 'own', 0);
  for (const [x, want] of [[10000, 10000], [10000.01, 10100], [10001, 10100], [10099, 10100], [10100, 10100]]) {
    assert.equal(w.totals({ auto: ['', '', x] }).clientTerminal, want, String(x));
  }
});

test('забор машиной ПЭК: свой довоз не прибавляется', () => {
  const { w } = page();
  setValue(w, 'take', true);
  const t = w.totals({ take: ['', '', 31900], auto: ['', '', 10000], deliver: ['', '', 5000] });
  assert.equal(t.own, 0);
  assert.equal(t.pekTerminal, 41900);
  assert.equal(t.clientDoor, clientRound(46900 * 1.2));
});

test('страховка 500 000 ₽ попадает в сумму (710 ₽)', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  setValue(w, 'price', 500000);
  await w.calcOne();
  const r = resultRows(w);
  assert.equal(money(r['Страхование груза']), 710);
  assert.equal(rub(r['Клиенту до терминала ПЭК (×1.2)']), clientRound((10417.68 + 710 + 3000) * 1.2));
});

test('рохля 3000 ₽ за каждую кабину', async () => {
  const { w } = page();
  setValue(w, 'model', 'two');
  setValue(w, 'qty', 2);
  await w.calcOne();
  assert.match(resultRows(w)['Свой довоз рохлей'], /6\s?000/);
  assert.equal(w.totals({ auto: ['', '', 10000] }).own, 6000);
});

test('сверка Сходня → Челябинск без поправки сайта: FOUR около 54 800 и SIX около 63 800 до адреса', async () => {
  // цифры из разбора API от 25.11 свой довоз и коэффициент 1.2
  for (const [m, want] of [['four', 54800], ['six', 63800]]) {
    const { w } = page();
      setValue(w, 'model', m);
    setValue(w, 'to', 'Челябинск, ул. Витебская, 4');
    await w.calcOne();
    const got = rub(resultRows(w)['Клиенту до адреса (×1.2)']);
    assert.ok(Math.abs(got - want) / want < 0.01, m + ' ' + got);
  }
});

// случай а
test('случай а: факт ПЭК по высоте короба (забор и доставка ступенями)', () => {
  const f = `case_a_${DATE}.json`;
  const step = h => byLabel(f, `короб 1,2×0,35, стоя, высота ${h}`);
  assert.equal(step(1.8).deliver[2], 1750);
  assert.equal(step(1.9).deliver[2], 4450);
  assert.equal(step(2.0).deliver[2], 4450);
  assert.equal(step(2.1).deliver[2], 9000);
  assert.equal(step(2.2).deliver[2], 9000);
  assert.equal(step(2.3).deliver[2], 27100);
  assert.equal(step(2.4).deliver[2], 27100);
  assert.equal(step(2.5).auto, undefined);                   // выше 2,45 м ПЭК не везёт
  // длина не влияет на забор и доставку до 2,5 м
  for (const L of [2.0, 2.2, 2.4, 2.5]) assert.equal(byLabel(f, `короб 1,2×0,35, плашмя, длина ${L}`).deliver[2], 2012.5, 'длина ' + L);
  // межгород от поворота короба не зависит
  assert.equal(byLabel(f, 'одноместная как сейчас (высота 2,4)').auto[2], byLabel(f, 'одноместная плашмя (длина 2,4)').auto[2]);
});

test('случай а: доставка по Петербургу не дороже 7 тыс. ₽, как ждёт Артём', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  await w.calcOne();
  const d = money(resultRows(w)['Доставка груза (до адреса)']);
  assert.ok(d >= 3000 && d <= 7000, 'доставка ' + d);
});

// случай б
test('случай б: груз 400 кг 4 × 1,3 × 0,7 м до Петербурга, факт ПЭК', () => {
  const f = `case_b_${DATE}.json`;
  const flat = byLabel(f, '400 кг, длина 4, ширина 1,3, высота 0,7');
  assert.equal(flat.auto[2], 18090.8);
  assert.equal(flat.deliver[2], 4252.5);
  const standing = byLabel(f, '400 кг, ширина 1,3, длина 0,7, высота 4');
  assert.equal(standing.auto, undefined);                    // ВГХ превышены
  assert.ok(standing.error.some(e => /высота до 2,45/.test(e)));
});

test('случай б: около 8000 ₽, как ждал Артём', { todo: 'не воспроизведено: в записи 6800 против 8000, город и вариант (терминал или адрес) неизвестны, проверить на pecom.ru' }, () => {
  const j = byLabel(`case_b_${DATE}.json`, '400 кг, длина 4, ширина 1,3, высота 0,7');
  assert.ok(Math.abs(j.deliver[2] - 8000) < 400 || Math.abs(j.auto[2] - 8000) < 400);
});

test('груз выше 2,45 м: понятная ошибка вместо суммы', () => {
  const { w } = page();
  const j = byLabel(`case_a_${DATE}.json`, 'короб 1,2×0,35, стоя, высота 2.5');
  const t = w.totals(j);
  assert.equal(t.auto, null);
  assert.equal(t.clientDoor, null);
  assert.ok(t.errors.some(e => /2,45/.test(e)));
  assert.ok(!t.errors.some(e => /Авиа/.test(e)));
});

// ошибки сети
test('сеть: три попытки и понятное сообщение', async () => {
  let calls = 0;
  const w = loadPage({ fast: true, fetchImpl: async (u) => { if (!String(u).includes('pek-proxy')) calls++; throw new Error('Failed to fetch'); } });
  await w.calcOne();
  assert.equal(calls, 3);   // три попытки публичного расчёта после кабинета
  assert.match(text(w, 'resErr'), /ПЭК не ответил/);
  assert.equal(w.document.getElementById('calc').disabled, false);
});

test('сеть: ответ 500 тоже даёт сообщение', async () => {
  const w = loadPage({ fast: true, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await w.calcOne();
  assert.match(text(w, 'resErr'), /ошибкой 500/);
});

test('сеть: нет интернета', async () => {
  const w = loadPage({ fast: true, online: false, fetchImpl: async () => { throw new Error('Failed to fetch'); } });
  await w.calcOne();
  assert.match(text(w, 'resErr'), /нет интернета/);
});

test('сеть: в сводной город без ответа помечается, остальные считаются', async () => {
  let n = 0;
  const real = fixtureFetch(ALL);
  const w = loadPage({ fast: true, fetchImpl: async (u, o) => { if (String(u).includes('pek-proxy')) return real(u, o); n++; if (n <= 3) throw new Error('обрыв'); return real(u, o); } });
  setValue(w, 'model', 'one');
  await w.calcMatrix();
  const rows = [...w.document.querySelectorAll('#matrixTable tbody tr')].map(tr => tr.lastElementChild.textContent);
  assert.equal(rows[0], 'нет ответа');
  assert.equal(rows.filter(x => x === 'нет ответа').length, 1);
});

test('проверка груза до запроса: пустой короб', async () => {
  let calls = 0;
  const w = loadPage({ fetchImpl: async () => { calls++; throw new Error('не должен звать'); } });
  w.document.querySelector('#boxes input').value = '';
  w.document.querySelector('#boxes input').dispatchEvent(new w.Event('input', { bubbles: true }));
  await w.calcOne();
  assert.equal(calls, 0);
  assert.match(text(w, 'resErr'), /короба №1 не заполнены/);
});

// правки Марии 26.11 страховка обязательна стоимость вводится тысячи с пробелами несколько моделей жёсткая упаковка
const cabFixture = () => readFixture('cabinet_one_spb_2026-11-26.json');

test('денежные поля: пробелы между тысячами и число без пробелов в расчёте', () => {
  const { w } = page();
  for (const id of ['price', 'pack', 'own', 'extra']) {
    const el = w.document.getElementById(id);
    assert.equal(el.classList.contains('money'), true, id);
    setValue(w, id, '1234567');
    assert.equal(el.value, '1 234 567', id);
    setValue(w, id, '325 000 ₽');
    assert.equal(el.value, '325 000', id);
    setValue(w, id, '007');
    assert.equal(el.value, '7', id);
  }
  setValue(w, 'own', '3 500');
  setValue(w, 'coef', 1);
  assert.equal(w.totals({ auto: ['', '', 10000] }).own, 3500);
});

test('без стоимости кабины не считаем: подсказка и красная рамка', async () => {
  let calls = 0;
  const w = loadPage({ price: null, fetchImpl: async () => { calls++; throw new Error('не должен звать'); } });
  await w.calcOne();
  assert.equal(calls, 0);
  assert.match(text(w, 'resErr'), /Впишите стоимость кабины/);
  assert.equal(w.document.getElementById('price').classList.contains('need'), true);
  setValue(w, 'price', 300000);
  assert.equal(w.document.getElementById('price').classList.contains('need'), false);
  // сводная тоже не считается без стоимости
  const w2 = loadPage({ price: null, fetchImpl: async () => { calls++; throw new Error('не должен звать'); } });
  await w2.calcMatrix();
  assert.equal(calls, 0);
  assert.match(text(w2, 'resErr'), /Впишите стоимость кабины/);
});

test('страховка всегда: объявленная стоимость = (кабина + упаковка) × кабины', async () => {
  const cab = cabFixture(), sent = [], pub = [];
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, pub, cab.response, sent) });
  setValue(w, 'model', 'one');
  setValue(w, 'price', '325 000');
  setValue(w, 'pack', '28 000');
  setValue(w, 'qty', 2);
  await w.calcOne();
  const req = JSON.parse(sent[0]);
  assert.equal(req.isInsurance, true);
  assert.equal(req.isInsurancePrice, 706000);
  assert.equal(req.cargos.length, 8);
  assert.match(resultRows(w)['Объявленная стоимость'], /706\s000/);
  // запасной публичный расчёт тоже со страховкой
  const log = [];
  const w2 = loadPage({ fetchImpl: fixtureFetch(ALL, log) });
  setValue(w2, 'model', 'one');
  setValue(w2, 'price', 500000);
  await w2.calcOne();
  assert.match(log[0], /&strah=500000$/);
});

test('жёсткая упаковка за каждую кабину идёт в наши расходы и под коэффициент', async () => {
  const cab = cabFixture();
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, [], cab.response, []) });
  setValue(w, 'model', 'one');
  setValue(w, 'pack', 28000);
  setValue(w, 'qty', 2);
  const t = w.totals({ auto: ['', '', 10000] });
  assert.equal(t.pack, 56000);
  assert.equal(t.clientTerminal, clientRound((10000 + 6000 + 56000) * 1.2));
  await w.calcOne();
  assert.match(resultRows(w)['Жёсткая упаковка'], /56\s000 ₽ \(2 × 28\s000 ₽\)/);
  // упаковка не указана видно в результате
  const w2 = loadPage({ fetchImpl: fixtureFetch(ALL, [], cab.response, []) });
  await w2.calcOne();
  assert.match(resultRows(w2)['Жёсткая упаковка'], /не указана/);
});

test('несколько разных моделей: все короба одной отправкой', async () => {
  const cab = cabFixture(), sent = [];
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, [], cab.response, sent) });
  const $ = id => w.document.getElementById(id);
  assert.equal($('cargoTotal').hidden, true);
  assert.equal(w.document.querySelector('.lineHead').hidden, true);
  setValue(w, 'price', 400000);
  setValue(w, 'pack', 30000);
  const el = w.addLine();
  assert.equal(w.document.querySelectorAll('#lines .line').length, 2);
  assert.equal(w.document.querySelector('.lineHead').hidden, false);
  // у второй позиции свои поля и свои id
  const sel = el.querySelector('.model');
  assert.notEqual(sel.id, 'model');
  assert.equal(w.document.querySelector(`label[for="${sel.id}"]`).textContent, 'Модель');
  sel.value = 'six'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const price2 = el.querySelector('.price');
  assert.equal(price2.value, '');
  // без стоимости второй позиции расчёт не идёт
  await w.calcOne();
  assert.match(text(w, 'resErr'), /Позиция 2: Впишите стоимость кабины/);
  assert.equal(sent.length, 0);
  price2.value = '600000'; price2.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(price2.value, '600 000');
  el.querySelector('.pack').value = '32000'; el.querySelector('.pack').dispatchEvent(new w.Event('input', { bubbles: true }));
  el.querySelector('.plus').click();
  assert.equal(el.querySelector('.q').value, '2');
  assert.match($('cargoTotal').textContent, /3 кабины, 24 места/);   // двухместная 6 мест и две шестиместные по 9
  assert.equal(w.allPlaces().length, 24);
  assert.equal(w.declared(), 430000 + 2 * 632000);
  assert.equal(w.packTotal(), 30000 + 64000);
  await w.calcOne();
  const req = JSON.parse(sent[0]);
  assert.equal(req.cargos.length, 24);
  assert.equal(req.isInsurancePrice, 1694000);
  const r = resultRows(w);
  assert.match(r['Груз'], /3 кабины \(Двухместная × 1 \+ Шестиместная × 2\), 24 места/);
  assert.match(r['Свой довоз рохлей'], /9\s000/);
  // короба второй позиции правятся отдельно от первой
  el.querySelector('.addBox').click();
  assert.equal(w.allPlaces().length, 26);
  assert.equal(w.placesForOneCabin().length, 6);
  // убрать позицию
  el.querySelector('.del').click();
  assert.equal(w.document.querySelectorAll('#lines .line').length, 1);
  assert.equal($('cargoTotal').hidden, true);
  assert.equal(w.allPlaces().length, 6);
});

test('сводная по городам: название из всех позиций', async () => {
  const { w } = page({ fast: true });
  setValue(w, 'model', 'one');
  w.addLine();
  const p = w.document.querySelectorAll('#lines .price')[1];
  p.value = '300000'; p.dispatchEvent(new w.Event('input', { bubbles: true }));
  await w.calcMatrix();
  assert.equal(text(w, 'matrixTitle'), 'Одноместная × 1 + Одноместная × 1 — по городам');
});

test('зона доставки ПЭК в результате: пригород помечен', async () => {
  const cab = cabFixture();
  const w = loadPage({ fetchImpl: async (u) => {
    if (String(u).includes('findzonebyaddress')) return { ok: true, status: 200, json: async () => ({ zoneName: 'Казань пригород' }) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cab.response)) };
  } });
  await w.calcOne();
  assert.match(resultRows(w)['Зона доставки ПЭК'], /Казань пригород.*дороже/);
  // зона не ответила расчёт всё равно есть
  const w2 = loadPage({ fetchImpl: async (u) => {
    if (String(u).includes('findzonebyaddress')) throw new Error('обрыв');
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cab.response)) };
  } });
  await w2.calcOne();
  assert.equal(resultRows(w2)['Зона доставки ПЭК'], undefined);
  assert.equal(money(resultRows(w2)['Автоперевозка']), 11459.45);
});

test('Москва и область: без автоперевозки понятное сообщение, а не 0 ₽', async () => {
  // так кабинет ответил 26.11 на адрес Балашиха только доставка 4025
  const cab = cabFixture().response;
  const local = JSON.parse(JSON.stringify(cab));
  local.branchReceiver = 'Москва Восток';
  local.transfers.find(x => x.type === 3).services = [{ info: 'Доставка груза', cost: 4025 }];
  const w = loadPage({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(local)) }) });
  setValue(w, 'to', 'Московская обл., г. Балашиха, ул. Советская, 1');
  await w.calcOne();
  assert.match(text(w, 'resErr'), /Москве или области/);
  assert.equal(w.document.getElementById('resBody').hidden, true);
});

// pdf для клиента вместо блока проверки на pecom.ru
const allText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(allText).join(' ') : node && typeof node === 'object' ? Object.values(node).map(allText).join(' ') : '';

test('pdf для клиента: суммы клиенту без цен ПЭК и коэффициента', async () => {
  const cab = cabFixture();
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, [], cab.response, []) });
  assert.equal(w.document.getElementById('pecCheck'), null);
  setValue(w, 'model', 'one');
  setValue(w, 'price', 325000);
  setValue(w, 'pack', 28000);
  await w.calcOne();
  const c = w.eval('lastCheck');
  assert.equal(c.clientDoor, 55300);   // пример из раздела как считает калькулятор
  const dd = w.buildCheck(c, null);
  const txt = allText(dd.content).replace(/ /g, ' ');
  assert.match(txt, /ДОСТАВКА В САНКТ-ПЕТЕРБУРГ/);
  assert.match(txt, /55 300 ₽/);
  assert.match(txt, /Страхование груза на 353 000 ₽/);
  assert.match(txt, /Жёсткая упаковка кабин/);
  assert.match(txt, /Кабина одноместная — 1 шт\./);
  assert.match(txt, /Самойлов Артём/);
  // внутренние цифры клиенту не показываем
  for (const bad of [/11 459/, /15 082/, /1,2\b|×/, /Автоперевозка/, /рохл/i, /коэффициент/i]) assert.doesNotMatch(txt, bad, String(bad));
  // свойства файла без автора и программы
  assert.deepEqual(Object.values(dd.info).slice(1).map(v => v.trim()), ['', '', '', '', '']);
  assert.equal(w.checkFileName(c).startsWith('Расчёт доставки — Санкт-Петербург — '), true);
});

test('pdf: без расчёта или после изменений просит пересчитать, без интернета понятная ошибка', async () => {
  const cab = cabFixture();
  const w = loadPage({ fetchImpl: fixtureFetch(ALL, [], cab.response, []) });
  await w.downloadPdf();
  assert.match(text(w, 'pdfNote'), /Сначала нажмите «Рассчитать»/);
  await w.calcOne();
  // библиотека pdf не загрузится в тестах потому что сети нет
  w.document.head.appendChild = function (el) { setTimeout(() => el.onerror(), 0); return el; };
  await w.downloadPdf();
  assert.match(text(w, 'pdfNote'), /Не получилось сделать PDF: нет связи с cdnjs\.cloudflare\.com/);
  assert.equal(w.document.getElementById('pdfBtn').disabled, false);
  setValue(w, 'price', 1);
  await w.downloadPdf();
  assert.match(text(w, 'pdfNote'), /Сначала нажмите «Рассчитать»/);
});
