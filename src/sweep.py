# sweep.py  --  LOOKING AROUND

# Turns the sensor step by step and records how much light comes back at
# every angle. It knows nothing about scopes. It just adds up whatever the
# scene throws back.

# OUT COMES: two lists of the same length.
#     angles      the direction we were pointing
#     brightness  how much came back from that direction
import numpy as np

# --------------------------------------------------------------- settings
START_ANGLE = -45.0     # degrees, leftmost
END_ANGLE   =  45.0     # degrees, rightmost
STEP        =   0.05    # degrees per step   <-- must be MUCH smaller
                        #     than the narrowest flash we want to see
BEAM_WIDTH  =   0.20    # degrees, how tight our own beam is
DAYLIGHT    = 900.0     # constant background from the sun
NOISE       =  60.0     # random wobble in the detector


def return_from(target, beam_angle, beam_width=BEAM_WIDTH):
    
    # How much light comes back from ONE target when the beam points at
    # beam_angle.

    # Three things happen here:

    # 1. exp(-(...)^2) makes a hump. It is biggest when the beam points
    #    straight at the target and falls away on either side.

    # 2. The hump's fatness is set by the target's own width combined with
    #    our beam width. A wide beam blurs everything, so even a needle
    #    sharp target can never look narrower than our own beam.

    # 3. Dividing by distance^4 makes far things dim. Light spreads on the
    #    way out AND on the way back, so doubling the distance gives
    #    sixteen timenp.lessss light.
    
    effective_width = np.sqrt(target["width"] ** 2 + beam_width ** 2)
    offset = (beam_angle - target["angle"]) / effective_width
    hump = np.exp(-(offset ** 2))
    spreading = (target["distance"] / 200.0) ** 4
    return target["brightness"] * hump / spreading


def sweep(targets, rng=None, daylight=DAYLIGHT, noise=NOISE):
    # """Step across every angle and record the total brightness."""
    rng = rng or np.random.default_rng()
    angles = np.arange(START_ANGLE, END_ANGLE + STEP, STEP)

    brightness = np.full(angles.shape, float(daylight))
    for t in targets:
        brightness += return_from(t, angles)

    brightness += rng.normal(0.0, noise, size=angles.shape)
    return angles, brightness


def empty_sweep(rng=None, daylight=DAYLIGHT, noise=NOISE):
    # """A sweep of nothing at all. This is how we learn what noise looks like."""
    return sweep([], rng=rng, daylight=daylight, noise=noise)


if __name__ == "__main__":
    import scene
    angles, bright = sweep(scene.make_scene(seed=1))
    print(f"{len(angles)} steps from {angles[0]:+.0f} to {angles[-1]:+.0f} degrees")
    print(f"step size        {STEP} deg")
    print(f"quietest reading {bright.min():10.0f}")
    print(f"brightest        {bright.max():10.0f}")