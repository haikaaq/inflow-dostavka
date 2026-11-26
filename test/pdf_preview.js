// делает образцы pdf для клиента тем же кодом что на сайте и кладёт их в папку из аргумента
// запуск  node test/pdf_preview.js папка
const fs = require('fs');
const path = require('path');
const pdfMake = require('pdfmake/build/pdfmake');
const vfs = require('pdfmake/build/vfs_fonts');
pdfMake.vfs = (vfs.pdfMake && vfs.pdfMake.vfs) || vfs.vfs || vfs;
const { loadPage, readFixture, fixtureFetch, setValue } = require('./lib');

const out = process.argv[2] || '.';
const cab = readFixture('cabinet_one_spb_2026-11-26.json').response;
async function sample(name, setup) {
  const w = loadPage({ fetchImpl: fixtureFetch({ requests: {} }, [], cab, []) });
  setup(w);
  await w.calcOne();
  const dd = w.buildCheck(w.eval('lastCheck'), w.document.querySelector('.top img').src);
  await new Promise(ok => pdfMake.createPdf(dd).getBuffer(b => { fs.writeFileSync(path.join(out, name), Buffer.from(b)); ok(); }));
  console.log(name, w.checkFileName(w.eval('lastCheck')));
}
(async () => {
  await sample('check_one.pdf', w => { setValue(w, 'model', 'one'); setValue(w, 'price', 325000); setValue(w, 'pack', 28000); });
  await sample('check_multi.pdf', w => {
    setValue(w, 'price', 400000);
    const el = w.addLine(); const s = el.querySelector('.model'); s.value = 'six'; s.dispatchEvent(new w.Event('change', { bubbles: true }));
    const p = el.querySelector('.price'); p.value = '640000'; p.dispatchEvent(new w.Event('input', { bubbles: true }));
    el.querySelector('.plus').click();
    setValue(w, 'take', true);
    setValue(w, 'to', 'Санкт-Петербург, Пискарёвский проспект, дом 2, корпус 2, литера Щ, бизнес-центр «Бенуа», офис 512');
  });
})();
