// sniper.js -- the man we are looking for.
//
// A state machine. The operator never sees the states, only their effects:
// a flash that answers the beam, a rangefinder pulse that arrives on its own,
// a rooftop that goes quiet because he has moved.
//
//   Hidden      scope covered, nothing to find
//   Observing   scope exposed, looking around the protected point
//   Ranging     fires a rangefinder pulse at the protected point
//   Aiming      scope exposed, cone narrow and steady on the target
//   Fired       too late
//   Relocating  moving to another rooftop, nothing to find
//
// He answers our beam ONLY when his scope is uncovered AND we happen to lie
// inside his field of view. A scope pointed somewhere else does not answer.

import * as THREE from 'three'
import { makeTarget, scopeWidthFor } from './targets.js'
import { geometryFor } from './visibility.js'

export const STATES = ['Hidden', 'Observing', 'Ranging', 'Aiming', 'Fired', 'Relocating']

// assumed timings, in seconds
const DURATION = {
  easy:   { Hidden: [10, 16], Observing: [20, 30], Ranging: [5, 7], Aiming: [16, 22], Relocating: [14, 20] },
  normal: { Hidden: [6, 12],  Observing: [14, 22], Ranging: [4, 6], Aiming: [11, 16], Relocating: [10, 16] },
  hard:   { Hidden: [4, 8],   Observing: [8, 14],  Ranging: [3, 4], Aiming: [7, 10],  Relocating: [7, 11] }
}

export class Sniper {
  constructor({ world, visibility, rng, quality = 100, magnification = 10,
                difficulty = 'normal', hideFromSensor = false, occupied = [] }) {
    this.world = world
    this.visibility = visibility
    this.rng = rng
    this.difficulty = difficulty
    this.magnification = magnification
    this.quality = quality
    this.hideFromSensor = hideFromSensor
    this.occupied = occupied      // rooftops already holding something else

    this.state = 'Hidden'
    this.stateLeft = 4
    this.elapsed = 0
    this.pulseDue = 0
    this.pulses = 0
    this.sweepsNearby = 0
    this.found = false

    this.target = makeTarget('scope', new THREE.Vector3(), rng, {
      id: 'SNIPER', width: scopeWidthFor(quality)
    })
    this.target.isSniper = true
    // The gate is the rule above, and the sweep honours it: no exposure or
    // no line of sight through his own scope means no return at all.
    this.target.gate = () => this.scopeExposed && this.sensorInCone()

    this.pickPosition()
  }

  // ------------------------------------------------------------- placement
  pickPosition(avoid = null) {
    const { world, visibility } = this
    const sensor = world.sensorPos, prot = world.protectedPos
    const scored = []
    for (const r of world.rooftops) {
      const range = r.pos.distanceTo(sensor)
      // Close in, the angle between us and the thing he is aiming at is
      // wider than his own field of view, and he would never answer our
      // beam at all. Keep him where the problem is interesting.
      if (range < 220 || range > 760) continue
      // Not on top of something else that is already up there.
      if (this.occupied.some(q => q.distanceTo(r.pos) < 12)) continue
      // A man shooting at a target on the ground wants a shallow angle, not
      // a plunging one. That also keeps him inside a sane scan sector.
      const elevation = Math.atan2(r.pos.y - sensor.y, Math.hypot(r.pos.x - sensor.x, r.pos.z - sensor.z))
      if (elevation * 180 / Math.PI > 26) continue
      if (avoid && r.pos.distanceTo(avoid) < 60) continue
      const seesTarget = visibility.clear(r.pos, prot)
      if (!seesTarget) continue                    // he must be able to see his target
      const weSeeHim = visibility.clear(sensor, r.pos)
      if (this.hideFromSensor === weSeeHim) continue
      scored.push(r)
    }
    const pool = scored.length ? scored : world.rooftops
    const choice = pool[Math.floor(this.rng.float() * pool.length)]
    this.position = choice.pos.clone()
    this.target.position.copy(this.position)
    geometryFor(this.target, sensor)
    this.blockedFromSensor = !visibility.clear(sensor, this.position)
    return this.position
  }

  // --------------------------------------------------------------- optics
  get fovDeg() { return 40 / this.magnification }     // about 4 degrees at 10x

  setMagnification(m) { this.magnification = m }

  setQuality(q) {
    this.quality = q
    const w = scopeWidthFor(q)
    // keep the same instance-to-instance jitter this scope was given
    this.target.width = w * (this.target.widthJitter || (this.target.widthJitter = 0.9 + this.rng.float() * 0.2))
  }

  get scopeExposed() {
    return this.state === 'Observing' || this.state === 'Ranging' || this.state === 'Aiming'
  }

  // Where he is looking right now. He watches the protected point, but while
  // observing he searches either side of it, so we drift in and out of his
  // field of view and the flash comes and goes.
  lookDirection() {
    const toTarget = new THREE.Vector3().subVectors(this.world.protectedPos, this.position)
    const baseAz = Math.atan2(toTarget.x, -toTarget.z)
    const baseEl = Math.atan2(toTarget.y, Math.hypot(toTarget.x, toTarget.z))
    let wobbleAz = 0, wobbleEl = 0
    if (this.state === 'Observing') {
      wobbleAz = (6.0 * Math.sin(this.elapsed * 0.55) + 1.5 * Math.sin(this.elapsed * 1.7)) * Math.PI / 180
      wobbleEl = (1.2 * Math.sin(this.elapsed * 0.31)) * Math.PI / 180
    } else if (this.state === 'Aiming') {
      wobbleAz = (0.25 * Math.sin(this.elapsed * 3.1)) * Math.PI / 180
    }
    const az = baseAz + wobbleAz, el = baseEl + wobbleEl
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
  }

  // Are we inside his cone? Half the field of view either side of his axis.
  sensorInCone() {
    const toSensor = new THREE.Vector3().subVectors(this.world.sensorPos, this.position).normalize()
    const dot = Math.max(-1, Math.min(1, toSensor.dot(this.lookDirection())))
    const offAxis = Math.acos(dot) * 180 / Math.PI
    this.lastOffAxis = offAxis
    return offAxis <= this.fovDeg / 2
  }

  // ---------------------------------------------------------------- clock
  roll(state) {
    const d = DURATION[this.difficulty][state]
    return d ? this.rng.range(d[0], d[1]) : 5
  }

  enter(state) {
    this.state = state
    this.stateLeft = this.roll(state)
    if (state === 'Ranging') { this.pulseDue = 0.4; this.rangingPulses = 0 }
    if (state === 'Relocating') this.pickPosition(this.position)
  }

  // Seconds of simulated time until the round goes, if nothing interrupts.
  get timeToShot() {
    const order = ['Hidden', 'Observing', 'Ranging', 'Aiming']
    const i = order.indexOf(this.state)
    if (this.state === 'Fired') return 0
    if (i < 0) return this.stateLeft + this.roll('Observing') + 5 + 13   // relocating
    let t = this.stateLeft
    for (let j = i + 1; j < order.length; j++) {
      const d = DURATION[this.difficulty][order[j]]
      t += (d[0] + d[1]) / 2
    }
    return t
  }

  // Called every frame. Returns any event worth acting on.
  update(dt) {
    if (this.state === 'Fired') return { fired: false }
    this.elapsed += dt
    this.stateLeft -= dt
    const event = { pulse: false, fired: false, moved: false }

    if (this.state === 'Ranging') {
      this.pulseDue -= dt
      if (this.pulseDue <= 0) {
        this.pulseDue = 1.8
        this.pulses++
        this.rangingPulses = (this.rangingPulses || 0) + 1
        event.pulse = true
      }
    }

    if (this.stateLeft <= 0) {
      const from = this.state
      if (from === 'Hidden') this.enter('Observing')
      else if (from === 'Observing') {
        // if the operator has been sweeping over him, he may think better of it
        if (this.sweepsNearby >= 3 && this.rng.chance(0.5)) {
          this.sweepsNearby = 0
          this.enter('Relocating')
          event.moved = true
        } else this.enter('Ranging')
      } else if (from === 'Ranging') this.enter('Aiming')
      else if (from === 'Aiming') { this.state = 'Fired'; event.fired = true }
      else if (from === 'Relocating') { this.enter('Hidden'); event.moved = true }
    }
    return event
  }

  // he noticed the beam go over him
  noteSweep(detectedNearby) { if (detectedNearby) this.sweepsNearby++ }

  describe() {
    const map = {
      Hidden: 'scope covered, nothing to find',
      Observing: 'scope out, looking around',
      Ranging: 'ranging the target',
      Aiming: 'settled on the target',
      Fired: 'he has fired',
      Relocating: 'moving rooftop'
    }
    return map[this.state]
  }
}

// A small marker so the operator can be shown where he was, afterwards.
export function makeSniperMarker(scene) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.1, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3f36, roughness: 0.95 })
  )
  body.rotation.z = Math.PI / 2
  body.position.y = 0.35
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4d5a, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  )
  ring.rotation.x = -Math.PI / 2
  g.add(body, ring)
  g.visible = false
  scene.add(g)
  return {
    group: g,
    show(pos) { g.position.copy(pos).setY(pos.y - 1.0); g.visible = true },
    hide() { g.visible = false },
    dispose() { scene.remove(g) }
  }
}
