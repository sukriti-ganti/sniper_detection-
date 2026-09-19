// trace.js -- return against azimuth, on a log scale.
//
// Three lines: what came back, the local background under it, and the alarm
// level that rides on top of the background. Anything poking through the
// dashed line is a detection. Round marks are what the width test made of it.

const PAD = { l: 46, r: 10, t: 8, b: 20 }

export function createTracePanel(canvas) {
  const ctx = canvas.getContext('2d')
  let last = null
  let onPick = () => {}

  function size() {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { w: r.width, h: r.height }
  }

  canvas.addEventListener('click', ev => {
    if (!last) return
    const r = canvas.getBoundingClientRect()
    const x = ev.clientX - r.left
    const { w } = { w: r.width }
    const az = last.xToAz(x, w)
    let best = null, bestD = 1e9
    for (const p of last.peaks) {
      const d = Math.abs(p.azimuth - az)
      if (d < bestD) { bestD = d; best = p }
    }
    if (best && bestD < 3) onPick(best)
  })

  function draw(data) {
    const { w, h } = size()
    ctx.clearRect(0, 0, w, h)
    if (!data || !data.power) {
      ctx.fillStyle = '#56646f'
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillText('press START SWEEP', PAD.l + 8, h / 2)
      return
    }
    const { angles, power, background, level, peaks, cutoff } = data
    const n = power.length
    const x0 = PAD.l, x1 = w - PAD.r, y0 = PAD.t, y1 = h - PAD.b

    // vertical scale in decades
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < n; i++) {
      const v = Math.log10(Math.max(1, power[i]))
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    lo = Math.floor(lo * 2) / 2 - 0.1
    hi = Math.ceil(hi * 2) / 2 + 0.15
    if (hi - lo < 1) hi = lo + 1

    const azA = angles[0], azB = angles[n - 1]
    const X = az => x0 + (az - azA) / (azB - azA) * (x1 - x0)
    const Y = v => y1 - (Math.log10(Math.max(1, v)) - lo) / (hi - lo) * (y1 - y0)

    // grid
    ctx.strokeStyle = 'rgba(45,60,75,0.55)'
    ctx.fillStyle = '#56646f'
    ctx.font = '9px ui-monospace, monospace'
    ctx.lineWidth = 1
    for (let d = Math.ceil(lo); d <= hi; d++) {
      const y = Y(Math.pow(10, d))
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
      ctx.fillText(`1e${d}`, 6, y + 3)
    }
    const azStep = (azB - azA) > 120 ? 30 : (azB - azA) > 60 ? 20 : 10
    for (let a = Math.ceil(azA / azStep) * azStep; a <= azB; a += azStep) {
      const x = X(a)
      ctx.strokeStyle = 'rgba(45,60,75,0.35)'
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke()
      ctx.fillText(`${a > 0 ? '+' : ''}${a}`, x - 8, h - 6)
    }
    ctx.fillText('deg', x1 - 20, h - 6)

    // the trace
    ctx.strokeStyle = '#37d0e0'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = X(angles[i]), y = Y(power[i])
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.stroke()

    // local background
    if (background) {
      ctx.strokeStyle = '#5b6b7a'
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const x = X(angles[i]), y = Y(background[i])
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
    }

    // alarm level, dashed, following the background
    if (level) {
      ctx.strokeStyle = '#f0a63a'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const x = X(angles[i]), y = Y(level[i])
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // detections
    for (const p of peaks || []) {
      const optic = p.verdict === 'OPTIC'
      const noise = p.verdict === 'noise' || p.verdict === 'unknown'
      const x = X(p.azimuth), y = Y(p.height)
      ctx.strokeStyle = optic ? '#ff4d5a' : (noise ? 'rgba(90,104,116,0.7)' : '#8d9aa6')
      ctx.lineWidth = optic ? 1.6 : 1
      ctx.beginPath(); ctx.arc(x, y, optic ? 7 : (noise ? 2.5 : 5), 0, Math.PI * 2); ctx.stroke()
      if (p.selected) {
        ctx.strokeStyle = '#ffffff'
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke()
      }
      if (optic) {
        ctx.fillStyle = '#ff4d5a'
        ctx.font = '9px ui-monospace, monospace'
        const w = p.width === null ? 'edge' : `${p.width.toFixed(2)} deg`
        ctx.fillText(w, x + 9, y - 6)
      }
    }

    if (data.note) {
      ctx.fillStyle = '#56646f'
      ctx.font = '9.5px ui-monospace, monospace'
      ctx.fillText(data.note, x0 + 4, y0 + 10)
    }

    last = { peaks: peaks || [], xToAz: (x, ww) => azA + (x - x0) / ((ww - PAD.r) - x0) * (azB - azA) }
  }

  return { draw, onPick(cb) { onPick = cb } }
}
