// export.js -- get the numbers out so somebody else can check them.
//
// Three things come out of here:
//   sweep_*.csv   every sample: azimuth, elevation, return, background, level
//   run_*.json    the seed, every setting, every detection, and the truth
//   verify_detection.py  a short script that re-runs the five steps on the
//                        CSV, on its own, and says whether it agrees
//
// The last one is the point. It lets anybody take the exported file away and
// prove that the browser is not making its answers up.

import { K_TABLE } from './sim/detect.js'

function download(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export function sweepToCsv(run) {
  const { plan, rows, settings, results } = run
  const out = []
  out.push('# optical anti-sniper simulator, sweep export')
  out.push('# every value below is simulated. no measurement of any real scene.')
  out.push(`# generated=${new Date().toISOString()}`)
  out.push(`# seed=${settings.seed}`)
  out.push(`# conditions=${settings.preset}`)
  out.push(`# background_level=${settings.backgroundLevel}`)
  out.push(`# noise_sigma=${settings.noiseSigma}`)
  out.push(`# extinction_per_m=${settings.extinction}`)
  out.push(`# beam_width_deg=${plan.beamWidth}`)
  out.push(`# az_step_deg=${plan.azStep}`)
  out.push(`# el_step_deg=${plan.elStep}`)
  out.push(`# false_alarm_rate=${settings.far}`)
  out.push(`# k=${settings.k}`)
  out.push(`# width_cutoff_deg=${settings.cutoff}`)
  out.push(`# background_window_deg=${settings.windowDeg}`)
  out.push(`# min_separation_deg=${settings.minSeparationDeg}`)
  out.push(`# rows=${rows.length}`)
  out.push(`# samples_per_row=${plan.nAz}`)
  out.push('azimuth_deg,elevation_deg,return_power,background,alarm_level')
  for (const r of rows) {
    const el = r.elevation.toFixed(4)
    const res = results[r.index]
    for (let i = 0; i < plan.nAz; i++) {
      out.push(
        plan.angles[i].toFixed(4) + ',' + el + ',' +
        r.power[i].toExponential(10) + ',' +
        res.background[i].toExponential(10) + ',' +
        res.level[i].toExponential(10)
      )
    }
  }
  return out.join('\n') + '\n'
}

export function runToJson(run) {
  const { plan, settings, detections, truth, scoring, results, rows } = run

  // Every peak the five steps found, in every line of the raster, before
  // anything was merged for display. This is what verify_detection.py
  // reproduces, because this is the algorithm's own output.
  const rowDetections = []
  ;(results || []).forEach((res, i) => {
    for (const p of res.peaks) {
      rowDetections.push({
        bearing_deg: round(p.azimuth, 4),
        elevation_deg: round(rows[i].elevation, 4),
        width_deg: p.width === null ? null : round(p.width, 4),
        return_power: p.height,
        verdict: p.verdict
      })
    }
  })
  return JSON.stringify({
    note: 'Simulated scene. Geometric optics only. No electromagnetic solver. ' +
          'Target strengths, widths, colour ratios, background and noise levels ' +
          'are assumed figures, not measurements.',
    generated: new Date().toISOString(),
    seed: settings.seed,
    settings: {
      conditions: settings.preset,
      background_level: settings.backgroundLevel,
      noise_sigma: settings.noiseSigma,
      extinction_per_m: settings.extinction,
      azimuth_sector_deg: [plan.azMin, plan.azMax],
      elevation_range_deg: [plan.elMin, plan.elMax],
      beam_width_deg: plan.beamWidth,
      dwell_ms: plan.dwellMs,
      priority_scan_floor_deg: plan.priorityFloor,
      beam_positions: plan.beamPositions,
      frame_time_ms: plan.frameTimeMs,
      az_step_deg: plan.azStep,
      el_step_deg: plan.elStep,
      false_alarm_rate: settings.far,
      k: settings.k,
      width_cutoff_deg: settings.cutoff,
      background_window_deg: settings.windowDeg,
      min_separation_deg: settings.minSeparationDeg,
      two_colour: settings.twoColour,
      scope_quality: settings.quality,
      magnification: settings.magnification
    },
    row_detections: rowDetections,
    detections_note: 'row_detections is every peak in every line of the raster, ' +
      'straight out of the five steps. detections below is the same list with ' +
      'neighbouring lines merged, which is what the operator sees.',
    detections: detections.map(d => ({
      bearing_deg: round(d.bearing, 4), elevation_deg: round(d.elevation, 4),
      range_m: d.range === null ? null : round(d.range, 1),
      width_deg: d.width === null ? null : round(d.width, 4),
      colour_ratio: d.ratio === null || d.ratio === undefined ? null : round(d.ratio, 4),
      return_power: d.height, above_background: round(d.above, 3),
      alarm_level: round(d.level, 3), verdict: d.verdict
    })),
    ground_truth: truth,
    scoring: scoring || null
  }, null, 1)
}

const round = (v, d) => (v === null || v === undefined) ? null : Number(v.toFixed(d))

export function pythonVerifier() {
  const table = K_TABLE.map(r => `    ${r.far.toExponential(0)}: ${r.k},`).join('\n')
  return `#!/usr/bin/env python3
"""
verify_detection.py  --  check the browser's answers, independently.

    python verify_detection.py sweep.csv [run.json]

Reads the exported sweep, re-runs the five detection steps with nothing but
numpy, and prints what it finds. If the run's JSON is given as well, it
compares the two lists and says whether they agree.

THE FIVE STEPS, same as src/detect.py in the main repository:
  1. local background, a running median over a window of the trace
  2. wobble, the median absolute deviation, scaled to a standard deviation
  3. alarm level, background + wobble * k, with k set by the false alarm rate
  4. peaks above that level, with a minimum separation
  5. full width at half maximum, then narrow means an optic

Nothing here reads anything the browser computed, apart from the raw returns.
"""

import sys
import json
import numpy as np

# how many wobbles out a chosen rate of wrong alarms demands
K_TABLE = {
${table}
}


def read_csv(path):
    meta, header, rows = {}, None, []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            if line.startswith('#'):
                if '=' in line:
                    key, _, val = line[1:].strip().partition('=')
                    meta[key.strip()] = val.strip()
                continue
            if header is None:
                header = line.split(',')
                continue
            rows.append(line.split(','))
    data = np.array(rows, dtype=float)
    return meta, header, data


# ---------------------------------------------------------------- step 1
def local_background(power, step_deg, window_deg):
    """Running median. The median ignores a few very large values, so a bright
    spot cannot inflate its own background estimate. Edges repeat the end
    value, which is what scipy calls mode='nearest'."""
    n = len(power)
    w = max(3, int(window_deg / step_deg))
    if w % 2 == 0:
        w += 1
    if w > n:
        w = n - 1 if n % 2 == 0 else n
    h = (w - 1) // 2
    padded = np.concatenate([np.full(h, power[0]), power, np.full(h, power[-1])])
    windows = np.lib.stride_tricks.sliding_window_view(padded, w)
    return np.median(windows, axis=-1)


# ---------------------------------------------------------------- step 2
def wobble(power, background):
    """Median absolute deviation, times 1.4826, which turns it into the
    equivalent standard deviation for normal noise."""
    resid = power - background
    return float(1.4826 * np.median(np.abs(resid - np.median(resid))))


# ---------------------------------------------------------------- step 4
def find_peaks(power, level, min_sep):
    """Local maxima above the alarm line. The tallest wins, and anything
    within min_sep samples of an accepted peak is dropped, so one wide hump
    is not counted several times."""
    above = power - level
    cand = [i for i in range(1, len(power) - 1)
            if above[i] > 0 and power[i] > power[i - 1] and power[i] >= power[i + 1]]
    cand.sort(key=lambda i: -above[i])
    keep = []
    for i in cand:
        if all(abs(i - j) >= min_sep for j in keep):
            keep.append(i)
    return sorted(keep)


# ---------------------------------------------------------------- step 5
def measure_width(angles, power, background, p):
    """Full width at half maximum, measured above the LOCAL background.
    None if the spot runs off the edge, because then we cannot say."""
    base = background[p]
    height = power[p] - base
    if height <= 0:
        return None
    half = base + height / 2.0
    i = p
    while i > 0 and power[i] > half:
        i -= 1
    if i == 0:
        return None
    j = p
    while j < len(power) - 1 and power[j] > half:
        j += 1
    if j == len(power) - 1:
        return None
    return abs(float(angles[j] - angles[i]))


def classify(width, cutoff, beam_limit):
    """Narrower than our own beam means nobody is there. Otherwise narrow
    means an optic and wide means clutter."""
    if width is None:
        return 'unknown'
    if width < beam_limit:
        return 'noise'
    return 'OPTIC' if width < cutoff else 'clutter'


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    meta, _, data = read_csv(sys.argv[1])

    step = float(meta['az_step_deg'])
    window = float(meta['background_window_deg'])
    cutoff = float(meta['width_cutoff_deg'])
    beam = float(meta['beam_width_deg'])
    # nothing can answer narrower than the beam that lit it, so a spike
    # below this is the detector's own noise crossing the line
    beam_limit = 1.25 * beam
    min_sep = max(3, int(round(float(meta['min_separation_deg']) / step)))
    far = float(meta['false_alarm_rate'])
    k = K_TABLE.get(far)
    if k is None:
        k = min(K_TABLE.items(), key=lambda kv: abs(np.log10(kv[0]) - np.log10(far)))[1]

    print('conditions      ', meta.get('conditions'))
    print('seed            ', meta.get('seed'))
    print('false alarm rate ', far, ' -> k =', k, '(we chose the rate, the level follows)')
    print('width cutoff    ', cutoff, 'deg')
    print('beam width      ', beam, 'deg  -> nothing real can be narrower than',
          f'{beam_limit:.3f} deg')
    print()

    found = []
    for el in np.unique(data[:, 1]):
        row = data[data[:, 1] == el]
        angles, power = row[:, 0], row[:, 2]
        bg = local_background(power, step, window)
        wob = wobble(power, bg)
        level = bg + wob * k

        # the browser wrote its own background and level into the file. we
        # recomputed ours from the returns alone: they should agree.
        if not np.allclose(bg, row[:, 3], rtol=1e-6, atol=1e-6):
            print('MISMATCH in background at elevation', el)
        if not np.allclose(level, row[:, 4], rtol=1e-6, atol=1e-6):
            print('MISMATCH in alarm level at elevation', el)

        for p in find_peaks(power, level, min_sep):
            w = measure_width(angles, power, bg, p)
            found.append({
                'bearing': float(angles[p]), 'elevation': float(el),
                'width': w, 'power': float(power[p]),
                'verdict': classify(w, cutoff, beam_limit)
            })

    print(f'{"bearing":>9} {"elev":>7} {"width":>8} {"return":>12}  verdict')
    for f in sorted(found, key=lambda f: f['bearing']):
        w = '    edge' if f['width'] is None else f'{f["width"]:8.3f}'
        print(f'{f["bearing"]:9.2f} {f["elevation"]:7.2f} {w} {f["power"]:12.4g}  {f["verdict"]}')
    print()
    n_noise = sum(1 for f in found if f['verdict'] == 'noise')
    print(f'{len(found)} crossings of the alarm line, '
          f'{sum(1 for f in found if f["verdict"] == "OPTIC")} narrow enough to be an optic, '
          f'{n_noise} too narrow to be anything (our own noise)')

    if len(sys.argv) > 2:
        with open(sys.argv[2]) as fh:
            run = json.load(fh)
        browser = run.get('row_detections', run['detections'])
        ok = compare(browser, found)
        print()
        print('AGREES WITH THE BROWSER' if ok else 'DOES NOT AGREE WITH THE BROWSER')
        return 0 if ok else 1
    return 0


def compare(browser, mine, tol=1e-6):
    if len(browser) != len(mine):
        print(f'count differs: browser {len(browser)}, this script {len(mine)}')
        return False
    b = sorted(browser, key=lambda d: (d['elevation_deg'], d['bearing_deg']))
    m = sorted(mine, key=lambda d: (d['elevation'], d['bearing']))
    ok = True
    for x, y in zip(b, m):
        if abs(x['bearing_deg'] - y['bearing']) > tol:
            print('bearing differs', x['bearing_deg'], y['bearing']); ok = False
        if (x['width_deg'] is None) != (y['width'] is None):
            print('width presence differs at', x['bearing_deg']); ok = False
        elif x['width_deg'] is not None and abs(x['width_deg'] - y['width']) > 1e-3:
            print('width differs at', x['bearing_deg'], x['width_deg'], y['width']); ok = False
        if x['verdict'] != y['verdict']:
            print('verdict differs at', x['bearing_deg'], x['verdict'], y['verdict']); ok = False
    return ok


if __name__ == '__main__':
    sys.exit(main())
`
}

export function exportRun(run) {
  const t = stamp()
  download(`sweep_${t}.csv`, sweepToCsv(run), 'text/csv')
  download(`run_${t}.json`, runToJson(run), 'application/json')
  return t
}

export function exportForPython(run) {
  const t = exportRun(run)
  download('verify_detection.py', pythonVerifier(), 'text/x-python')
  return t
}
