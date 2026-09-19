# """
# scene.py  --  WHAT IS OUT THERE

# This file describes the world. It knows nothing about sensors or detection.
# It just hands back a list of things that reflect light.

# Every target is a dictionary with five keys:

#     angle       where it is, left or right of straight ahead, in degrees
#     distance    how far away, in metres
#     width       how many degrees wide its flash is   <-- THE KEY NUMBER
#     brightness  how strong the flash is
#     kind        what it really is (only used to mark our answers)

# WHY WIDTH MATTERS
# A rifle scope is ground to optical precision, so it sends light back in a
# very narrow flash. A moulded plastic road sign cannot be made that precisely,
# so its flash is wide. That difference is the whole project.
# """

import numpy as np

# ---------------------------------------------------------------------------
# What each kind of object looks like.
#   width      = degrees wide its flash is
#   brightness = how strong the flash is, before distance is taken into account
# ---------------------------------------------------------------------------
KINDS = {
    "scope":      {"width": 0.30, "brightness": 6.0e6},   # rifle scope
    "camera":     {"width": 0.40, "brightness": 4.0e6},   # camera lens
    "reflector":  {"width": 2.00, "brightness": 2.2e4},   # bicycle reflector
    "road_sign":  {"width": 2.60, "brightness": 3.0e4},   # road sign
    "window":     {"width": 0.95, "brightness": 1.1e4},   # glass at an angle
    "wall":       {"width": 9.00, "brightness": 2.0e2},   # plain surface
}

# Anything in this list counts as "a thing we want to find"
OPTICS = ["scope", "camera"]


def make_target(angle, distance, kind, rng=None):
    """Build one target dictionary."""
    rng = rng or np.random.default_rng()
    spec = KINDS[kind]
    return {
        "angle": float(angle),
        "distance": float(distance),
        # small random variation, because no two objects are identical
        "width": float(spec["width"] * rng.uniform(0.85, 1.15)),
        "brightness": float(spec["brightness"] * rng.uniform(0.7, 1.3)),
        "kind": kind,
    }


def make_scene(with_optic=True, n_clutter=6, seed=None):
    """
    Build a whole scene.

    with_optic : True puts one scope in the scene. False means no scope,
                 which is how we count false alarms.
    n_clutter  : how many road signs, reflectors and windows to scatter about.
    seed       : same seed gives the same scene every time, useful for testing.
    """
    rng = np.random.default_rng(seed)
    targets = []

    if with_optic:
        kind = "scope" if rng.random() < 0.7 else "camera"
        targets.append(make_target(rng.uniform(-40, 40),
                                   rng.uniform(120, 320), kind, rng))

    for _ in range(n_clutter):
        kind = rng.choice(["road_sign", "reflector", "window"])
        targets.append(make_target(rng.uniform(-42, 42),
                                   rng.uniform(80, 300), kind, rng))

    for _ in range(5):
        targets.append(make_target(rng.uniform(-42, 42),
                                   rng.uniform(80, 300), "wall", rng))

    return targets


if __name__ == "__main__":
    for t in make_scene(seed=1):
        print(f"{t['kind']:>10}  angle {t['angle']:+6.1f} deg   "
              f"distance {t['distance']:5.0f} m   width {t['width']:.2f} deg")