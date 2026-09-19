// polar.js -- the plan view. Bearing around, range outwards, one mark per
// detection. Red marks are the narrow returns.

export function createPolar(canvas) {
  const ctx = canvas.getContext('2d')

  function draw({ detections = [], maxRange = 800, sweepAz = null, sector = null, passive = null }) {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const w0 = Math.round(r.width * dpr), h0 = Math.round(r.height * dpr)
    if (canvas.width !== w0 || canvas.height !== h0) { canvas.width = w0; canvas.height = h0 }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = r.width, h = r.height
    ctx.clearRect(0, 0, w, h)

    const cx = w / 2, cy = h * 0.92, R = Math.min(w / 2 - 8, h * 0.86)
    const P = (bearing, range) => {
      const a = (bearing) * Math.PI / 180
      const rr = Math.min(1, range / maxRange) * R
      return [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr]
    }

    // range rings
    ctx.strokeStyle = 'rgba(45,60,75,0.7)'
    ctx.fillStyle = '#56646f'
    ctx.font = '8.5px ui-monospace, monospace'
    for (let i = 1; i <= 4; i++) {
      const rr = R * i / 4
      ctx.beginPath(); ctx.arc(cx, cy, rr, Math.PI, Math.PI * 2); ctx.stroke()
      ctx.fillText(`${Math.round(maxRange * i / 4)}m`, cx + 3, cy - rr + 9)
    }
    // bearing spokes
    for (let a = -90; a <= 90; a += 30) {
      const [x, y] = P(a, maxRange)
      ctx.strokeStyle = 'rgba(45,60,75,0.45)'
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
      const [lx, ly] = P(a, maxRange * 1.04)
      ctx.fillText(`${a > 0 ? '+' : ''}${a}`, lx - 7, ly + 4)
    }

    // the sector being scanned
    if (sector) {
      ctx.fillStyle = 'rgba(55,208,224,0.07)'
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R, (sector[0] - 90) * Math.PI / 180, (sector[1] - 90) * Math.PI / 180)
      ctx.closePath(); ctx.fill()
    }

    // where the beam is now
    if (sweepAz !== null) {
      const [x, y] = P(sweepAz, maxRange)
      ctx.strokeStyle = 'rgba(55,208,224,0.75)'
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
    }

    // the passive bearing, if his beam has been caught
    if (passive && passive.bearingHint) {
      const [x, y] = P(passive.bearingHint.bearing, maxRange)
      ctx.strokeStyle = 'rgba(240,166,58,0.8)'
      ctx.setLineDash([5, 4])
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
      ctx.setLineDash([])
    }

    for (const d of detections) {
      if (d.range === null || d.range === undefined) continue
      const [x, y] = P(d.bearing, d.range)
      const optic = d.verdict === 'OPTIC'
      ctx.fillStyle = optic ? '#ff4d5a' : 'rgba(141,154,166,0.75)'
      ctx.beginPath(); ctx.arc(x, y, optic ? 3.4 : 2.2, 0, Math.PI * 2); ctx.fill()
      if (d.selected) {
        ctx.strokeStyle = '#fff'
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke()
      }
    }

    // the sensor
    ctx.fillStyle = '#37d0e0'
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill()
  }

  return { draw }
}
