// passive.js -- the other way of finding him.
//
// He has to know the range before he shoots, so sooner or later he points a
// laser rangefinder at what he means to hit. That beam ends at the protected
// point, which is a few metres from us. We do not need to see him at all:
// his own beam arrives here.
//
//   - sample the line from him to the protected point every 5 metres
//   - from the sensor, cast a ray at each sample. A sample we cannot see
//     contributes nothing
//   - visible samples scatter light back to us: the scattering coefficient
//     goes as 1/lambda^4, and the light spreads back over the square of the
//     distance
//   - the terminal spot, where the beam lands, is always visible and usually
//     dominates everything else
//
// All of the constants below are ASSUMED. They set the scale, not the truth.

import * as THREE from 'three'

export const SAMPLE_SPACING = 5.0     // metres along his beam
export const PULSE_ENERGY = 1.0e9     // assumed, arbitrary units
export const SCATTER_REF = 1.0e-4     // assumed, per metre per steradian at 1064 nm
export const GROUND_ALBEDO = 0.10     // assumed, diffuse return off the terminal spot

export function pulseReturn({ from, to, sensorPos, visibility, extinction, wavelengthNm = 1064 }) {
  const beta = SCATTER_REF * Math.pow(1064 / wavelengthNm, 4) * (extinction / 4e-4)
  const along = new THREE.Vector3().subVectors(to, from)
  const total = along.length()
  const n = Math.max(1, Math.floor(total / SAMPLE_SPACING))
  const dir = along.clone().multiplyScalar(1 / total)

  const samples = []
  let scattered = 0
  const p = new THREE.Vector3()
  for (let i = 1; i <= n; i++) {
    const d = i * SAMPLE_SPACING
    p.copy(from).addScaledVector(dir, d)
    const seen = visibility.clear(sensorPos, p)
    const r = p.distanceTo(sensorPos)
    let contribution = 0
    if (seen && r > 1) {
      const atten = Math.exp(-extinction * (d + r))
      contribution = PULSE_ENERGY * beta * SAMPLE_SPACING * atten / (r * r)
      scattered += contribution
    }
    samples.push({
      distanceAlong: d, visible: seen, range: r, contribution,
      bearing: bearingOf(sensorPos, p), elevation: elevationOf(sensorPos, p),
      point: p.clone()
    })
  }

  // the terminal spot, beside us
  const rT = Math.max(2, to.distanceTo(sensorPos))
  const attenT = Math.exp(-extinction * (total + rT))
  const terminal = PULSE_ENERGY * GROUND_ALBEDO * attenT / (rT * rT)

  return {
    total: scattered + terminal,
    scattered,
    terminal,
    samples,
    visibleSamples: samples.filter(s => s.visible).length,
    sampleCount: samples.length,
    // the far end of the visible part of his beam points back at him
    bearingHint: bearingHint(samples),
    terminalBearing: bearingOf(sensorPos, to)
  }
}

function bearingHint(samples) {
  const seen = samples.filter(s => s.visible)
  if (!seen.length) return null
  const far = seen.reduce((a, b) => (a.distanceAlong > b.distanceAlong ? a : b))
  return { bearing: far.bearing, elevation: far.elevation, atMetres: far.distanceAlong }
}

function bearingOf(from, to) {
  return Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI
}
function elevationOf(from, to) {
  const flat = Math.hypot(to.x - from.x, to.z - from.z)
  return Math.atan2(to.y - from.y, flat) * 180 / Math.PI
}

// ASSUMED: the passive channel stares through a narrow filter around the
// laser line and opens only for a short gate, which cuts the background and
// its wobble about fifty-fold compared with the scanning channel.
export const PASSIVE_GATE = 0.02

// The threshold is set exactly the way the active channel's is: the wobble,
// times how many wobbles out a chosen rate of wrong alarms demands.
export function passiveThreshold(preset, k) {
  return k * preset.noiseSigma * PASSIVE_GATE
}

export function passiveBackground(preset) {
  return preset.backgroundLevel * PASSIVE_GATE
}
