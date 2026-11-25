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
  assert.equal(w.document.getElementById('own').value, '3000');
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
      const door = j.auto[2] + j.deliver[2];
      assert.equal(rub(r[3]), Math.round(door), r[0] + ' ПЭК до адреса');
      assert.equal(rub(r[4]), clientRound((door + 3000) * 1.2), r[0] + ' клиенту до адреса');
      assert.equal(rub(r[5]), clientRound((j.auto[2] + 3000) * 1.2), r[0] + ' клиенту до терминала');
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
  // одноместная плашмя до Петербурга перевозка 10417.68 доставка 3047.5
  assert.equal(rub(r['Перевозка терминал–терминал']), 10418);
  assert.equal(rub(r['Доставка до адреса']), 3048);
  assert.equal(rub(r['Клиенту до адреса (×1.2)']), clientRound((10417.68 + 3047.5 + 3000) * 1.2));   // 19 800
  assert.equal(rub(r['Клиенту до терминала ПЭК (×1.2)']), clientRound((10417.68 + 3000) * 1.2));   // 16 200
});

test('строка про доплаты сайта pecom.ru', async () => {
  const { w } = page();
  setValue(w, 'model', 'one');
  await w.calcOne();
  assert.match(resultRows(w)['Сайт pecom.ru добавит сам'], /страхование груза/);
  setValue(w, 'strah', 500000);
  await w.calcOne();
  assert.match(resultRows(w)['Сайт pecom.ru добавит сам'], /учтена/);
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
  setValue(w, 'strah', 500000);
  await w.calcOne();
  const r = resultRows(w);
  assert.equal(rub(r['Страховка, доп. услуги ПЭК']), 710);
  assert.equal(rub(r['Клиенту до терминала ПЭК (×1.2)']), clientRound((10417.68 + 710 + 3000) * 1.2));
});

test('рохля 3000 ₽ за каждую кабину', async () => {
  const { w } = page();
  setValue(w, 'model', 'two');
  setValue(w, 'qty', 2);
  await w.calcOne();
  assert.match(resultRows(w)['Забор с производства'], /6\s?000/);
  assert.equal(w.totals({ auto: ['', '', 10000] }).own, 6000);
});

test('сверка Сходня → Челябинск: FOUR около 54 800 и SIX около 63 800 до адреса', async () => {
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
  const d = rub(resultRows(w)['Доставка до адреса']);
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
  const w = loadPage({ fast: true, fetchImpl: async () => { calls++; throw new Error('Failed to fetch'); } });
  await w.calcOne();
  assert.equal(calls, 3);
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
  const w = loadPage({ fast: true, fetchImpl: async (u, o) => { n++; if (n <= 3) throw new Error('обрыв'); return real(u, o); } });
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
