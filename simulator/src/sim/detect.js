// detect.js -- THE VERDICT. This is the project.
//
// Reads one line of brightness readings and says what is out there.
//
// FIVE STEPS
//   1. Estimate the background AT EVERY POINT, not one number for the whole sweep
//   2. Work out how much the reading wobbles around that background
//   3. Set the alarm level from a chosen error rate, not by guessing
//   4. Find every bright spot above that level
//   5. Measure how wide each spot is, and decide
//
// WHY STEP 1 MATTERS
// One alarm level for the whole sweep does not work. Some parts of a scene
// are bright and some are dark. Set one level and you either flood the bright
// parts with false alarms or go blind in the dark parts. So the background is
// estimated separately at every angle, and the alarm level rides up and down
// with the scene.
//
// This is a direct port of src/detect.py in the main repository. The Python
// script written out by the Export button re-runs these same five steps on
// the exported numbers, and must reach the same verdicts.

export const WINDOW_DEG = 10.0     // how far either side we look for background
export const DEFAULT_CUTOFF = 1.2  // degrees. narrower than this is an optic

// NOTHING CAN ANSWER NARROWER THAN OUR OWN BEAM.
// The return from a perfect point is still as wide as the beam that lit it:
// the full width at half maximum of the model's hump is 1.665 times the
// effective width, and the effective width can never be smaller than the
// beam. So a spike narrower than this cannot be a return from anything. It
// is the detector's own noise crossing the line, which at one wrong alarm in
// ten thousand it will do about seventeen times in a sweep of this size.
// We say so rather than calling it an optic.
export const BEAM_LIMIT_FACTOR = 1.4

// How many wobbles out we must go for a chosen rate of wrong alarms.
// These are the inverse normal tail values. They are not adjustable knobs:
// pick the rate and the number follows.
export const K_TABLE = [
  { far: 1e-2, k: 2.326, label: '1 wrong alarm in 100' },
  { far: 1e-3, k: 3.090, label: '1 wrong alarm in 1,000' },
  { far: 1e-4, k: 3.719, label: '1 wrong alarm in 10,000' },
  { far: 1e-5, k: 4.265, label: '1 wrong alarm in 100,000' }
]

export function kFor(far) {
  let best = K_TABLE[0]
  for (const row of K_TABLE) {
    if (Math.abs(Math.log10(row.far) - Math.log10(far)) <
        Math.abs(Math.log10(best.far) - Math.log10(far))) best = row
  }
  return best.k
}

// ------------------------------------------------------------------ step 1
// Running median. The median ignores a few very large values, so a bright
// spot sitting inside the window barely moves it: the spot cannot inflate
// its own background estimate.
//
// Edges repeat the end value, which is what scipy calls mode="nearest".
export function localBackground(power, stepDeg, windowDeg = WINDOW_DEG) {
  const n = power.length
  let w = Math.max(3, Math.floor(windowDeg / stepDeg))
  if (w % 2 === 0) w += 1                  // odd, so there is a middle value
  if (w > n) w = (n % 2 === 0) ? n - 1 : n
  const h = (w - 1) / 2
  const out = new Float64Array(n)

  // pad with the edge values so every point has a full window
  const padded = new Float64Array(n + 2 * h)
  for (let i = 0; i < h; i++) { padded[i] = power[0]; padded[n + h + i] = power[n - 1] }
  padded.set(power, h)

  // a sorted window, kept sorted as it slides
  const win = new Float64Array(w)
  win.set(padded.subarray(0, w))
  win.sort()
  out[0] = win[h]

  for (let i = 1; i < n; i++) {
    const drop = padded[i - 1], add = padded[i + w - 1]
    if (drop !== add) {
      // remove the value that just left the window
      let lo = 0, hi = w - 1, at = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (win[mid] === drop) { at = mid; break }
        if (win[mid] < drop) lo = mid + 1; else hi = mid - 1
      }
      if (at < 0) at = lo < w ? lo : w - 1
      win.copyWithin(at, at + 1, w)
      // insert the value that just entered
      lo = 0; hi = w - 2
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (win[mid] < add) lo = mid + 1; else hi = mid - 1
      }
      win.copyWithin(lo + 1, lo, w - 1)
      win[lo] = add
    }
    out[i] = win[h]
  }
  return out
}

function median(sorted) {
  const n = sorted.length
  if (n === 0) return 0
  return n % 2 ? sorted[(n - 1) / 2] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2])
}

// ------------------------------------------------------------------ step 2
// How much the reading moves about, once the background is taken away.
// The median absolute deviation is used rather than the ordinary standard
// deviation, because a few bright spots would inflate the ordinary one and
// push the alarm level far too high. 1.4826 converts a median absolute
// deviation into the equivalent standard deviation for normal noise.
export function wobble(power, background) {
  const n = power.length
  const resid = new Float64Array(n)
  for (let i = 0; i < n; i++) resid[i] = power[i] - background[i]
  const s1 = Float64Array.from(resid).sort()
  const m = median(s1)
  const dev = new Float64Array(n)
  for (let i = 0; i < n; i++) dev[i] = Math.abs(resid[i] - m)
  return 1.4826 * median(dev.sort())
}

// ------------------------------------------------------------------ step 3
//     level = background + wobble x (how many wobbles out we need to go)
// We choose how often we will accept a wrong alarm FIRST, and the level
// follows from that. Never a number picked because it looked about right.
export function alarmLevel(background, wob, k) {
  const out = new Float64Array(background.length)
  for (let i = 0; i < background.length; i++) out[i] = background[i] + wob * k
  return out
}

// ------------------------------------------------------------------ step 4
// Every local maximum that crosses the alarm line. minSeparation stops one
// wide hump from being counted as several spots: the tallest wins and its
// neighbours within that distance are dropped.
export function findPeaks(power, level, minSeparation = 20) {
  const n = power.length
  const cand = []
  for (let i = 1; i < n - 1; i++) {
    if (power[i] - level[i] <= 0) continue
    if (power[i] > power[i - 1] && power[i] >= power[i + 1]) cand.push(i)
  }
  cand.sort((a, b) => (power[b] - level[b]) - (power[a] - level[a]))
  const keep = []
  for (const i of cand) {
    if (keep.every(j => Math.abs(i - j) >= minSeparation)) keep.push(i)
  }
  return keep.sort((a, b) => a - b)
}

// ------------------------------------------------------------------ step 5
// Full width at half maximum. Take the peak height above the LOCAL
// background, go halfway down, and measure the angle between the two points
// where the curve crosses that halfway line.
// Returns null if the spot runs off the edge of the sweep, because then we
// cannot honestly say how wide it is.
export function measureWidth(angles, power, background, peakIndex) {
  const base = background[peakIndex]
  const height = power[peakIndex] - base
  if (height <= 0) return null
  const half = base + height / 2

  let i = peakIndex
  while (i > 0 && power[i] > half) i--
  if (i === 0) return null

  let j = peakIndex
  while (j < power.length - 1 && power[j] > half) j++
  if (j === power.length - 1) return null

  return Math.abs(angles[j] - angles[i])
}

// Narrow means an optic. Wide means a road sign, a window, a wet road.
// Narrower than the beam itself means nobody is there.
export function classify(width, cutoff = DEFAULT_CUTOFF, beamLimit = 0) {
  if (width === null || width === undefined) return 'unknown'
  if (beamLimit > 0 && width < beamLimit) return 'noise'
  return width < cutoff ? 'OPTIC' : 'clutter'
}

// ------------------------------------------------------------------- all of it
export function detect({ angles, power, stepDeg, far = 1e-4, cutoff = DEFAULT_CUTOFF,
                         windowDeg = WINDOW_DEG, minSeparationDeg = 1.0, beamWidth = 0 }) {
  const k = kFor(far)
  const beamLimit = beamWidth > 0 ? BEAM_LIMIT_FACTOR * beamWidth : 0
  const background = localBackground(power, stepDeg, windowDeg)
  const wob = wobble(power, background)
  const level = alarmLevel(background, wob, k)
  const minSep = Math.max(3, Math.round(minSeparationDeg / stepDeg))

  const found = findPeaks(power, level, minSep).map(i => {
    const width = measureWidth(angles, power, background, i)
    return {
      index: i,
      azimuth: angles[i],
      height: power[i],
      above: power[i] - background[i],
      background: background[i],
      level: level[i],
      width,
      verdict: classify(width, cutoff, beamLimit)
    }
  })

  // ONE HUMP IS ONE DETECTION.
  // A fixed minimum separation cannot know how wide a hump is going to be.
  // Now that the widths are measured we can say it properly: if two peaks
  // sit closer together than their own half maximum widths, they are the
  // same object answering twice, and the taller one keeps it.
  const order = found.slice().sort((a, b) => b.above - a.above)
  const kept = []
  for (const p of order) {
    const pw = p.width === null ? minSeparationDeg : p.width
    const clash = kept.some(q => {
      const qw = q.width === null ? minSeparationDeg : q.width
      return Math.abs(p.azimuth - q.azimuth) < 0.6 * (pw + qw)
    })
    if (!clash) kept.push(p)
  }
  const peaks = kept.sort((a, b) => a.index - b.index)

  return { background, level, wobble: wob, k, beamLimit, peaks }
}
