// tutorial.js -- seven steps, plain language, no jargon.
// Each step lights up the panel it is talking about and, where it asks for
// something to be done, waits until it has been done.

export const STEPS = [
  {
    title: 'This is the sensor',
    body: 'It stands in the middle of the plaza. It shines invisible light in a ' +
          'narrow beam and turns to look everywhere in turn. Drag to move the camera. ' +
          'Anything with a lens in it sends that light straight back.',
    highlight: '#panel-scan'
  },
  {
    title: 'Press sweep, and watch',
    body: 'Press START SWEEP. The beam turns across the scene and the graph along the ' +
          'bottom fills in as it goes. One reading for every direction it looked.',
    highlight: '#panel-scan',
    waitFor: 'sweep',
    waitText: 'Waiting for a sweep to finish…'
  },
  {
    title: 'Every bump is something reflective',
    body: 'Road signs. Windows at the right angle. A reflector on a parked car. ' +
          'They all send light back. Getting a return is not the hard part.',
    highlight: '#panel-trace'
  },
  {
    title: 'Look at the shapes, not the heights',
    body: 'Most of the bumps are wide and rounded. One of them, if he is out there, ' +
          'is a needle: it rises and falls within a fraction of a degree.',
    highlight: '#panel-trace'
  },
  {
    title: 'That needle is a lens',
    body: 'A lens is ground and polished, so it throws the light back along the exact ' +
          'line it arrived on. A moulded plastic road sign cannot be made that precisely, ' +
          'so its answer is spread over degrees. That difference is the whole idea. ' +
          'The table lists the width of every bump we found.',
    highlight: '#panel-detections'
  },
  {
    title: 'The alarm line is not a number we chose',
    body: 'Change the false alarm rate and watch the dashed line move. We never pick ' +
          'a level because it looks about right. We choose how often we are willing ' +
          'to be wrong, and the line follows from how much the reading wobbles.',
    highlight: '#panel-detect',
    waitFor: 'far',
    waitText: 'Change the false alarm rate to carry on…'
  },
  {
    title: 'Now find him',
    body: 'A sniper is on one of these rooftops. Sweep, read the widths, and flag him ' +
          'before the timer runs out. If you cannot see him at all, watch the passive ' +
          'channel: when he ranges his target, his own beam ends here.',
    highlight: '#panel-scene',
    final: true
  }
]

export function createTutorial(els, api) {
  let i = 0
  let waiting = null

  function highlight(sel) {
    document.querySelectorAll('.highlight-panel').forEach(e => e.classList.remove('highlight-panel'))
    if (sel) document.querySelector(sel)?.classList.add('highlight-panel')
  }

  function render() {
    const s = STEPS[i]
    els.n.textContent = String(i + 1)
    els.title.textContent = s.title
    els.body.textContent = s.body
    els.back.disabled = i === 0
    waiting = s.waitFor || null
    els.next.textContent = s.final ? 'Start the hunt' : 'Next'
    els.next.disabled = !!waiting
    if (waiting) els.body.textContent = s.body + '  ' + (s.waitText || '')
    highlight(s.highlight)
  }

  return {
    get step() { return i },
    start() { i = 0; els.root.classList.remove('hidden'); render() },
    quit() { els.root.classList.add('hidden'); highlight(null) },
    next() {
      const s = STEPS[i]
      if (s.final) { this.quit(); api.startHunt(); return }
      i = Math.min(STEPS.length - 1, i + 1)
      render()
    },
    back() { i = Math.max(0, i - 1); render() },
    // main.js calls this when something happens in the simulator
    notify(event) {
      if (waiting && waiting === event) {
        waiting = null
        els.next.disabled = false
        els.body.textContent = STEPS[i].body + '  Good. Press Next.'
      }
    },
    get active() { return !els.root.classList.contains('hidden') }
  }
}
