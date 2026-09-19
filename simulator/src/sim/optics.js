// optics.js -- how much light comes back.
//
// Geometric optics only. There is no electromagnetic solver anywhere in this
// project, and there is no wave propagation. A return is a hump in angle,
// dimmed by distance and by the air.
//
//   effectiveWidth = sqrt(target.width^2 + beamWidth^2)
//   hump  = exp( -((dAz/effectiveWidth)^2 + (dEl/effectiveWidth)^2) )
//   spread = (range / 200)^4
//   atten  = exp(-2 * extinction * range)
//   return = strength * hump * atten / spread
//
// THE FOURTH POWER OF RANGE IS THE POINT. Light spreads on the way out and
// again on the way back, so doubling the range gives sixteen times less
// signal. It is also why a wide beam blurs everything: our own beam width
// adds into the effective width, so nothing can ever look narrower than the
// beam we sent.

export const BANDS = {
  nm1064: { nm: 1064, label: '1064 nm' },
  nm1550: { nm: 1550, label: '1550 nm' }
}

export function effectiveWidth(targetWidth, beamWidth) {
  return Math.sqrt(targetWidth * targetWidth + beamWidth * beamWidth)
}

// Shortest way round the circle, in degrees.
export function angleDiff(a, b) {
  let d = a - b
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

// Strength is quoted at 1064 nm. colourRatio is the response at 1550 nm
// divided by the response at 1064 nm, so it scales the strength when the
// second colour is used. Coated optics sit far from 1, bare plastic near it.
export function bandStrength(target, band) {
  return band === 'nm1550' ? target.strength * target.colourRatio : target.strength
}

export function returnPower(target, az, el, beamWidth, extinction, band = 'nm1064') {
  if (!target.visible) return 0                       // blocked means nothing at all
  const w = effectiveWidth(target.width, beamWidth)
  const dAz = angleDiff(az, target.bearing)
  const dEl = el - target.elevation
  if (Math.abs(dAz) > 5 * w || Math.abs(dEl) > 5 * w) return 0   // far outside the hump
  const hump = Math.exp(-((dAz / w) ** 2 + (dEl / w) ** 2))
  const spread = (target.range / 200) ** 4
  const atten = Math.exp(-2 * extinction * target.range)
  return bandStrength(target, band) * hump * atten / spread
}

// The range at which a given target would just reach the alarm level, found
// by walking outwards. Used by the comparison mode and the limitations panel.
export function detectionRange(strength, extinction, threshold, maxRange = 4000) {
  let lo = 1, hi = maxRange
  const p = r => strength * Math.exp(-2 * extinction * r) / ((r / 200) ** 4)
  if (p(lo) < threshold) return 0
  if (p(hi) > threshold) return maxRange
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (p(mid) > threshold) lo = mid; else hi = mid
  }
  return 0.5 * (lo + hi)
}
