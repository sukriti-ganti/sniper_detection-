// waterfall.js -- one row per sweep, azimuth across, colour is return power.
// A streak that stays in the same place, sweep after sweep, is something
// standing still and answering every time.

const COLOURS = [
  [4, 6, 12], [22, 32, 62], [46, 60, 110], [40, 108, 130],
  [46, 158, 130], [140, 190, 92], [232, 202, 70], [255, 245, 190]
]

export function ramp(t) {
  const x = Math.max(0, Math.min(0.999, t)) * (COLOURS.length - 1)
  const i = Math.floor(x), f = x - i
  const a = COLOURS[i], b = COLOURS[Math.min(COLOURS.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export function createWaterfall(canvas, barCanvas, loLabel, hiLabel) {
  const ctx = canvas.getContext('2d')
  const W = 320, H = 150, BAND = 3   // pixels per sweep, so a single sweep is visible
  const buf = ctx.createImageData(W, H)
  buf.data.fill(0)
  let lo = 3, hi = 6
  let rows = 0

  function paintBar() {
    if (!barCanvas) return
    const b = barCanvas.getContext('2d')
    barCanvas.width = 200; barCanvas.height = 10
    for (let x = 0; x < 200; x++) {
      const [r, g, bl] = ramp(x / 199)
      b.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`
      b.fillRect(x, 0, 1, 10)
    }
    const show = v => Math.pow(10, v).toExponential(1).replace('e+', 'e')
    if (loLabel) loLabel.textContent = show(lo)
    if (hiLabel) hiLabel.textContent = show(hi)
  }

  function blit() {
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    ctx.putImageData(buf, 0, 0)
  }

  return {
    reset() { buf.data.fill(0); rows = 0; blit() },
    setRange(l, h) { lo = l; hi = h; paintBar() },
    // power is the strongest return seen at each azimuth during one sweep
    push(power) {
      const n = power.length
      // scroll down by one band
      buf.data.copyWithin(W * 4 * BAND, 0, W * (H - BAND) * 4)
      const line = new Uint8ClampedArray(W * 4)
      for (let x = 0; x < W; x++) {
        const i0 = Math.floor(x / W * n)
        const i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * n))
        let m = 0
        for (let i = i0; i < i1 && i < n; i++) if (power[i] > m) m = power[i]
        const t = (Math.log10(Math.max(1, m)) - lo) / (hi - lo)
        const [r, g, b] = ramp(t)
        const o = x * 4
        line[o] = r; line[o + 1] = g; line[o + 2] = b; line[o + 3] = 255
      }
      for (let y = 0; y < BAND; y++) buf.data.set(line, y * W * 4)
      rows++
      blit()
    },
    paintBar,
    get rows() { return rows }
  }
}
