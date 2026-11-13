// Checks that an incoming result never replaces what someone is reading or typing.
const {chromium} = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({viewport: {width: 760, height: 800}});
  await page.addInitScript({path: path.join(__dirname, 'mock-host.js')});
  await page.goto('file://' + path.resolve(__dirname, '../../UI/index.html')); await page.waitForTimeout(300);
  const results = [], check = (name, ok) => results.push((ok ? 'pass' : 'FAIL') + '  ' + name);
  const arrive = id => page.evaluate(id => window.setInbox({channel: 'incoming', items: [{id, source: 'Grok Bot', title: 'New', summary: 'Updated notes.md.', time: Date.now() / 1000 + 5, read: false, thread: '', link: ''}]}), id);
  await page.click('#boardMore'); await page.click('#peekLatest'); await page.click('#latestCard .result-preview');
  const reading = await page.getAttribute('#latestCard article', 'data-notice');
  await arrive('n1');
  check('expanded latest result stays while a newer one arrives', await page.getAttribute('#latestCard article', 'data-notice') === reading);
  check('"Show newer result" is offered', await page.isVisible('#newerResult'));
  check('focus did not move', await page.evaluate(() => document.activeElement.classList.contains('result-preview')));
  await page.click('#newerResult');
  check('newer result shown on request', await page.getAttribute('#latestCard article', 'data-notice') === 'n1');
  await page.click('.row >> nth=1 >> .task-body'); await page.fill('#fieldTitle', 'Half-typed title');
  await arrive('n2'); await page.evaluate(() => window.openInbox('edge'));
  check('task draft survives an incoming result and an inbox request from the panel', await page.inputValue('#fieldTitle') === 'Half-typed title');
  await page.keyboard.press('Escape'); await page.click('#inboxButton');
  await page.click('#inboxCards .result-card[data-notice="c1/t3"] .result-preview');
  await arrive('n3');
  check('open inbox card stays expanded when the list updates', await page.getAttribute('#inboxCards .result-card[data-notice="c1/t3"] .result-preview', 'aria-expanded') === 'true');
  check('new card is added to the inbox', await page.isVisible('#inboxCards .result-card[data-notice="n3"]'));
  console.log(results.join('\n')); await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
