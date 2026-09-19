# """
# detect.py  --  THE VERDICT

# Reads a list of brightness values and says what is out there.

# FIVE STEPS
#   1. Estimate the background AT EVERY POINT, not one number for the whole sweep
#   2. Work out how much the reading wobbles around that background
#   3. Set the alarm level from a chosen error rate, not by guessing
#   4. Find every bright spot above that level
#   5. Measure how wide each spot is, and decide

# WHY STEP 1 MATTERS
# One alarm level for the whole sweep does not work. Some parts of a scene
# are bright and some are dark. Set one level and you either flood the bright
# parts with false alarms or go blind in the dark parts.

# So we estimate the background separately at every angle, using a running
# median of the readings around it. The alarm level then rides up and down
# with the scene. Radar engineers call this a constant false alarm rate
# detector, because the rate of wrong alarms stays the same no matter how
# bright the surroundings are.
# """

import numpy as np
from scipy.signal import find_peaks
from scipy.ndimage import median_filter
from scipy.stats import norm

WIDTH_CUTOFF = 0.90     # a flash narrower than this many degrees is an optic
WINDOW_DEG = 10.0       # how far either side we look to estimate background


# ------------------------------------------------------------------ step 1
def local_background(brightness, step_deg, window_deg=WINDOW_DEG):
    # """
    # The background at every point, found by taking the median of the
    # readings around it.

    # We use the median, not the average, because the median ignores a few
    # very large values. A bright spot sitting inside the window barely
    # moves it, so the spot does not inflate its own background estimate.
    # """
    n = max(3, int(window_deg / step_deg) | 1)   # odd number of samples
    return median_filter(brightness, size=n, mode="nearest")


# ------------------------------------------------------------------ step 2
def wobble(brightness, background):
    # """
    # How much the reading moves about, once the background is taken away.

    # We use the median absolute deviation rather than the ordinary standard
    # deviation, because a few bright spots would inflate the ordinary one
    # and push the alarm level far too high.

    # The 1.4826 converts a median absolute deviation into the equivalent
    # standard deviation for normal noise.
    # """
    residual = brightness - background
    return float(1.4826 * np.median(np.abs(residual - np.median(residual))))


# ------------------------------------------------------------------ step 3
def alarm_level(background, wob, false_alarm_rate):
    # """
    # Where to put the alarm line, at every point.

    #     level = background + wobble x (how many wobbles out we need to go)

    # We choose how often we will accept a wrong alarm FIRST, and the level
    # follows from that. We never pick a number because it looks about right.

    #   1 wrong in 100      ->  2.33 wobbles out
    #   1 wrong in 10,000   ->  3.72 wobbles out
    # """
    return background + wob * norm.isf(false_alarm_rate)


# ------------------------------------------------------------------ step 4
def find_spots(brightness, level, min_separation=20):
    # """
    # Every bright spot that crosses the alarm line.

    # min_separation stops one wide hump being counted as several spots.
    # """
    above = brightness - level
    peaks, _ = find_peaks(above, height=0.0, distance=min_separation)
    return peaks


# ------------------------------------------------------------------ step 5
def measure_width(angles, brightness, background, peak_index):
    # """
    # How many degrees wide is this flash?

    # Take the peak height above the LOCAL background, go halfway down, and
    # measure the distance between the two points where the curve crosses
    # that halfway line. This is the full width at half maximum.

    # Returns None if the spot runs off the edge of the sweep.
    # """
    base = background[peak_index]
    height = brightness[peak_index] - base
    if height <= 0:
        return None
    half = base + height / 2.0

    i = peak_index
    while i > 0 and brightness[i] > half:
        i -= 1
    if i == 0:
        return None

    j = peak_index
    while j < len(brightness) - 1 and brightness[j] > half:
        j += 1
    if j == len(brightness) - 1:
        return None

    return float(angles[j] - angles[i])


def classify(width, cutoff=WIDTH_CUTOFF):
    # """Narrow means an optic. Wide means a road sign or a reflector."""
    if width is None:
        return "unknown"
    return "OPTIC" if width < cutoff else "clutter"


# ------------------------------------------------------------------ all of it
def run(angles, brightness, step_deg, false_alarm_rate=1e-4):
    # """
    # One sweep in, a list of verdicts out.

    # Each verdict has: angle, height, above, width, verdict.
    # Also returns the background, the alarm level, and the wobble, for plotting.
    # """
    bg = local_background(brightness, step_deg)
    wob = wobble(brightness, bg)
    level = alarm_level(bg, wob, false_alarm_rate)

    results = []
    for p in find_spots(brightness, level):
        w = measure_width(angles, brightness, bg, p)
        results.append({
            "angle": float(angles[p]),
            "height": float(brightness[p]),
            "above": float(brightness[p] - bg[p]),
            "width": w,
            "verdict": classify(w),
        })
    return results, bg, level, wob


# ------------------------------------------------------------------ scoring
def roc(optic_widths, clutter_widths, n_points=400):
    # """
    # Try every possible width cutoff. For each one record how often we catch
    # a real optic and how often we wrongly flag clutter.
    # """
    optic = np.asarray([w for w in optic_widths if w is not None])
    clut = np.asarray([w for w in clutter_widths if w is not None])
    cutoffs = np.linspace(0.02, 8.0, n_points)

    caught = np.array([(optic < c).mean() for c in cutoffs])
    wrong = np.array([(clut < c).mean() for c in cutoffs])
    return wrong, caught, cutoffs


def area_under(wrong, caught):
    # """1.0 is perfect. 0.5 is a coin flip."""
    order = np.argsort(wrong)
    return float(np.trapezoid(caught[order], wrong[order]))