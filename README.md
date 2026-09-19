# Finding a rifle scope by the light it sends back

A lens sends light straight back to its source, in a very narrow flash.
A road sign sends it back too, but much wider. We measure the width.

PrismTech 2026, Optics stream.

## What each file does

src/scene.py   builds a list of targets. Each one has an angle, a distance,
               a flash width in degrees, and a brightness.
src/sweep.py   turns the sensor step by step and records brightness at
               each angle. Returns one number per angle.
src/detect.py  finds the bright spots, measures how wide each one is,
               and says scope or not.

## The shared format

A target is a dictionary:
  {"angle": 12.0, "distance": 200.0, "width": 0.3, "brightness": 5e6, "type": "scope"}

A sweep is a list of angles and a matching list of brightness values.

Nothing reads anything else. If you change this, tell the other two first.

## Run

    pip install -r requirements.txt
    python src/sweep.py

## The simulator

simulator/ holds a browser version of the same idea: a 3D city, a sensor that
sweeps a beam across it, and the same five detection steps running on what
comes back. It adds the things a page can show and a plot cannot: a line of
sight cast as a real ray against the buildings, day, dusk, night and fog that
change the numbers as well as the picture, a sniper who only answers when his
scope is pointed at us, and the passive channel that catches his rangefinder
pulse when we cannot see him at all.

    cd simulator
    npm install
    npm run dev

src/detect.py is the reference. The browser must agree with it, and the
simulator's Verify in Python button writes out the sweep together with a
script that re-runs the five steps on it and says whether the two agree.
See simulator/README.md.
