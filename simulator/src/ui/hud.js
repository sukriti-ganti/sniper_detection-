// hud.js -- the panels, the readouts, and the plain sentence behind every
// number. Nothing here computes anything: it reads controls and shows results.

import { K_TABLE } from '../sim/detect.js'

const $ = id => document.getElementById(id)

// One sentence per number, shown when Explain mode is on. No jargon.
const EXPLAIN = {
  'explain-mode': () => 'Hover any number and you get one plain sentence about it.',
  'az-sector': s => `We only look between ${s.azMin} and ${s.azMax} degrees. Narrowing the sector means fewer places to look, so we come back round sooner.`,
  'el-range': s => `We only look between ${s.elMin} and ${s.elMax} degrees above the horizontal. Rooftops live in the upper part of that.`,
  'beam-width': s => `Our beam is ${s.beamWidth.toFixed(2)} degrees across. A wide beam covers ground quickly but blurs every return, so nothing can ever look narrower than the beam itself.`,
  'dwell': s => `We stop for ${s.dwellMs.toFixed(1)} thousandths of a second at each position. Longer dwell collects more light but costs time.`,
  'priority': () => 'Only look above the rooftops. It cuts the number of places to look, so a full frame takes much less time. It does not change any detection number.',
  positions: s => `The number of places the beam has to stop: the area of the sector divided by the beam width squared. Here that is (${s.azSpan.toFixed(0)} x ${s.elSpan.toFixed(0)}) / ${s.beamWidth.toFixed(2)}^2. Halve the beam width and this goes up four times.`,
  frametime: s => `Places to look, times the dwell at each one. ${s.positions.toLocaleString()} x ${s.dwellMs.toFixed(1)} ms. That is how long one complete look around takes.`,
  samples: () => 'The trace is sampled four times finer than the beam width, otherwise a width measured from two readings would not be a measurement at all.',
  scanrate: () => 'How many complete sweeps have been run since the scene was built.',
  fps: () => 'How many times a second the picture is being redrawn. This is the speed of the drawing, not of the sensor.',
  preset: s => `${s.presetPlain} These conditions are assumed figures, chosen for the right ratios between day, dusk, night and fog.`,
  far: s => `We accept one wrong alarm in ${Math.round(1 / s.far).toLocaleString()}. That is a choice about how often we are willing to be fooled, and everything else follows from it.`,
  k: s => `We accept one wrong alarm in ${Math.round(1 / s.far).toLocaleString()}. That means going ${s.k.toFixed(2)} wobbles above the background.`,
  wobble: () => 'How much the reading moves about once the background is taken away. Measured from the middle of the scatter, so that a few bright returns cannot inflate it.',
  level: s => `Background plus ${s.k.toFixed(2)} wobbles. It is not a number anyone typed in: it follows from the false alarm rate and from the wobble.`,
  background: () => 'The light already there before we emit anything, estimated separately at every angle by taking the middle reading of the ten degrees around it.',
  cutoff: s => `A return narrower than ${s.cutoff.toFixed(2)} degrees is called an optic. Wider than that and we call it clutter. Move it and watch the verdicts change.`,
  twocolour: () => 'Sweep twice, at two colours. A coated lens answers very differently at the two, bare plastic answers about the same. It is a second opinion on the width test.',
  seed: () => 'The same seed rebuilds exactly the same city and the same targets, so a result can be repeated and checked.',
  quality: s => `How well made his scope is. At 100 it throws back a needle ${s.scopeWidth.toFixed(2)} degrees wide. At 0 it is a cheap optic and its answer is nearly as wide as a road sign, which is when we lose him.`,
  magnification: s => `At ${s.magnification}x his field of view is about ${(40 / s.magnification).toFixed(1)} degrees. He only answers our beam when we are inside that cone.`,
  'sniper-state': s => `${s.sniperWhat || 'waiting'}. You could not see this in a real situation: it is here so you can watch cause and effect.` +
    (s.offAxis !== undefined && s.offAxis !== null ? ` Right now his scope is pointed ${s.offAxis.toFixed(1)} degrees off us.` : ''),
  'sniper-los': () => 'Whether a straight line from the sensor to him is clear of buildings. Worked out by casting a ray at the actual geometry.',
  passive: () => 'When he ranges his target with a laser, his beam ends here beside us. We do not need to see him for that.',
  countdown: () => 'How long until he fires, if nothing stops him.'
}

export function createHud() {
  const listeners = {}
  const on = (name, cb) => { (listeners[name] ||= []).push(cb) }
  const emit = (name, arg) => (listeners[name] || []).forEach(f => f(arg))

  const els = {
    sweep: $('btn-sweep'), pause: $('btn-pause'), step: $('btn-step'),
    azMin: $('in-az-min'), azMax: $('in-az-max'), elMin: $('in-el-min'), elMax: $('in-el-max'),
    beam: $('in-beam'), dwell: $('in-dwell'), priority: $('in-priority'),
    outBeam: $('out-beam'), outDwell: $('out-dwell'),
    outPositions: $('out-positions'), outFrame: $('out-frametime'),
    outSamples: $('out-samples'), outSweeps: $('out-sweeps'),
    verdict: $('verdict'), far: $('in-far'), cutoff: $('in-cutoff'), outCutoff: $('out-cutoff'),
    twoColour: $('in-twocolour'),
    outK: $('out-k'), outWobble: $('out-wobble'), outLevel: $('out-level'), outBackground: $('out-background'),
    seed: $('in-seed'), rebuild: $('btn-rebuild'),
    quality: $('in-quality'), outQuality: $('out-quality'),
    mag: $('in-mag'), outMag: $('out-mag'), outFov: $('out-fov'),
    outSniper: $('out-sniper'), outLos: $('out-los'), outPassive: $('out-passive'), outCountdown: $('out-countdown'),
    flag: $('btn-flag'), showRays: $('in-showrays'), demoPair: $('in-demopair'),
    hideHim: $('in-hidehim'), reveal: $('in-reveal'),
    row: $('in-row'), outRowEl: $('out-rowel'),
    tip: $('tip'), toast: $('toast'), modal: $('modal'), modalBody: $('modal-body'),
    huntBar: $('hunt-bar'), huntClock: $('hunt-clock'), huntMsg: $('hunt-msg'), huntFa: $('hunt-fa'),
    comparison: $('comparison'), comparisonBody: $('comparison-body'),
    explain: $('explain-toggle')
  }

  const read = () => ({
    azMin: +els.azMin.value, azMax: +els.azMax.value,
    elMin: +els.elMin.value, elMax: +els.elMax.value,
    beamWidth: +els.beam.value, dwellMs: +els.dwell.value,
    priority: els.priority.checked,
    far: +els.far.value, cutoff: +els.cutoff.value, twoColour: els.twoColour.checked,
    seed: +els.seed.value, quality: +els.quality.value, magnification: +els.mag.value,
    showRays: els.showRays.checked, demoPair: els.demoPair.checked,
    hideHim: els.hideHim.checked, reveal: els.reveal.checked
  })

  // ------------------------------------------------------------- wiring
  els.sweep.addEventListener('click', () => emit('sweep'))
  els.pause.addEventListener('click', () => emit('pause'))
  els.step.addEventListener('click', () => emit('step'))
  els.rebuild.addEventListener('click', () => emit('rebuild'))
  els.flag.addEventListener('click', () => emit('flag'))
  $('btn-export').addEventListener('click', () => emit('export'))
  $('btn-verify').addEventListener('click', () => emit('verify'))
  $('btn-clear-det').addEventListener('click', () => emit('clear'))
  $('btn-polar-hide').addEventListener('click', () => {
    $('panel-polar').classList.add('hidden')
    $('btn-polar-show').classList.remove('hidden')
  })
  $('btn-polar-show').addEventListener('click', () => {
    $('panel-polar').classList.remove('hidden')
    $('btn-polar-show').classList.add('hidden')
  })

  ;[els.azMin, els.azMax, els.elMin, els.elMax, els.priority].forEach(e =>
    e.addEventListener('change', () => emit('config', read())))
  els.beam.addEventListener('input', () => {
    els.outBeam.textContent = (+els.beam.value).toFixed(2); emit('config', read())
  })
  els.dwell.addEventListener('input', () => {
    els.outDwell.textContent = (+els.dwell.value).toFixed(1); emit('config', read())
  })
  els.far.addEventListener('change', () => {
    const k = K_TABLE.find(r => Math.abs(r.far - +els.far.value) < 1e-12)
    els.outK.textContent = (k ? k.k : 3.719).toFixed(3)
    emit('detector', read()); emit('tutorial-event', 'far')
  })
  els.cutoff.addEventListener('input', () => {
    els.outCutoff.textContent = (+els.cutoff.value).toFixed(2); emit('detector', read())
  })
  els.twoColour.addEventListener('change', () => emit('detector', read()))
  els.quality.addEventListener('input', () => {
    els.outQuality.textContent = els.quality.value; emit('scene', read())
  })
  els.mag.addEventListener('input', () => {
    els.outMag.textContent = els.mag.value
    els.outFov.textContent = `${(40 / +els.mag.value).toFixed(1)} deg cone`
    emit('scene', read())
  })
  ;[els.showRays, els.demoPair, els.hideHim, els.reveal].forEach(e =>
    e.addEventListener('change', () => emit('scene', read())))
  els.row.addEventListener('input', () => emit('row', +els.row.value))

  document.querySelectorAll('#seg-preset button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#seg-preset button').forEach(x => x.classList.remove('is-on'))
      b.classList.add('is-on')
      emit('preset', b.dataset.preset)
    })
  })
  document.querySelectorAll('#modes .tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#modes .tab').forEach(x => x.classList.remove('is-on'))
      b.classList.add('is-on')
      emit('mode', b.dataset.mode)
    })
  })

  // ------------------------------------------------------- explain mode
  let explainState = {}
  els.explain.addEventListener('change', () => {
    document.body.classList.toggle('explain-on', els.explain.checked)
    if (!els.explain.checked) els.tip.classList.add('hidden')
  })
  document.addEventListener('mousemove', ev => {
    if (!els.explain.checked) { els.tip.classList.add('hidden'); return }
    const host = ev.target.closest?.('[data-explain]')
    if (!host) { els.tip.classList.add('hidden'); return }
    const f = EXPLAIN[host.dataset.explain]
    if (!f) { els.tip.classList.add('hidden'); return }
    els.tip.textContent = f(explainState)
    els.tip.classList.remove('hidden')
    const r = els.tip.getBoundingClientRect()
    els.tip.style.left = Math.min(innerWidth - r.width - 8, ev.clientX + 14) + 'px'
    els.tip.style.top = Math.min(innerHeight - r.height - 8, ev.clientY + 16) + 'px'
  })

  // --------------------------------------------------------------- about
  $('btn-about').addEventListener('click', () => showModal(`
    <h3>About this simulator</h3>
    <p>This is a <b>simulated scene</b>. Nothing in it is a measurement. No real
    sniper has been detected by this program, and none ever will be.</p>
    <p>The optics are <b>geometric optics only</b>: a return is a hump in angle, dimmed by
    the fourth power of range and by the air it passed through, twice. There is
    <b>no electromagnetic solver</b> here, no wave propagation, no material model.</p>
    <p>The line of sight is the one thing that is not a formula: it is cast as a
    real ray against the same buildings you can see, every sweep.</p>
    <p>The detection algorithm is implemented exactly as specified: a running
    median background, a median absolute deviation wobble, an alarm level set
    from a chosen false alarm rate, peak finding, and a full width at half
    maximum. The Export button writes out the readings and a short Python
    script that re-runs those five steps independently, so the numbers on
    screen can be checked away from this program.</p>
    <p class="assumed">Target strengths, widths, colour ratios, background levels,
    noise levels and the passive channel constants are ASSUMED figures, chosen
    for the right ratios between kinds and conditions. They are not calibrated
    against any instrument.</p>
  `))

  $('btn-limits').addEventListener('click', () => showModal(`
    <h3>What this will not do</h3>
    <ul>
      <li><b>A poor optic hides.</b> A low grade scope throws back a wider flash.
      Wind the scope quality down and the return widens until the width test can
      no longer separate it from a road sign. Then we lose him, and the simulator
      shows that happening.</li>
      <li><b>Daylight hurts.</b> Bright sky raises the background, the alarm level
      follows it up, and weaker returns stop getting through. Detection range in
      day is roughly two thirds of what it is at night.</li>
      <li><b>Fog is worse than it looks.</b> The air eats the beam on the way out
      and again on the way back. Detection range collapses by far more than half.</li>
      <li><b>He has to be looking at us.</b> A scope answers only along the line it
      is pointed. If his cone is elsewhere, there is nothing to find on the active
      channel.</li>
      <li><b>This is a perimeter sensor, not a wide area one.</b> It guards one
      point. Covering a whole city would need a frame time nobody would accept:
      the readout in the scan panel shows why.</li>
      <li><b>Other people own lenses.</b> Cameras and binoculars give narrow returns
      too. The width test says "an optic", not "a sniper".</li>
    </ul>
  `))
  $('modal-close').addEventListener('click', () => els.modal.classList.add('hidden'))
  els.modal.addEventListener('click', e => { if (e.target === els.modal) els.modal.classList.add('hidden') })
  $('btn-comparison-close').addEventListener('click', () => {
    els.comparison.classList.add('hidden')
    emit('comparison-closed')
  })

  function showModal(html) {
    els.modalBody.innerHTML = html
    els.modal.classList.remove('hidden')
  }

  let toastTimer = null
  function toast(msg, ms = 3200) {
    els.toast.textContent = msg
    els.toast.classList.remove('hidden')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms)
  }

  const fmt = (v, d = 0) => (v === null || v === undefined || !isFinite(v))
    ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })

  function humanTime(ms) {
    if (ms < 1000) return `${ms.toFixed(0)} ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
    return `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`
  }

  return {
    els, on, read, toast, showModal,
    setExplainState(s) { explainState = { ...explainState, ...s } },

    setPlan(plan) {
      els.outPositions.textContent = fmt(plan.beamPositions)
      els.outFrame.textContent = humanTime(plan.frameTimeMs)
      els.outSamples.textContent = fmt(plan.samples)
      els.row.max = String(Math.max(0, plan.nEl - 1))
    },
    setSweepCount(n) { els.outSweeps.textContent = String(n) },
    setFps(f) {
      const e = document.getElementById('out-fps')
      if (!e) return
      e.textContent = `${f.toFixed(0)}`
      e.className = f >= 50 ? 'ok' : (f >= 25 ? '' : 'warn')
    },
    setRowLabel(el) { els.outRowEl.textContent = el === null ? '—' : `${el.toFixed(1)} deg` },
    setRowIndex(i) { els.row.value = String(i) },

    setDetector({ wobble, level, background, k }) {
      els.outWobble.textContent = fmt(wobble, 0)
      els.outLevel.textContent = fmt(level, 0)
      els.outBackground.textContent = fmt(background, 0)
      if (k !== undefined) els.outK.textContent = k.toFixed(3)
    },

    setCounts(optics, clutter, noise) {
      const el = document.getElementById('verdict-counts')
      if (el) el.textContent = `${optics} optic  ${clutter} clutter  ${noise} noise`
    },

    setVerdict(kind, text) {
      els.verdict.className = `verdict ${kind}`
      els.verdict.textContent = text
    },

    setScene({ state, los, passive, countdown, urgent }) {
      if (state !== undefined) els.outSniper.textContent = state
      if (los !== undefined) {
        els.outLos.textContent = los
        els.outLos.className = los === 'clear' ? 'ok' : 'warn'
      }
      if (passive !== undefined) {
        els.outPassive.textContent = passive
        els.outPassive.className = passive === 'quiet' ? '' : 'hot'
      }
      if (countdown !== undefined) {
        els.outCountdown.textContent = countdown
        els.outCountdown.className = urgent ? 'hot' : ''
      }
    },

    setHunt({ show, clock, msg, falseAlarms, urgent }) {
      els.huntBar.classList.toggle('hidden', !show)
      if (clock !== undefined) els.huntClock.textContent = clock
      if (msg !== undefined) els.huntMsg.textContent = msg
      if (falseAlarms !== undefined) els.huntFa.textContent = String(falseAlarms)
      els.huntBar.classList.toggle('urgent', !!urgent)
    },

    setPreset(key) {
      document.querySelectorAll('#seg-preset button').forEach(b =>
        b.classList.toggle('is-on', b.dataset.preset === key))
    },
    setMode(mode) {
      document.querySelectorAll('#modes .tab').forEach(b =>
        b.classList.toggle('is-on', b.dataset.mode === mode))
    },
    setSweepButton(running) {
      els.sweep.textContent = running ? 'Sweeping…' : 'Start sweep'
      els.sweep.disabled = running
    },
    showComparison(html) {
      els.comparisonBody.innerHTML = html
      els.comparison.classList.remove('hidden')
    },
    hideComparison() { els.comparison.classList.add('hidden') },
    humanTime
  }
}
