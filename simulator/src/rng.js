// A small seeded random number generator.
// Same seed, same city, same targets, every time. That is what makes a run
// repeatable, and it is what the exported JSON records.

export function makeRng(seed) {
  let s = (seed >>> 0) || 1
  const next = () => {
    // mulberry32
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    float: next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: arr => arr[Math.floor(next() * arr.length) % arr.length],
    chance: p => next() < p,
    // +/- percent, so no two objects in the scene are identical
    jitter: (v, frac) => v * (1 + (next() * 2 - 1) * frac),
    // Box-Muller, used for detector noise
    normal: (mu = 0, sigma = 1) => {
      const u = Math.max(next(), 1e-12), v = next()
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    }
  }
}
