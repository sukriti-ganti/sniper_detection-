# Optical anti-sniper simulator

A browser simulator of an optical anti-sniper sensor.

A sensor stands at a protected point in a city. It sweeps an invisible
infrared beam across the surroundings. Anything with a lens in it sends that
light straight back in a very narrow flash. Road signs and windows send it
back too, but much wider. The system measures the **width** of every return
and flags the narrow ones.

You are the operator. Run sweeps, read the returns, and find the man before
he takes his shot.

**Detection is easy. Discrimination is the problem.** Everything reflective
crosses the alarm line at short range. Only the width separates a rifle scope
from a road sign, and the whole program exists to make that visible.

## Run it

    npm install
    npm run dev

Or build it and open the folder, no server needed:

    npm run build
    npm run preview        # or just open dist/index.html

There are no network calls at runtime and no downloaded assets. The city, the
textures and the targets are all generated from a seed.

## What is in here

    src/
      main.js            boot, and the loop that ties the world to the detector
      rng.js             seeded random numbers, so a run can be repeated
      world/
        city.js          procedural seeded city, windows and ground grid
        lighting.js      day, dusk, night and fog, each carrying its own
                         background, noise and extinction numbers
        props.js         sensor unit, beam, barriers, vehicles, checkpoint,
                         floodlights, fencing, helipad
      sim/
        targets.js       what reflects, how wide, how strong, what colour
        visibility.js    ray casting line of sight against the real meshes
        optics.js        the return power model
        sweep.js         the raster scan, and what a frame costs
        detect.js        THE VERDICT: background, wobble, level, peaks, width
        passive.js       catching his rangefinder pulse
        sniper.js        the sniper state machine
      ui/
        hud.js           panels, readouts, and one plain sentence per number
        panels/          trace, waterfall, plan view, detections, tutorial
        theme.css
      export.js          CSV, JSON, and the Python verification script
    tools/
      acceptance.mjs     drives the real interface and checks the
                         acceptance criteria from the specification

## The five steps

`src/sim/detect.js` is a direct port of `src/detect.py` in the main
repository, and it is the point of the whole project.

1. **Local background.** A running median over ten degrees of the trace. The
   median, not the mean, so that a bright return cannot inflate its own
   background estimate.
2. **Wobble.** The median absolute deviation of what is left, times 1.4826,
   which turns it into the equivalent standard deviation.
3. **Alarm level.** `background + wobble * k`, where `k` comes from the
   false alarm rate you chose. Never a threshold anybody typed in.
4. **Peaks.** Local maxima above that level, then anything closer together
   than the half maximum widths of the two peaks is the same object answering
   twice, and the taller one keeps it.
5. **Width.** Full width at half maximum, measured above the local
   background. Narrower than the cutoff is an optic. Wider is clutter.

One thing is added to the Python original, and it matters: **a peak narrower
than the beam that lit it cannot be a return from anything**, because the
model's own hump can never be narrower than the beam. Such a peak is called
noise rather than an optic. Without it, one wrong alarm in ten thousand,
across the hundred and seventy thousand samples of a default sweep, labels
about seventeen noise spikes an optic every time.

## Checking the numbers away from the browser

Press **Verify in Python**. Three files are written: the sweep as a CSV, the
run as JSON, and `verify_detection.py`. Then:

    python verify_detection.py sweep_*.csv run_*.json

The script reads nothing but the raw returns. It recomputes the background,
the wobble, the level, the peaks and the widths with numpy alone, compares
its own list against the browser's, and says whether they agree.

## Checking the whole thing

`tools/acceptance.mjs` walks the acceptance criteria by clicking the real
controls. It needs playwright installed alongside, which is deliberately not
a dependency of this project:

    npm run build && npm run preview &
    node tools/acceptance.mjs http://localhost:4173/

The frame rate criterion is reported rather than judged, because a headless
browser usually falls back to a software rasteriser. The scan panel shows a
live drawing rate for checking that on the real machine.

## What this is not

- It is a **simulated scene**. No real sniper has been detected by it.
- The optics are **geometric optics only**. There is no electromagnetic
  solver, no wave propagation and no material model.
- Target strengths, widths, colour ratios, background levels, noise levels
  and the passive channel constants are **assumed** figures, chosen for the
  right ratios between kinds and conditions. They are not calibrated against
  any instrument, and the interface labels them as assumed.
- The one thing that is not a formula is the line of sight. It is cast as a
  real ray against the same buildings you can see, every sweep.

The About and Limits panels in the program say the same thing, at more
length, including what the sensor cannot do.
