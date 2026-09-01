const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const run = async (name, vp, dark, steps) => {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    await page.goto('file://' + require('path').resolve(__dirname, '../index.html'));
    await page.waitForTimeout(800);
    let i = 0;
    await page.screenshot({ path: `tests/shots/${name}-${i++}.png` });
    for (const s of steps) {
      await s(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `tests/shots/${name}-${i++}.png` });
    }
    await ctx.close();
  };
  const mobile = { width: 390, height: 844 };
  await run('m', mobile, false, [
    p => p.click('text=Ich bin neu hier'),
    async p => { await p.fill('#f-name', 'Georg Oberhauser'); await p.click('text=Anmeldung abschicken'); },
    p => p.click('#demoBtn'),
    p => p.click('#enablePush'),
    p => p.click('.tab[data-tab="anliegen"]'),
    p => p.click('#anl-list [data-anl="2"]'),
    p => p.click('#sheet [data-join="2"]'),
    async p => { await p.fill('#cmt-in', 'Ich komm mit dem Traktor.'); await p.click('#cmt-send'); },
    p => p.click('#sheet [data-close]'),
    p => p.click('#anl-list [data-decline="1"]'),
    p => p.click('#anl-filter [data-f="abgelehnt"]'),
    p => p.click('#anl-list [data-restore="1"]'),
    p => p.click('#anl-filter [data-f="alle"]'),
    p => p.click('.tab[data-tab="kalender"]'),
    p => p.click('[data-day="26"]'),
    p => p.click('#dayBox [data-ev="6"]'),
    p => p.click('#sheet [data-going="6"]'),
    p => p.click('#sheet [data-close]'),
    p => p.click('#mNext'),
    p => p.click('[data-day="4"]'),
    p => p.click('#sheet [data-close]'),
    p => p.click('.tab[data-tab="dorf"]'),
    p => p.click('#betrieb-list .item >> nth=0'),
    p => p.click('#sheet [data-close]'),
    p => p.click('#verein-list .item >> nth=0'),
    p => p.click('#sheet [data-join-org]'),
    p => p.click('#sheet [data-demo-org]'),
    p => p.click('#sheet [data-post-as]'),
    async p => { await p.fill('#n-t', 'Notenständer gesucht'); await p.click('#n-send'); },
    p => p.click('.tab[data-tab="mitreden"]'),
    p => p.click('#poll-list [data-poll="1"] [data-vote="1"]'),
    p => p.click('.vote >> nth=1'),
    p => p.click('#meBtn'),
    p => p.click('#testPush'),
    p => p.click('[data-ok="0"]'),
    p => p.click('#sheet [data-close]'),
    p => p.click('.tab[data-tab="anliegen"]'),
    p => p.click('#fab'),
    async p => { await p.fill('#n-t', 'Zaun ausbessern'); await p.fill('#n-n', '3'); await p.click('#picker [data-pick="alm"]'); await p.click('#picker [data-pick="heu"]'); await p.fill('#n-l', 'krafttal.at/kinderweg'); },
    p => p.click('#n-send'),
    p => p.click('#anl-list .card >> nth=0'),
  ]);
  await run('d', { width: 1440, height: 900 }, false, [
    p => p.click('#loginBtn'),
  ]);
  await run('dk', { width: 1440, height: 900 }, true, [
    p => p.click('#loginBtn'),
    p => p.click('.tab[data-tab="mitreden"]'),
  ]);
  console.log('errors:', JSON.stringify(errors, null, 1));
  await browser.close();
})();
