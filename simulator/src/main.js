// main.js -- boot, and the loop that ties the world to the detector.
//
// Order of business, every sweep:
//   1. cast a ray at every target, so we know what is actually in view
//   2. walk the raster, one line of azimuth at a time, building a trace
//   3. run the five detection steps on each line
//   4. gather what crossed the alarm line, measure it, and say what it is

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { buildCity } from './world/city.js'
import { buildProps } from './world/props.js'
import { createLighting, applyPreset, PRESETS } from './world/lighting.js'

import { makeRng } from './rng.js'
import { placeTargets, makeTargetMarkers, makeTarget, activeTargets, scopeWidthFor } from './sim/targets.js'
import { makeVisibility } from './sim/visibility.js'
import { planSweep, Sweeper, sweepRow } from './sim/sweep.js'
import { detect, localBackground, kFor, WINDOW_DEG } from './sim/detect.js'
import { returnPower, detectionRange, angleDiff } from './sim/optics.js'
import { pulseReturn, passiveThreshold, passiveBackground } from './sim/passive.js'
import { Sniper, makeSniperMarker } from './sim/sniper.js'

import { createHud } from './ui/hud.js'
import { createTracePanel } from './ui/panels/trace.js'
import { createWaterfall } from './ui/panels/waterfall.js'
import { createPolar } from './ui/panels/polar.js'
import { createDetectionsTable } from './ui/panels/detections.js'
import { createTutorial } from './ui/panels/tutorial.js'
import { exportRun, exportForPython } from './export.js'

// ------------------------------------------------------------------ three
const canvas = document.getElementById('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 6000)
camera.position.set(255, 170, 310)
const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 26, 0)
controls.maxPolarAngle = Math.PI * 0.495
controls.enableDamping = true
controls.maxDistance = 1800

const lighting = createLighting(scene)

// ------------------------------------------------------------------- state
const hud = createHud()
const trace = createTracePanel(document.getElementById('cv-trace'))
const waterfall = createWaterfall(
  document.getElementById('cv-waterfall'), document.getElementById('cv-colourbar'),
  document.getElementById('cb-lo'), document.getElementById('cb-hi'))
const polar = createPolar(document.getElementById('cv-polar'))
const table = createDetectionsTable(document.getElementById('tbl-detections'))
const tutorial = createTutorial({
  root: document.getElementById('tutorial'), n: document.getElementById('tut-n'),
  title: document.getElementById('tut-title'), body: document.getElementById('tut-body'),
  next: document.getElementById('tut-next'), back: document.getElementById('tut-back'),
  quit: document.getElementById('tut-quit')
}, { startHunt: () => setMode('hunt') })

const S = {
  cfg: hud.read(),
  preset: PRESETS.night,
  mode: 'free',
  world: null, props: null, targets: [], visibility: null, markers: null,
  sniper: null, sniperMarker: null,
  plan: null, sweeper: null, running: false, paused: false, singleStep: false,
  rows: [], results: [], detections: [], sweepCount: 0,
  viewRow: 0, followRow: true,
  lastRun: null, passive: null, passiveEvents: [],
  hunt: null, selected: null,
  beamAz: 0, beamEl: 4
}

// the sniper's pulse, drawn for a moment when it happens
const pulseLine = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)),
  new THREE.LineBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending })
)
pulseLine.frustumCulled = false
scene.add(pulseLine)
let pulseFade = 0

// ------------------------------------------------------------------ build
function buildScene() {
  if (S.markers) S.markers.dispose()
  if (S.props) S.props.dispose()
  if (S.world) S.world.dispose()
  if (S.sniperMarker) S.sniperMarker.dispose()

  const seed = S.cfg.seed | 0
  S.world = buildCity(scene, seed)
  S.props = buildProps(scene, S.world, seed)
  S.world.vehiclePositions = S.props.vehicles.map(v => v.position)
  S.visibility = makeVisibility([...S.world.occluders, ...S.props.occluders])

  const rng = makeRng(seed ^ 0x51ed)
  S.targets = placeTargets(S.world, rng, S.visibility)

  S.sniper = new Sniper({
    world: S.world, visibility: S.visibility, rng,
    quality: S.cfg.quality, magnification: S.cfg.magnification,
    difficulty: 'normal', hideFromSensor: S.cfg.hideHim,
    occupied: S.targets.map(t => t.position)
  })
  S.targets.push(S.sniper.target)
  S.sniperMarker = makeSniperMarker(scene)

  applyDemoPair(rng)

  S.markers = makeTargetMarkers(scene)
  S.markers.setVisible(S.cfg.showRays)

  applyPreset({ scene, renderer, lighting, world: S.world, props: S.props }, S.preset.key)
  refreshVisibility()
  resetSweepData()
  hud.toast(`City rebuilt from seed ${seed}. ${S.world.buildings.length} buildings, ${S.targets.length} things that reflect.`)
}

// A scope and a road sign at the same range, a few degrees apart. Both are
// detected. Only one of them is narrow.
let demoTargets = []
function applyDemoPair(rng) {
  demoTargets.forEach(t => {
    const i = S.targets.indexOf(t)
    if (i >= 0) S.targets.splice(i, 1)
  })
  demoTargets = []
  if (!S.cfg.demoPair) return
  const r = 260, bearing = 28 * Math.PI / 180
  const base = new THREE.Vector3(
    S.world.sensorPos.x + Math.sin(bearing) * r, 26,
    S.world.sensorPos.z - Math.cos(bearing) * r)
  const b2 = (28 + 4) * Math.PI / 180
  const other = new THREE.Vector3(
    S.world.sensorPos.x + Math.sin(b2) * r, 26,
    S.world.sensorPos.z - Math.cos(b2) * r)
  const a = makeTarget('scope', base, rng, { id: 'DEMO-SCOPE', width: scopeWidthFor(S.cfg.quality) })
  const b = makeTarget('road_sign', other, rng, { id: 'DEMO-SIGN' })
  a.isDemo = b.isDemo = true
  // this pair is a demonstration, so it is not hidden by anything
  a.forceVisible = b.forceVisible = true
  demoTargets = [a, b]
  S.targets.push(a, b)
}

function refreshVisibility() {
  S.visibility.resetCount()
  S.visibility.update(S.targets, S.world.sensorPos)
  for (const t of S.targets) if (t.forceVisible) t.visible = true
  if (S.markers) S.markers.update(S.targets, S.world.sensorPos)
}

function resetSweepData() {
  S.rows = []; S.results = []; S.detections = []; S.sweeper = null
  S.running = false; S.viewRow = 0
  table.clear()
  trace.draw(null)
  waterfall.reset()
  hud.setSweepButton(false)
  hud.setVerdict('searching', 'SEARCHING')
}

// ----------------------------------------------------------------- sweeping
function currentPlan() {
  return planSweep({
    azMin: S.cfg.azMin, azMax: S.cfg.azMax, elMin: S.cfg.elMin, elMax: S.cfg.elMax,
    beamWidth: S.cfg.beamWidth, dwellMs: S.cfg.dwellMs, priority: S.cfg.priority,
    world: S.world
  })
}

function startSweep() {
  refreshVisibility()
  S.plan = currentPlan()
  hud.setPlan(S.plan)
  S.rows = []; S.results = []; S.detections = []
  S.sweeper = new Sweeper({
    plan: S.plan, targets: activeTargets(S.targets, S.preset.key),
    preset: S.preset, seed: (S.cfg.seed * 7919 + S.sweepCount * 104729) >>> 0,
    twoColour: S.cfg.twoColour
  })
  S.running = true
  S.paused = false
  S.followRow = true
  S.selected = null
  hud.setSweepButton(true)
}

function processRows(budgetMs) {
  const t0 = performance.now()
  while (S.sweeper && !S.sweeper.done && performance.now() - t0 < budgetMs) {
    const row = S.sweeper.nextRow()
    if (!row) break
    const res = detect({
      angles: S.plan.angles, power: row.power, stepDeg: S.plan.azStep,
      far: S.cfg.far, cutoff: S.cfg.cutoff, windowDeg: WINDOW_DEG,
      minSeparationDeg: Math.max(1.5, S.plan.beamWidth * 6), beamWidth: S.plan.beamWidth
    })
    if (row.alt) res.altBackground = localBackground(row.alt, S.plan.azStep, WINDOW_DEG)
    S.rows.push(row)
    S.results.push(res)
    S.viewRow = row.index
    if (S.singleStep) { S.singleStep = false; S.paused = true; break }
  }
  if (S.sweeper && S.sweeper.done) finishSweep()
}

function finishSweep() {
  S.running = false
  S.sweepCount++
  hud.setSweepButton(false)
  hud.setSweepCount(S.sweepCount)

  gatherDetections()

  // one waterfall line per sweep: the strongest return at each azimuth
  const best = new Float64Array(S.plan.nAz)
  for (const r of S.rows) for (let i = 0; i < S.plan.nAz; i++) if (r.power[i] > best[i]) best[i] = r.power[i]
  const lo = Math.log10(Math.max(1, S.preset.backgroundLevel * 0.7))
  let hi = lo + 1
  for (let i = 0; i < best.length; i++) hi = Math.max(hi, Math.log10(Math.max(1, best[i])))
  waterfall.setRange(lo, Math.max(lo + 1, hi))
  waterfall.push(best)

  // did the beam go over him? he may take the hint and move
  const nearHim = S.detections.some(d =>
    Math.abs(angleDiff(d.bearing, S.sniper.target.bearing)) < 1.0 && d.verdict === 'OPTIC')
  S.sniper.noteSweep(nearHim)

  // Show the line of the raster that has something in it, rather than
  // whichever one happened to be last.
  let bestRow = S.viewRow, bestScore = -Infinity
  S.results.forEach((res, i) => {
    for (const pk of res.peaks) {
      const score = (pk.verdict === 'OPTIC' ? 1e6 : pk.verdict === 'clutter' ? 1e3 : 1) * pk.above
      if (score > bestScore) { bestScore = score; bestRow = i }
    }
  })
  S.viewRow = bestRow
  S.followRow = false

  S.lastRun = makeRunRecord()
  tutorial.notify('sweep')
  drawTrace()
}

// Everything that crossed the alarm line, gathered across the rows, with the
// duplicates from neighbouring elevation lines merged into one.
function gatherDetections() {
  const all = []
  S.results.forEach((res, ri) => {
    const row = S.rows[ri]
    for (const p of res.peaks) {
      all.push({
        ...p, elevation: row.elevation, rowIndex: ri,
        bearing: p.azimuth,
        ratio: null
      })
    }
  })
  all.sort((a, b) => b.above - a.above)

  // The same object answers in several neighbouring lines of the raster, and
  // a wide one answers in many. Merge by how wide the return actually is, so
  // one road sign is one row in the table rather than eleven.
  const kept = []
  for (const d of all) {
    const near = kept.some(k => {
      const w = Math.max(k.width || 0, d.width || 0, S.plan.beamWidth * 2)
      return Math.abs(angleDiff(k.bearing, d.bearing)) < w * 1.2 &&
             Math.abs(k.elevation - d.elevation) < w * 1.6
    })
    if (!near) kept.push(d)
  }

  const act = activeTargets(S.targets, S.preset.key)
  kept.forEach((d, i) => {
    d.id = `D${i}`
    // Range from the time of flight of the return: the strength weighted
    // mean range of whatever is answering in that direction. A peak that is
    // only noise has no range at all, and that is worth knowing.
    d.range = measureRange(act, d.bearing, d.elevation)
    if (S.cfg.twoColour) {
      const res = S.results[d.rowIndex], row = S.rows[d.rowIndex]
      if (row.alt && res.altBackground) {
        const above1064 = d.above
        const above1550 = row.alt[d.index] - res.altBackground[d.index]
        d.ratio = above1064 > 0 ? above1550 / above1064 : null
      }
    }
  })

  S.detections = kept.sort((a, b) => a.bearing - b.bearing)
  table.set(S.detections)

  const optics = S.detections.filter(d => d.verdict === 'OPTIC')
  const real = S.detections.filter(d => d.verdict === 'clutter')
  const noise = S.detections.filter(d => d.verdict === 'noise' || d.verdict === 'unknown')
  if (optics.length) hud.setVerdict('optic', `OPTIC DETECTED  x${optics.length}`)
  else if (real.length) hud.setVerdict('clutter', 'CLUTTER ONLY')
  else hud.setVerdict('searching', 'SEARCHING')
  hud.setCounts(optics.length, real.length, noise.length)

  const mid = S.results[Math.min(S.results.length - 1, Math.floor(S.results.length / 2))]
  if (mid) {
    hud.setDetector({
      wobble: mid.wobble, level: mid.level[0], background: mid.background[0], k: mid.k
    })
    hud.setExplainState({ k: mid.k, wobble: mid.wobble })
  }
}

function measureRange(targets, az, el) {
  let num = 0, den = 0
  for (const t of targets) {
    if (!t.visible) continue
    const p = returnPower(t, az, el, S.plan.beamWidth, S.preset.extinction)
    if (p <= 0) continue
    num += p * t.range
    den += p
  }
  if (den <= S.preset.noiseSigma * 0.5) return null      // nothing real answered
  return num / den
}

function makeRunRecord() {
  const k = kFor(S.cfg.far)
  return {
    plan: S.plan, rows: S.rows, results: S.results, detections: S.detections,
    settings: {
      seed: S.cfg.seed, preset: S.preset.key,
      backgroundLevel: S.preset.backgroundLevel, noiseSigma: S.preset.noiseSigma,
      extinction: S.preset.extinction, far: S.cfg.far, k,
      cutoff: S.cfg.cutoff, windowDeg: WINDOW_DEG,
      minSeparationDeg: Math.max(1.5, S.plan.beamWidth * 6),
      twoColour: S.cfg.twoColour, quality: S.cfg.quality, magnification: S.cfg.magnification
    },
    passive_channel: S.passiveEvents.slice(),
    truth: {
      note: 'what was really there, for checking only. the detector never reads this.',
      sniper: {
        state: S.sniper.state, position: S.sniper.position.toArray().map(v => +v.toFixed(2)),
        bearing_deg: +S.sniper.target.bearing.toFixed(3),
        elevation_deg: +S.sniper.target.elevation.toFixed(3),
        range_m: +S.sniper.target.range.toFixed(1),
        scope_width_deg: +S.sniper.target.width.toFixed(3),
        visible_to_sensor: !S.sniper.blockedFromSensor,
        answering_our_beam: S.sniper.target.visible
      },
      targets: activeTargets(S.targets, S.preset.key).map(t => ({
        id: t.id, kind: t.kind, bearing_deg: +t.bearing.toFixed(3),
        elevation_deg: +t.elevation.toFixed(3), range_m: +t.range.toFixed(1),
        width_deg: +t.width.toFixed(3), strength: t.strength,
        colour_ratio: +t.colourRatio.toFixed(3), visible: t.visible
      }))
    },
    scoring: S.hunt ? { ...S.hunt, sniper: undefined } : null
  }
}

// ------------------------------------------------------------------- draw
function drawTrace() {
  const ri = Math.min(S.viewRow, S.rows.length - 1)
  if (ri < 0) { trace.draw(null); return }
  const row = S.rows[ri], res = S.results[ri]
  const peaks = res.peaks.map(p => ({
    ...p, selected: S.selected && Math.abs(angleDiff(p.azimuth, S.selected.bearing)) < 0.3
  }))
  trace.draw({
    angles: S.plan.angles, power: row.power, background: res.background,
    level: res.level, peaks, cutoff: S.cfg.cutoff,
    note: `elevation ${row.elevation.toFixed(1)} deg   wobble ${res.wobble.toFixed(0)}   ` +
          `level ${(res.level[0]).toFixed(0)}   ${S.preset.label.toLowerCase()}`
  })
  hud.setRowLabel(row.elevation)
  hud.setRowIndex(ri)
}

function drawPolar() {
  polar.draw({
    detections: S.detections.map(d => ({ ...d, selected: S.selected && d.id === S.selected.id })),
    maxRange: 800, sweepAz: S.running ? S.beamAz : null,
    sector: [S.cfg.azMin, S.cfg.azMax],
    passive: S.passive
  })
}

// ---------------------------------------------------------------- passive
function handlePulse() {
  const k = kFor(S.cfg.far)
  const res = pulseReturn({
    from: S.sniper.position, to: S.world.protectedPos, sensorPos: S.world.sensorPos,
    visibility: S.visibility, extinction: S.preset.extinction, wavelengthNm: 1064
  })
  const level = passiveThreshold(S.preset, k)
  res.level = level
  res.detected = res.total > level
  S.passive = res
  S.passiveEvents.push({
    at_second: +((performance.now() - (S.hunt ? S.hunt.startedAt : 0)) / 1000).toFixed(1),
    total: res.total, alarm_level: res.level, detected: res.detected,
    terminal_spot: res.terminal, scattered_along_his_beam: res.scattered,
    points_of_his_beam_in_view: res.visibleSamples, points_sampled: res.sampleCount,
    bearing_of_the_far_end_deg: res.bearingHint ? +res.bearingHint.bearing.toFixed(2) : null
  })
  if (S.passiveEvents.length > 40) S.passiveEvents.shift()

  // draw his beam for a moment
  const p = pulseLine.geometry.attributes.position
  p.setXYZ(0, S.sniper.position.x, S.sniper.position.y, S.sniper.position.z)
  p.setXYZ(1, S.world.protectedPos.x, S.world.protectedPos.y, S.world.protectedPos.z)
  p.needsUpdate = true
  pulseFade = 1.2

  if (res.detected) {
    const hint = res.bearingHint
    hud.setScene({
      passive: `PULSE  ${res.total.toExponential(1)} > ${level.toFixed(0)}`
    })
    hud.toast(
      `Passive channel: a rangefinder pulse ended here. ${res.visibleSamples} of ${res.sampleCount} ` +
      `points along his beam were in view` +
      (hint ? `, the far end of it lies at bearing ${hint.bearing.toFixed(1)} deg.` : '.'),
      6000)
    if (S.hunt && !S.hunt.passiveAt) S.hunt.passiveAt = performance.now()
  } else {
    hud.setScene({ passive: `pulse too weak (${res.total.toFixed(0)} < ${level.toFixed(0)})` })
  }
}

// ------------------------------------------------------------------ modes
function setMode(mode) {
  S.mode = mode
  hud.setMode(mode)
  hud.hideComparison()
  if (mode !== 'hunt') { S.hunt = null; hud.setHunt({ show: false }) }
  if (mode === 'tutorial') {
    tutorial.start()
    hud.setPreset('night'); setPreset('night')
  } else {
    tutorial.quit()
  }
  if (mode === 'hunt') startHunt()
  if (mode === 'comparison') runComparison()
}

function startHunt() {
  buildScene()
  S.sniper.enter('Hidden')
  S.hunt = {
    startedAt: performance.now(), falseAlarms: 0, flagged: null,
    detectedAt: null, passiveAt: null, outcome: null
  }
  hud.setHunt({ show: true, falseAlarms: 0, msg: 'Find him before he fires.' })
  hud.toast('Hunt: a sniper is on one of these rooftops. Sweep, read the widths, flag him.', 6000)
}

function flagSelected() {
  const d = table.selected
  if (!d) { hud.toast('Pick a row in the detections table first.'); return }
  S.selected = d
  const truth = S.sniper.target
  const close = Math.abs(angleDiff(d.bearing, truth.bearing)) < 1.2 &&
                Math.abs(d.elevation - truth.elevation) < 2.0
  if (close) {
    S.sniperMarker.show(S.sniper.position)
    if (S.hunt) {
      S.hunt.flagged = 'correct'
      S.hunt.detectedAt = performance.now()
      S.hunt.outcome = 'prevented'
      const secs = (S.hunt.detectedAt - S.hunt.startedAt) / 1000
      hud.setHunt({
        show: true, msg: `Found him in ${secs.toFixed(1)} s. Shot prevented.`,
        falseAlarms: S.hunt.falseAlarms
      })
      hud.showModal(scoreCard(secs, true))
    } else {
      hud.toast('That is him. Marked on the rooftop.')
    }
  } else {
    if (S.hunt) { S.hunt.falseAlarms++; hud.setHunt({ show: true, falseAlarms: S.hunt.falseAlarms }) }
    hud.toast(`Not him. Bearing ${d.bearing.toFixed(1)} deg, width ` +
      `${d.width === null ? 'unmeasurable' : d.width.toFixed(2) + ' deg'}. A false alarm costs you.`)
  }
}

function scoreCard(secs, prevented) {
  const h = S.hunt || {}
  return `<h3>Hunt result</h3>
    <ul>
      <li>Time to detection: <b>${secs.toFixed(1)} s</b></li>
      <li>Correct target flagged: <b>${h.flagged === 'correct' ? 'yes' : 'no'}</b></li>
      <li>False alarms raised: <b>${h.falseAlarms || 0}</b></li>
      <li>Shot prevented: <b>${prevented ? 'yes' : 'NO'}</b></li>
      <li>Passive channel caught his ranging pulse: <b>${h.passiveAt ? 'yes' : 'no'}</b></li>
      <li>Sweeps run: <b>${S.sweepCount}</b></li>
    </ul>
    <p class="assumed">A simulated result against a simulated opponent.</p>`
}

// Same scene, same targets, four sets of conditions, side by side.
function runComparison() {
  const plan = currentPlan()
  refreshVisibility()
  const k = kFor(S.cfg.far)
  const rows = []
  const el = S.sniper.target.elevation

  for (const key of ['day', 'dusk', 'night', 'fog']) {
    const preset = PRESETS[key]
    const targets = activeTargets(S.targets, key)
    const rng = makeRng((S.cfg.seed * 31 + key.length * 977) >>> 0)
    const power = sweepRow(targets, el, plan, preset, rng)
    const res = detect({
      angles: plan.angles, power, stepDeg: plan.azStep, far: S.cfg.far,
      cutoff: S.cfg.cutoff, minSeparationDeg: Math.max(1.5, plan.beamWidth * 6),
      beamWidth: plan.beamWidth
    })
    const threshold = res.wobble * k
    rows.push({
      key, label: preset.label, wobble: res.wobble,
      background: preset.backgroundLevel, level: res.level[0],
      detections: res.peaks.filter(p => p.verdict !== 'noise').length,
      optics: res.peaks.filter(p => p.verdict === 'OPTIC').length,
      scopeRange: detectionRange(9.0e6, preset.extinction, threshold),
      signRange: detectionRange(3.0e4, preset.extinction, threshold),
    })
  }
  const night = rows.find(r => r.key === 'night'), day = rows.find(r => r.key === 'day')
  const fog = rows.find(r => r.key === 'fog')
  hud.showComparison(`
    <table class="cmp-table">
      <thead><tr><th>Conditions</th><th>Background</th><th>Wobble</th><th>Alarm level</th>
      <th>Returns found</th><th>Called optic</th><th>Scope detectable to</th><th>Road sign to</th></tr></thead>
      <tbody>
      ${rows.map(r => `<tr${r.key === S.preset.key ? ' class="sel"' : ''}>
        <td>${r.label}</td><td>${r.background.toLocaleString()}</td>
        <td>${r.wobble.toFixed(0)}</td><td>${r.level.toFixed(0)}</td>
        <td>${r.detections}</td><td>${r.optics}</td>
        <td>${Math.round(r.scopeRange)} m</td><td>${Math.round(r.signRange)} m</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="note">One line of the raster at elevation ${el.toFixed(1)} degrees, the same targets in
    all four, only the conditions changed. Night reaches
    <b>${(night.scopeRange / day.scopeRange).toFixed(2)} times</b> further than day for the same scope.
    Fog cuts it to <b>${(100 * fog.scopeRange / day.scopeRange).toFixed(0)} percent</b> of the day figure.</p>
    <p class="assumed">Background, wobble and extinction are assumed figures. The ranges are where the
    return would fall to the alarm level, computed from the same formula the sweep uses.</p>`)
}

// ------------------------------------------------------------------ events
hud.on('sweep', () => { if (!S.running) startSweep() })
hud.on('pause', () => { S.paused = !S.paused; hud.toast(S.paused ? 'Paused.' : 'Running.') })
hud.on('step', () => {
  if (!S.sweeper || S.sweeper.done) startSweep()
  S.singleStep = true; S.paused = false
})
hud.on('rebuild', () => { S.cfg = hud.read(); buildScene() })
hud.on('clear', () => { table.clear(); S.detections = []; hud.setVerdict('searching', 'SEARCHING') })
hud.on('config', cfg => {
  S.cfg = cfg
  S.plan = currentPlan()
  hud.setPlan(S.plan)
  hud.setExplainState({
    ...cfg, azSpan: S.plan.azSpan, elSpan: S.plan.elSpan,
    positions: S.plan.beamPositions, priorityFloor: S.plan.priorityFloor
  })
})
hud.on('detector', cfg => {
  S.cfg = cfg
  hud.setExplainState({ ...cfg, k: kFor(cfg.far) })
  if (S.rows.length) { rerunDetection(); drawTrace(); drawPolar() }
})
hud.on('scene', cfg => {
  const wasHidden = S.cfg.hideHim
  S.cfg = cfg
  S.markers?.setVisible(cfg.showRays)
  S.sniper?.setMagnification(cfg.magnification)
  S.sniper?.setQuality(cfg.quality)
  hud.setExplainState({ ...cfg, scopeWidth: scopeWidthFor(cfg.quality) })
  if (cfg.reveal) S.sniperMarker.show(S.sniper.position); else S.sniperMarker.hide()
  if (wasHidden !== cfg.hideHim) {
    S.sniper.hideFromSensor = cfg.hideHim
    S.sniper.pickPosition()
    hud.toast(cfg.hideHim
      ? 'He has moved to a rooftop we cannot see. The active channel will not find him now: watch the passive readout.'
      : 'He has moved to a rooftop in our line of sight.')
  }
  applyDemoPair(makeRng(S.cfg.seed ^ 0x7777))
  refreshVisibility()
})
hud.on('preset', key => setPreset(key))
hud.on('mode', m => setMode(m))
hud.on('flag', () => flagSelected())
hud.on('row', i => {
  S.viewRow = i
  S.followRow = false
  drawTrace()
})
hud.on('export', () => {
  if (!S.lastRun) { hud.toast('Run a sweep first, then the export will have something to say.'); return }
  S.lastRun = makeRunRecord()
  exportRun(S.lastRun)
  hud.toast('Written: the sweep as CSV, one line per sample, and the whole run as JSON ' +
            'including the seed, every setting and what was really out there.', 7000)
})
hud.on('verify', () => {
  if (!S.lastRun) { hud.toast('Run a sweep first. There is nothing to check yet.'); return }
  S.lastRun = makeRunRecord()
  exportForPython(S.lastRun)
  hud.showModal(`
    <h3>Check these numbers yourself</h3>
    <p>Three files have been written to your downloads folder.</p>
    <p style="font-family:ui-monospace,monospace;font-size:11.5px;color:#c9d6e2">
      python verify_detection.py sweep_*.csv run_*.json</p>
    <p>The script reads nothing but the raw returns in the first column of the
    CSV. It works out the local background again, the wobble again, the alarm
    level again, finds the peaks again and measures them again, using nothing
    but numpy. Then it compares its own list against the one this program
    produced and prints whether the two agree.</p>
    <p>It needs numpy, and nothing else.</p>
    <p class="assumed">This proves the browser is running the algorithm it says
    it is running. It does not, and cannot, prove that the scene is real.</p>`)
})
hud.on('tutorial-event', e => tutorial.notify(e))
hud.on('comparison-closed', () => setMode('free'))

document.getElementById('tut-next').addEventListener('click', () => tutorial.next())
document.getElementById('tut-back').addEventListener('click', () => tutorial.back())
document.getElementById('tut-quit').addEventListener('click', () => { tutorial.quit(); setMode('free') })

table.onSelect(d => {
  S.selected = d
  drawTrace(); drawPolar()
  if (d.range) {
    // slew the camera to look where the detector says the return came from
    const az = d.bearing * Math.PI / 180, el = d.elevation * Math.PI / 180
    const p = new THREE.Vector3(
      S.world.sensorPos.x + Math.sin(az) * Math.cos(el) * d.range,
      S.world.sensorPos.y + Math.sin(el) * d.range,
      S.world.sensorPos.z - Math.cos(az) * Math.cos(el) * d.range)
    controls.target.copy(p)
  }
})
trace.onPick(p => {
  const d = S.detections.find(x => Math.abs(angleDiff(x.bearing, p.azimuth)) < 0.5)
  if (d) { table.select(d.id); S.selected = d; drawTrace(); drawPolar() }
})

function rerunDetection() {
  S.results = S.rows.map(row => {
    const res = detect({
      angles: S.plan.angles, power: row.power, stepDeg: S.plan.azStep,
      far: S.cfg.far, cutoff: S.cfg.cutoff,
      minSeparationDeg: Math.max(1.5, S.plan.beamWidth * 6), beamWidth: S.plan.beamWidth
    })
    if (row.alt) res.altBackground = localBackground(row.alt, S.plan.azStep, WINDOW_DEG)
    return res
  })
  gatherDetections()
  S.lastRun = makeRunRecord()
}

function setPreset(key) {
  S.preset = PRESETS[key]
  applyPreset({ scene, renderer, lighting, world: S.world, props: S.props }, key)
  hud.setExplainState({ presetPlain: S.preset.plain })
  hud.toast(`${S.preset.label}: ${S.preset.plain}`, 6000)
  if (S.rows.length) resetSweepData()
}

// -------------------------------------------------------------------- loop
let last = performance.now()
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  drawTrace(); drawPolar()
})

let fpsFrames = 0, fpsSince = performance.now(), slowClock = 0
function frame() {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  fpsFrames++
  if (now - fpsSince > 500) {
    hud.setFps(fpsFrames * 1000 / (now - fpsSince))
    fpsFrames = 0; fpsSince = now
  }
  slowClock += dt

  if (S.running && !S.paused) {
    // Use about a third of whatever the frame is costing anyway. On a quick
    // machine that is a few milliseconds and the beam appears to turn; on a
    // slow one it is more, so the sweep still finishes in about a second.
    processRows(Math.max(7, Math.min(60, dt * 1000 * 0.35)))
    const progress = S.rows.length / Math.max(1, S.plan.nEl)
    S.beamAz = S.plan.azMin + ((now / 220) % 1) * S.plan.azSpan
    S.beamEl = S.plan.elMin + progress * Math.max(0.001, S.plan.elSpan)
    S.props.setBeam(S.beamAz, S.beamEl)
    if (S.followRow) drawTrace()
  }

  // the man on the roof
  if (S.sniper) {
    const ev = S.sniper.update(dt)
    const showReadouts = slowClock > 0.2
    if (ev.pulse) handlePulse()
    if (ev.moved) { refreshVisibility(); if (S.cfg.reveal) S.sniperMarker.show(S.sniper.position) }
    if (ev.fired) onFired()
    const t = S.sniper.timeToShot
    if (showReadouts) hud.setScene({
      state: S.sniper.state.toLowerCase(),
      los: S.sniper.blockedFromSensor ? 'blocked' : 'clear',
      countdown: S.sniper.state === 'Fired' ? 'fired' : `${t.toFixed(0)} s`,
      urgent: t < 20
    })
    if (S.hunt && !S.hunt.outcome && showReadouts) {
      hud.setHunt({ show: true, clock: `${Math.max(0, t).toFixed(0)} s`, urgent: t < 20 })
    }
    if (showReadouts) {
      hud.setExplainState({ sniperWhat: S.sniper.describe(), offAxis: S.sniper.lastOffAxis })
      slowClock = 0
    }
  }

  if (pulseFade > 0) {
    pulseFade = Math.max(0, pulseFade - dt)
    pulseLine.material.opacity = Math.min(0.8, pulseFade)
  }

  if (S.running || slowClock === 0) drawPolar()
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

function onFired() {
  if (S.hunt && !S.hunt.outcome) {
    S.hunt.outcome = 'fired'
    hud.setHunt({ show: true, msg: 'He fired. Too late.', urgent: true })
    hud.showModal(scoreCard((performance.now() - S.hunt.startedAt) / 1000, false))
  } else {
    hud.toast('He fired. In free scan that costs nothing: he resets and moves on.')
    S.sniper.enter('Relocating')
  }
}

// ------------------------------------------------------------------- start
buildScene()
S.plan = currentPlan()
hud.setPlan(S.plan)
hud.setExplainState({
  ...S.cfg, azSpan: S.plan.azSpan, elSpan: S.plan.elSpan,
  positions: S.plan.beamPositions, k: kFor(S.cfg.far),
  presetPlain: S.preset.plain, scopeWidth: scopeWidthFor(S.cfg.quality)
})
waterfall.paintBar()
document.getElementById('loading').classList.add('gone')
requestAnimationFrame(frame)

// a small hook so the scene can be checked from the console or a test
window.__sim = {
  S, hud, startSweep, processRows,
  get detections() { return S.detections },
  probe() {
    return {
      buildings: S.world.buildings.length,
      targets: S.targets.length,
      visible: S.targets.filter(t => t.visible).length,
      plan: { positions: S.plan.beamPositions, frameMs: S.plan.frameTimeMs, nEl: S.plan.nEl, nAz: S.plan.nAz },
      sweeps: S.sweepCount,
      detections: S.detections.length,
      optics: S.detections.filter(d => d.verdict === 'OPTIC').length,
      sniper: { state: S.sniper.state, bearing: S.sniper.target.bearing, range: S.sniper.target.range }
    }
  }
}
