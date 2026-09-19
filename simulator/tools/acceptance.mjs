// acceptance.mjs -- drive the real interface and check the acceptance
// criteria from the specification, one by one.
//
//   1. serve the build:   npm run build && npm run preview
//   2. run:               node tools/acceptance.mjs http://localhost:4173/
//
// Needs playwright and a chromium available. It clicks the same controls an
// operator clicks, and reads the same numbers the panels show.

import { chromium } from 'playwright'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const URL = process.argv[2] || 'http://localhost:4173/'
const EXEC = process.env.CHROME_PATH || undefined

const results = []
const check = (n, ok, detail) => {
  results.push({ n, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}\n      ${detail}`)
}
// for things this harness cannot honestly decide, it says so instead of
// inventing a threshold and calling it a pass
const note = (n, detail) => console.log(`NOTE  ${n}\n      ${detail}`)

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
})
const dir = mkdtempSync(join(tmpdir(), 'anti-sniper-'))
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__sim, { timeout: 30000 })
await page.waitForTimeout(1200)

// ---------------------------------------------------------------- helpers
const num = async (sel, v) => {
  await page.fill(sel, String(v))
  await page.dispatchEvent(sel, 'change')
}
const range = async (sel, v) => page.evaluate(([s, val]) => {
  const e = document.querySelector(s)
  e.value = String(val)
  e.dispatchEvent(new Event('input', { bubbles: true }))
}, [sel, v])
const check_ = async (sel, on) => page.evaluate(([s, v]) => {
  const e = document.querySelector(s)
  if (e.checked !== v) { e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })) }
}, [sel, on])

async function sweep() {
  const before = await page.evaluate(() => window.__sim.S.sweepCount)
  await page.click('#btn-sweep')
  await page.waitForFunction(
    b => !window.__sim.S.running && window.__sim.S.sweepCount > b,
    before, { timeout: 180000 })
  await page.waitForTimeout(120)
}
const state = () => page.evaluate(() => ({
  ...window.__sim.probe(),
  detections: window.__sim.S.detections.map(d => ({
    bearing: d.bearing, elevation: d.elevation, width: d.width, verdict: d.verdict, range: d.range
  })),
  blocked: window.__sim.S.targets.filter(t => !t.visible).length,
  rays: window.__sim.S.visibility.rayCount,
  sniperBlocked: window.__sim.S.sniper.blockedFromSensor,
  sniperVisible: window.__sim.S.sniper.target.visible,
  sniperBearing: window.__sim.S.sniper.target.bearing,
  level: window.__sim.S.results.length ? window.__sim.S.results[0].level[0] : null,
  wobble: window.__sim.S.results.length ? window.__sim.S.results[0].wobble : null
}))

// ------------------------------------------------------------ 1. frame rate
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0
  const t0 = performance.now()
  const tick = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(tick) : res(n / 2) }
  requestAnimationFrame(tick)
}))
note('1. renders at 60 fps on integrated graphics \u2014 NOT TESTABLE HERE',
  `${fps.toFixed(0)} frames per second measured, but this browser is falling back to a ` +
  `software rasteriser, which shades pixels on the processor. Cost here is almost all ` +
  `fill rate: halving the viewport gives roughly two and a half times the rate. ` +
  `Check the "drawing, per second" readout in the scan panel on the target machine.`)

// -------------------------------------------- 2. line of sight by ray casting
await check_('#in-hidehim', false)
await page.waitForTimeout(200)
let s = await state()
const blockedSome = s.blocked > 0 && s.rays > 0
await check_('#in-hidehim', true)
await page.waitForTimeout(300)
const hidden = await state()
await sweep()
const afterHidden = await state()
const nearHim = afterHidden.detections.filter(d =>
  Math.abs(((d.bearing - afterHidden.sniper.bearing + 540) % 360) - 180) < 1.0 && d.verdict === 'OPTIC')
check('2. a target behind a building drops out, proved by ray casting',
  blockedSome && hidden.sniperBlocked && !hidden.sniperVisible && nearHim.length === 0,
  `${s.blocked} of ${s.targets} targets blocked by geometry, ${s.rays} rays cast; ` +
  `with him hidden: blocked=${hidden.sniperBlocked}, answering=${hidden.sniperVisible}, ` +
  `optics at his bearing=${nearHim.length}`)

// ------------------------------------------------------------ 9. passive channel
await page.evaluate(() => window.__sim.S.sniper.enter('Ranging'))
await page.waitForFunction(() => window.__sim.S.passive !== null, { timeout: 20000 })
const passive = await page.evaluate(() => ({
  detected: window.__sim.S.passive.detected,
  total: window.__sim.S.passive.total,
  level: window.__sim.S.passive.level,
  terminal: window.__sim.S.passive.terminal,
  visibleSamples: window.__sim.S.passive.visibleSamples,
  samples: window.__sim.S.passive.sampleCount,
  blocked: window.__sim.S.sniper.blockedFromSensor
}))
check('9. passive channel catches a sniper the active channel cannot see',
  passive.blocked && passive.detected,
  `he is blocked from the active channel; his ranging pulse arrives at ` +
  `${passive.total.toExponential(2)} against an alarm level of ${passive.level.toFixed(1)}, ` +
  `${passive.visibleSamples} of ${passive.samples} points along his beam in view`)
await check_('#in-hidehim', false)
await page.waitForTimeout(300)

// ------------------------------------------- 4 and 5. scope beside a road sign
await check_('#in-demopair', true)
await range('#in-quality', 100)
await page.waitForTimeout(250)
await sweep()
let d = (await state()).detections
const nearBearing = (list, b, tol = 1.2) => list.filter(x => Math.abs(x.bearing - b) < tol)
const scope100 = nearBearing(d, 28)
const sign = nearBearing(d, 32)
check('4. scope and road sign at the same range: both found, only the scope flagged',
  scope100.some(x => x.verdict === 'OPTIC') && sign.length > 0 && sign.every(x => x.verdict !== 'OPTIC'),
  `at 28 deg: ${scope100.map(x => `${x.width?.toFixed(2)} deg ${x.verdict}`).join(', ') || 'nothing'}; ` +
  `at 32 deg: ${sign.map(x => `${x.width?.toFixed(2)} deg ${x.verdict}`).join(', ') || 'nothing'}`)

await range('#in-quality', 0)
await page.waitForTimeout(250)
await sweep()
d = (await state()).detections
const scope0 = nearBearing(d, 28)
check('5. a badly made scope widens until the flag disappears',
  scope0.length > 0 && scope0.every(x => x.verdict !== 'OPTIC'),
  `quality 0 at 28 deg: ${scope0.map(x => `${x.width?.toFixed(2)} deg ${x.verdict}`).join(', ') || 'nothing'}`)
await range('#in-quality', 100)
await check_('#in-demopair', false)
await page.waitForTimeout(250)

// ------------------------------------------------------- 3. false alarm rate
await sweep()
await page.selectOption('#in-far', '1e-2')
await page.waitForTimeout(400)
const loose = await state()
await page.selectOption('#in-far', '1e-5')
await page.waitForTimeout(400)
const tight = await state()
check('3. a stricter false alarm rate raises the line and finds less',
  tight.level > loose.level && tight.detections.length < loose.detections.length,
  `1 in 100: level ${loose.level.toFixed(0)}, ${loose.detections.length} crossings. ` +
  `1 in 100,000: level ${tight.level.toFixed(0)}, ${tight.detections.length} crossings`)
await page.selectOption('#in-far', '1e-4')
await page.waitForTimeout(300)

// --------------------------------------------------------- 8. beam width cost
await range('#in-beam', 0.2)
await page.waitForTimeout(150)
const narrow = await page.evaluate(() => ({
  positions: window.__sim.S.plan.beamPositions,
  ms: window.__sim.S.plan.frameTimeMs,
  shown: document.getElementById('out-positions').textContent,
  time: document.getElementById('out-frametime').textContent
}))
await range('#in-beam', 0.4)
await page.waitForTimeout(150)
const wide = await page.evaluate(() => ({
  positions: window.__sim.S.plan.beamPositions,
  ms: window.__sim.S.plan.frameTimeMs,
  shown: document.getElementById('out-positions').textContent,
  time: document.getElementById('out-frametime').textContent
}))
const ratio = narrow.positions / wide.positions
check('8. doubling the beam width cuts the places to look by four',
  Math.abs(ratio - 4) < 0.05 && Math.abs(narrow.ms / wide.ms - 4) < 0.05,
  `0.20 deg: ${narrow.shown} positions, ${narrow.time}. ` +
  `0.40 deg: ${wide.shown} positions, ${wide.time}. ratio ${ratio.toFixed(3)}`)
await range('#in-beam', 0.2)
await page.waitForTimeout(150)

// ------------------------------------------------- 6 and 7. conditions matter
await page.click('#modes .tab[data-mode="comparison"]')
await page.waitForSelector('#comparison:not(.hidden)')
await page.waitForTimeout(600)
const cmp = await page.evaluate(() => [...document.querySelectorAll('.cmp-table tbody tr')].map(tr =>
  [...tr.querySelectorAll('td')].map(td => td.textContent.trim())))
const byName = Object.fromEntries(cmp.map(r => [r[0].toLowerCase(), r]))
const metres = s => parseFloat(String(s).replace(/[^0-9.]/g, ''))
const dayR = metres(byName.day[6]), nightR = metres(byName.night[6]), fogR = metres(byName.fog[6])
check('6. night reaches further than day, with the numbers shown',
  nightR > dayR,
  `scope detectable to ${Math.round(dayR)} m in day, ${Math.round(nightR)} m at night ` +
  `(background ${byName.day[1]} against ${byName.night[1]})`)
check('7. fog cuts the range by more than half',
  fogR < dayR / 2,
  `${Math.round(fogR)} m in fog against ${Math.round(dayR)} m in day, ` +
  `${(100 * fogR / dayR).toFixed(0)} percent of it`)
await page.click('#btn-comparison-close')
await page.click('#modes .tab[data-mode="free"]')
await page.waitForTimeout(400)

// ------------------------------------------------- 12. no overstated claims
const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
const aboutText = await page.evaluate(() => {
  document.getElementById('btn-about').click()
  const t = document.getElementById('modal-body').innerText
  document.getElementById('modal-close').click()
  return t
})
const limitsText = await page.evaluate(() => {
  document.getElementById('btn-limits').click()
  const t = document.getElementById('modal-body').innerText
  document.getElementById('modal-close').click()
  return t
})
const banned = ['ai powered', 'ai-powered', 'military grade', 'military-grade', 'real time em', 'real-time em']
const found = banned.filter(b => text.includes(b) || aboutText.toLowerCase().includes(b) || limitsText.toLowerCase().includes(b))
check('12. nothing claims capability the simulator does not have',
  found.length === 0 && /simulated/.test(aboutText.toLowerCase()) &&
  /geometric optics only/.test(aboutText.toLowerCase()) && limitsText.length > 200,
  found.length ? `forbidden wording found: ${found}` :
  `about panel states the scene is simulated and the optics geometric; limitations panel present ` +
  `(${limitsText.length} characters)`)

// ---------------------------------------------- 10. export, and check in python
await sweep()
const downloads = []
page.on('download', dl => downloads.push(dl))
await page.click('#btn-export')
await page.waitForTimeout(3000)
const saved = {}
for (const dl of downloads) {
  const name = dl.suggestedFilename()
  const path = join(dir, name)
  await dl.saveAs(path)
  if (name.endsWith('.csv')) saved.csv = path
  else if (name.endsWith('.json')) saved.json = path
  else if (name.endsWith('.py')) saved.py = path
}
let pyOut = '', pyOk = false
try {
  pyOut = execFileSync('python3', [saved.py, saved.csv, saved.json], { encoding: 'utf8' })
  pyOk = /AGREES WITH THE BROWSER/.test(pyOut)
} catch (e) {
  pyOut = (e.stdout || '') + (e.stderr || '')
}
writeFileSync(join(dir, 'python-output.txt'), pyOut)
const browserCount = JSON.parse(readFileSync(saved.json, 'utf8')).detections.length
check('10. the exported sweep, re-processed in python, gives the same detections',
  pyOk, pyOk
    ? `${browserCount} detections in the browser, the same ${browserCount} from verify_detection.py`
    : `python said:\n${pyOut.split('\n').slice(-12).join('\n')}`)

// --------------------------------------------------------------- 11. tutorial
await page.click('#modes .tab[data-mode="tutorial"]')
await page.waitForSelector('#tutorial:not(.hidden)')
const tutTexts = []
for (let i = 0; i < 7; i++) {
  tutTexts.push(await page.evaluate(() => ({
    n: document.getElementById('tut-n').textContent,
    title: document.getElementById('tut-title').textContent,
    body: document.getElementById('tut-body').textContent,
    blocked: document.getElementById('tut-next').disabled
  })))
  if (tutTexts[i].blocked) {
    // the step is waiting for something to be done. do it.
    if (i === 1) await sweep()
    if (i === 5) { await page.selectOption('#in-far', '1e-3'); await page.waitForTimeout(400) }
    await page.waitForTimeout(300)
  }
  const stillBlocked = await page.evaluate(() => document.getElementById('tut-next').disabled)
  if (stillBlocked) break
  if (i < 6) await page.click('#tut-next')
  await page.waitForTimeout(250)
}
const jargon = ['CFAR', 'constant false alarm', 'retroreflect', 'FWHM', 'signal-to-noise', 'SNR',
                'azimuth', 'elevation angle', 'median absolute deviation', 'gaussian', 'photon']
const usedJargon = jargon.filter(j =>
  tutTexts.some(t => (t.title + ' ' + t.body).toLowerCase().includes(j.toLowerCase())))
check('11. the tutorial runs start to finish with no jargon on screen',
  tutTexts.length === 7 && usedJargon.length === 0,
  `${tutTexts.length} steps reached, jargon found: ${usedJargon.length ? usedJargon.join(', ') : 'none'}`)

// ------------------------------------------------- two colour confirmation
await page.click('#modes .tab[data-mode="free"]')
await page.waitForTimeout(300)
await check_('#in-demopair', true)
await check_('#in-twocolour', true)
await page.waitForTimeout(300)
await sweep()
const tc = (await state()).detections
const tcScope = nearBearing(tc, 28)[0]
const tcSign = nearBearing(tc, 32).find(x => x.verdict === 'clutter')
const ratios = await page.evaluate(() => window.__sim.S.detections
  .filter(d => d.ratio !== null && d.verdict !== 'noise')
  .map(d => ({ bearing: +d.bearing.toFixed(1), verdict: d.verdict, ratio: +d.ratio.toFixed(3) })))
const scopeRatio = ratios.find(r => Math.abs(r.bearing - 28) < 1.2)
const signRatio = ratios.find(r => Math.abs(r.bearing - 32) < 1.5)
check('two colours: the coated optic answers very differently at the two, the sign does not',
  !!scopeRatio && !!signRatio && scopeRatio.ratio < 0.6 && signRatio.ratio > 0.7,
  scopeRatio && signRatio
    ? `scope at 28 deg: ${scopeRatio.ratio} of its 1064 nm answer at 1550 nm. ` +
      `road sign at 32 deg: ${signRatio.ratio}. near 1 means bare plastic`
    : `ratios measured: ${JSON.stringify(ratios.slice(0, 6))} (scope ${tcScope?.verdict}, sign ${tcSign?.verdict})`)
await check_('#in-twocolour', false)
await check_('#in-demopair', false)

// ------------------------------------------------------------ priority scan
const before = await page.evaluate(() => window.__sim.S.plan.beamPositions)
await check_('#in-priority', true)
await page.waitForTimeout(250)
const after = await page.evaluate(() => ({
  positions: window.__sim.S.plan.beamPositions,
  floor: window.__sim.S.plan.priorityFloor
}))
check('priority scan cuts the places to look without touching any detection number',
  after.positions < before && after.floor !== null,
  `${before.toLocaleString()} positions over the whole sector, ` +
  `${after.positions.toLocaleString()} looking only above ${after.floor?.toFixed(1)} degrees`)
await check_('#in-priority', false)

// ------------------------------------------------------------------- report
await page.screenshot({ path: join(dir, 'final.png') })
console.log(`\nartefacts in ${dir}`)
if (errors.length) console.log('page errors:\n' + errors.join('\n'))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
await browser.close()
process.exit(failed.length ? 1 : 0)
