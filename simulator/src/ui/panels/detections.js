// detections.js -- the table. Every crossing of the alarm line, what it
// measured, and what we made of it.

const VERDICT_TEXT = {
  OPTIC: 'OPTIC',
  clutter: 'clutter',
  // narrower than our own beam, so it cannot be a return from anything
  noise: 'noise',
  unknown: 'off edge'
}

export function createDetectionsTable(table) {
  const tbody = table.querySelector('tbody')
  let rows = []
  let sortKey = 'interest'
  let sortDir = 1
  // OPTIC first, then clutter, then the detector's own noise. Within a
  // group, the strongest return first.
  const RANK = { OPTIC: 0, clutter: 1, unknown: 2, noise: 3 }
  let onSelect = () => {}
  let selectedId = null

  table.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1 }
      render()
    })
  })

  function fmt(v, d = 1, dash = '—') {
    return (v === null || v === undefined || Number.isNaN(v)) ? dash : v.toFixed(d)
  }

  function render() {
    const sorted = rows.slice().sort((a, b) => {
      if (sortKey === 'interest') {
        const r = (RANK[a.verdict] ?? 9) - (RANK[b.verdict] ?? 9)
        return r !== 0 ? r : (b.height || 0) - (a.height || 0)
      }
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return sortDir * String(av).localeCompare(String(bv))
      const an = av === null || av === undefined ? 1e9 : av
      const bn = bv === null || bv === undefined ? 1e9 : bv
      return sortDir * (an - bn)
    })
    tbody.innerHTML = ''
    for (const d of sorted) {
      const tr = document.createElement('tr')
      if (d.verdict === 'OPTIC') tr.className = 'optic'
      else if (d.verdict === 'noise' || d.verdict === 'unknown') tr.className = 'noise'
      if (d.id === selectedId) tr.className += ' sel'
      tr.innerHTML =
        `<td>${fmt(d.bearing, 1)}</td>` +
        `<td>${fmt(d.elevation, 1)}</td>` +
        `<td>${d.range === null ? '—' : Math.round(d.range)}</td>` +
        `<td>${d.width === null ? 'edge' : fmt(d.width, 2)}</td>` +
        `<td>${d.ratio === null || d.ratio === undefined ? '—' : fmt(d.ratio, 2)}</td>` +
        `<td class="v">${VERDICT_TEXT[d.verdict] || d.verdict}</td>`
      tr.addEventListener('click', () => { selectedId = d.id; render(); onSelect(d) })
      tbody.appendChild(tr)
    }
  }

  return {
    set(list) { rows = list; render() },
    clear() { rows = []; selectedId = null; render() },
    select(id) { selectedId = id; render() },
    get selected() { return rows.find(r => r.id === selectedId) || null },
    get rows() { return rows },
    onSelect(cb) { onSelect = cb }
  }
}
