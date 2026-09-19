// sweep.js -- turning the sensor and writing down what comes back.
//
// The scan is a raster: one line of azimuth at a time, stepping up in
// elevation. Each line is a trace, and a trace is what the detector reads.
//
// TWO STEP SIZES, AND WHY
// The beam positions the scanner must visit are set by the beam width: a
// beam 0.2 degrees across has to stop every 0.2 degrees or it misses things.
// That count, and the time it costs, is what the readout shows. The trace
// itself is sampled four times finer, because a full width at half maximum
// measured from two samples would not be a measurement at all.

import { returnPower } from './optics.js'
import { makeRng } from '../rng.js'

export const OVERSAMPLE = 4        // trace samples per beam width

export function planSweep(cfg) {
  const { world } = cfg
  const beamWidth = Math.max(0.05, cfg.beamWidth)
  let azMin = Math.min(cfg.azMin, cfg.azMax)
  let azMax = Math.max(cfg.azMin, cfg.azMax)
  let elMin = Math.min(cfg.elMin, cfg.elMax)
  let elMax = Math.max(cfg.elMin, cfg.elMax)

  // Priority scan: do not waste time below the rooftops. The skyline comes
  // from the building list, so this only moves the sector. It never touches
  // a single detection number.
  let priorityFloor = null
  if (cfg.priority && world) {
    let lowest = Infinity
    for (let a = Math.floor(azMin); a <= Math.ceil(azMax); a++) {
      lowest = Math.min(lowest, world.skylineAt(a))
    }
    if (isFinite(lowest)) {
      priorityFloor = Math.max(elMin, lowest - 1.0)
      if (priorityFloor < elMax - 0.5) elMin = priorityFloor
    }
  }

  const azSpan = Math.max(0.1, azMax - azMin)
  const elSpan = Math.max(0.0, elMax - elMin)
  const azStep = beamWidth / OVERSAMPLE
  const elStep = beamWidth

  const nAz = Math.max(8, Math.floor(azSpan / azStep) + 1)
  const nEl = Math.max(1, Math.floor(elSpan / elStep) + 1)

  // The count the operator is charged for, exactly as specified:
  //   (azSpan * elSpan) / beamWidth^2, times the dwell at each one.
  const beamPositions = Math.max(1, Math.round((azSpan * Math.max(elSpan, beamWidth)) / (beamWidth * beamWidth)))
  const frameTimeMs = beamPositions * cfg.dwellMs

  const angles = new Float64Array(nAz)
  for (let i = 0; i < nAz; i++) angles[i] = azMin + i * azStep

  const elevations = new Float64Array(nEl)
  for (let j = 0; j < nEl; j++) elevations[j] = elMin + j * elStep

  return {
    azMin, azMax, elMin, elMax, azSpan, elSpan,
    beamWidth, dwellMs: cfg.dwellMs, azStep, elStep,
    nAz, nEl, angles, elevations,
    beamPositions, frameTimeMs, samples: nAz * nEl,
    priorityFloor
  }
}

// One line of the raster, at one elevation, in one colour.
export function sweepRow(targets, elevation, plan, preset, rng, band = 'nm1064') {
  const { angles, nAz, azStep, beamWidth } = plan
  const power = new Float64Array(nAz)

  // the light that is already there, plus the detector's own wobble
  for (let i = 0; i < nAz; i++) {
    power[i] = preset.backgroundLevel + rng.normal(0, preset.noiseSigma)
  }

  for (const t of targets) {
    if (!t.visible) continue                       // blocked contributes nothing
    const w = Math.sqrt(t.width * t.width + beamWidth * beamWidth)
    if (Math.abs(elevation - t.elevation) > 4 * w) continue
    // only touch the samples the hump can actually reach
    const lo = Math.max(0, Math.floor((t.bearing - 4 * w - angles[0]) / azStep))
    const hi = Math.min(nAz - 1, Math.ceil((t.bearing + 4 * w - angles[0]) / azStep))
    for (let i = lo; i <= hi; i++) {
      power[i] += returnPower(t, angles[i], elevation, beamWidth, preset.extinction, band)
    }
  }
  return power
}

// Walks the raster one row at a time so the picture can keep moving while
// the numbers are worked out.
export class Sweeper {
  constructor({ plan, targets, preset, seed, twoColour }) {
    this.plan = plan
    this.targets = targets
    this.preset = preset
    this.twoColour = !!twoColour
    this.rng = makeRng(seed)
    this.row = 0
    this.done = false
    this.rows = []
  }

  nextRow() {
    if (this.done) return null
    const el = this.plan.elevations[this.row]
    const power = sweepRow(this.targets, el, this.plan, this.preset, this.rng, 'nm1064')
    const alt = this.twoColour
      ? sweepRow(this.targets, el, this.plan, this.preset, this.rng, 'nm1550')
      : null
    const out = { index: this.row, elevation: el, power, alt }
    this.rows.push(out)
    this.row++
    if (this.row >= this.plan.nEl) this.done = true
    return out
  }
}
