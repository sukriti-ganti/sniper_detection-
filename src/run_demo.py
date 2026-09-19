"""
run_demo.py  --  RUN EVERYTHING

    python src/run_demo.py

Prints the results and saves three figures into figures/.
"""

import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import scene
import sweep
import detect

HERE = os.path.dirname(os.path.abspath(__file__))
FIGS = os.path.join(HERE, "..", "figures")
os.makedirs(FIGS, exist_ok=True)

rng = np.random.default_rng(7)

print("=" * 68)
print("FINDING A RIFLE SCOPE BY THE LIGHT IT SENDS BACK")
print("=" * 68)
print(f"  sweep      {sweep.START_ANGLE:+.0f} to {sweep.END_ANGLE:+.0f} degrees")
print(f"  step size  {sweep.STEP} degrees")
print(f"  our beam   {sweep.BEAM_WIDTH} degrees wide")
print()

# --------------------------------------------------------------- background
print("-" * 68)
print("STEP 1  learn what an empty scene looks like")
print("-" * 68)
_, empty = sweep.empty_sweep(rng)
bg0 = detect.local_background(empty, sweep.STEP)
wob0 = detect.wobble(empty, bg0)
print(f"  average reading   {empty.mean():8.1f}")
print(f"  wobble            {wob0:8.1f}")

from scipy.stats import norm
for rate in [1e-2, 1e-3, 1e-4, 1e-5]:
    k = norm.isf(rate)
    print(f"  1 wrong alarm in {int(1/rate):>7,}  means going {k:.2f} wobbles out "
          f"-> level {empty.mean() + wob0*k:8.1f}")
print()

FA = 1e-4

# --------------------------------------------------------------- one scene
print("-" * 68)
print("STEP 2  look at one scene")
print("-" * 68)
targets = scene.make_scene(seed=3)
angles, bright = sweep.sweep(targets, rng)
results, bg, level, wob = detect.run(angles, bright, sweep.STEP, FA)

truth = {round(t["angle"], 1): t["kind"] for t in targets}
print(f"  {'angle':>8}  {'width':>7}  {'verdict':>9}   truth")
for r in results:
    nearest = min(truth, key=lambda a: abs(a - r["angle"]))
    actual = truth[nearest] if abs(nearest - r["angle"]) < 2 else "?"
    w = f"{r['width']:.2f}" if r["width"] else "  -  "
    print(f"  {r['angle']:+8.1f}  {w:>7}  {r['verdict']:>9}   {actual}")
print()

# --------------------------------------------------------------- many scenes
print("-" * 68)
print("STEP 3  run 300 scenes and count")
print("-" * 68)
optic_w, clutter_w = [], []
caught = missed = 0

for i in range(300):
    tg = scene.make_scene(with_optic=True, seed=1000 + i)
    ang, br = sweep.sweep(tg, rng)
    res, _, _, _ = detect.run(ang, br, sweep.STEP, FA)

    optic_angle = [t["angle"] for t in tg if t["kind"] in scene.OPTICS][0]
    found = False
    for r in res:
        near_optic = abs(r["angle"] - optic_angle) < 2.0
        if near_optic:
            optic_w.append(r["width"])
            if r["verdict"] == "OPTIC":
                found = True
        else:
            clutter_w.append(r["width"])
    caught += found
    missed += not found

optic_clean = [w for w in optic_w if w is not None]
clut_clean = [w for w in clutter_w if w is not None]

print(f"  optics seen       {len(optic_clean):4d}   "
      f"median width {np.median(optic_clean):.2f} deg")
print(f"  clutter seen      {len(clut_clean):4d}   "
      f"median width {np.median(clut_clean):.2f} deg")
print()
print(f"  optics correctly flagged   {caught:3d} of 300  "
      f"({100*caught/300:.1f} %)")
wrong = sum(1 for w in clut_clean if w < detect.WIDTH_CUTOFF)
print(f"  clutter wrongly flagged    {wrong:3d} of {len(clut_clean)}  "
      f"({100*wrong/len(clut_clean):.1f} %)")
print()

wrong_r, caught_r, cutoffs = detect.roc(optic_clean, clut_clean)
auc = detect.area_under(wrong_r, caught_r)
print(f"  area under the curve  {auc:.4f}   (1.0 perfect, 0.5 coin flip)")
print()

# --------------------------------------------------------------- figure 1
fig, ax = plt.subplots(figsize=(11, 4.2))
ax.plot(angles, bright, lw=0.8, color="#3E5A78", label="what came back")
ax.plot(angles, level, color="#C8372D", ls="--", lw=1.2,
        label=f"alarm level (1 wrong in {int(1/FA):,})")
ax.plot(angles, bg, color="#9FB2C6", lw=1.0, label="local background")
for r in results:
    c = "#C8372D" if r["verdict"] == "OPTIC" else "#9FB2C6"
    ax.plot(r["angle"], r["height"], "o", ms=9, mfc="none", mec=c, mew=2)
ax.set_yscale("log")
ax.set_xlabel("which direction we are pointing (degrees)")
ax.set_ylabel("brightness coming back")
ax.set_title("One sweep: everything reflective is found, one is an optic")
ax.legend(fontsize=9)
ax.grid(alpha=0.2)
fig.tight_layout()
fig.savefig(os.path.join(FIGS, "1_sweep.png"), dpi=130)
print("saved figures/1_sweep.png")

# --------------------------------------------------------------- figure 2
optic_r = [r for r in results if r["verdict"] == "OPTIC"]
clut_r = sorted([r for r in results if r["verdict"] == "clutter"],
                key=lambda r: -r["height"])

fig, axes = plt.subplots(1, 2, figsize=(11, 3.8), sharey=True)
for ax, r, col, name in [(axes[0], clut_r[0] if clut_r else None, "#3E5A78", "clutter"),
                         (axes[1], optic_r[0] if optic_r else None, "#C8372D", "optic")]:
    if r is None:
        continue
    m = np.abs(angles - r["angle"]) < 4
    ax.plot(angles[m], bright[m] - bg[m], lw=1.6, color=col)
    half = r["above"] / 2
    ax.axhline(half, color="#8FA6BC", ls=":", lw=1.2)
    ax.set_title(f"{name}: {r['width']:.2f} degrees wide")
    ax.set_xlabel("degrees from the peak")
    ax.grid(alpha=0.2)
axes[0].set_ylabel("brightness above background")
fig.suptitle("Same measurement, same axes. The width is the difference.")
fig.tight_layout()
fig.savefig(os.path.join(FIGS, "2_width.png"), dpi=130)
print("saved figures/2_width.png")

# --------------------------------------------------------------- figure 3
fig, axes = plt.subplots(1, 2, figsize=(11, 4.0))

bins = np.linspace(0, 5, 45)
axes[0].hist(clut_clean, bins=bins, alpha=0.7, color="#3E5A78", label="clutter")
axes[0].hist(optic_clean, bins=bins, alpha=0.8, color="#C8372D", label="optics")
axes[0].axvline(detect.WIDTH_CUTOFF, color="#111E2C", ls="--", lw=1.6)
axes[0].text(detect.WIDTH_CUTOFF + 0.1, axes[0].get_ylim()[1] * 0.8,
             "cutoff", fontsize=9)
axes[0].set_xlabel("measured width (degrees)")
axes[0].set_ylabel("how many")
axes[0].set_title("They barely overlap")
axes[0].legend(fontsize=9)

axes[1].plot(wrong_r, caught_r, lw=2, color="#C8372D")
axes[1].plot([0, 1], [0, 1], "k--", lw=0.7, alpha=0.4)
axes[1].set_xlabel("how often we wrongly flag clutter")
axes[1].set_ylabel("how often we catch a real optic")
axes[1].set_title(f"Every possible cutoff at once (area {auc:.3f})")
axes[1].grid(alpha=0.2)
axes[1].set_xlim(0, 1)
axes[1].set_ylim(0, 1.02)

fig.tight_layout()
fig.savefig(os.path.join(FIGS, "3_results.png"), dpi=130)
print("saved figures/3_results.png")
print()
print("done.")