// targets.js -- everything in the city that sends light back.
//
// The numbers in KINDS are the whole argument of the project. A rifle scope
// is ground to optical precision, so it sends light straight back in a very
// narrow flash. A moulded plastic road sign cannot be made that precisely, so
// its flash is wide. Detection is easy: everything here crosses the alarm
// line at short range. Only the WIDTH separates a scope from a road sign.
//
//   width        degrees across the return
//   strength     relative return strength, at 1064 nm
//   colourRatio  response at 1550 nm divided by response at 1064 nm
//
// These are assumed figures, chosen for the right ratios between kinds. They
// are not measurements of any real instrument.

import * as THREE from 'three'
import { geometryFor } from './visibility.js'

export const KINDS = {
  scope:       { width: [0.25, 0.85], strength: 9.0e6, colourRatio: 0.30, optic: true,  label: 'rifle scope' },
  binoculars:  { width: [0.60, 0.60], strength: 5.0e6, colourRatio: 0.35, optic: true,  label: 'binoculars' },
  camera:      { width: [0.40, 0.40], strength: 4.0e6, colourRatio: 0.38, optic: true,  label: 'camera lens' },
  road_sign:   { width: [2.0, 3.2],   strength: 3.0e4, colourRatio: 0.93, optic: false, label: 'road sign' },
  reflector:   { width: [1.6, 2.4],   strength: 2.2e4, colourRatio: 0.92, optic: false, label: 'reflector' },
  window:      { width: [0.8, 1.6],   strength: 1.4e4, colourRatio: 0.90, optic: false, label: 'window glass' },
  wet_surface: { width: [4.0, 8.0],   strength: 6.0e3, colourRatio: 0.95, optic: false, label: 'wet ground' },
  wall:        { width: [9.0, 9.0],   strength: 2.0e2, colourRatio: 0.95, optic: false, label: 'plain wall' }
}

// Scope quality: 100 is a ground and coated optic, 0 is a cheap one whose
// return is nearly as wide as a road sign's.
export function scopeWidthFor(quality) {
  const q = Math.max(0, Math.min(100, quality)) / 100
  return KINDS.scope.width[1] + q * (KINDS.scope.width[0] - KINDS.scope.width[1])
}

let nextId = 1

export function makeTarget(kind, position, rng, opts = {}) {
  const spec = KINDS[kind]
  const w = opts.width !== undefined
    ? opts.width
    : rng.range(spec.width[0], spec.width[1])
  const t = {
    id: opts.id || `T${nextId++}`,
    kind,
    label: spec.label,
    position: position.clone(),
    // plus or minus 15 percent, so no two instances are identical
    width: rng.jitter(w, 0.15),
    strength: rng.jitter(spec.strength, 0.15),
    colourRatio: rng.jitter(spec.colourRatio, 0.15),
    optic: spec.optic,
    onlyIn: opts.onlyIn || null,     // conditions this target exists in
    visible: true,
    bearing: 0, elevation: 0, range: 0
  }
  return t
}

export function placeTargets(world, rng, visibility = null) {
  const t = []
  const push = (kind, pos, opts) => { if (pos) t.push(makeTarget(kind, pos, rng, opts)) }

  const rooftops = world.rooftops.slice()
  const facades = world.facades.slice()
  const streets = world.streets.slice()

  // Street furniture and glass sit where the streets and faces are. Most of
  // it happens to be in view of the plaza, because that is what a street is,
  // and the rest is behind something. We take mostly the ones in view so the
  // trace is as busy as a real one, and leave the others where they are.
  const takeFrom = (arr, preferVisible = true) => {
    if (!arr.length) return null
    if (visibility && preferVisible && rng.chance(0.8)) {
      const tries = Math.min(arr.length, 14)
      for (let i = 0; i < tries; i++) {
        const j = Math.floor(rng.float() * arr.length)
        if (visibility.clear(world.sensorPos, arr[j].pos)) return arr.splice(j, 1)[0]
      }
    }
    return arr.splice(Math.floor(rng.float() * arr.length), 1)[0]
  }

  // other people's optics: the honest source of a false positive
  for (let i = 0; i < 2; i++) { const s = takeFrom(rooftops); if (s) push('binoculars', s.pos) }
  for (let i = 0; i < 3; i++) {
    const s = rng.chance(0.5) ? takeFrom(rooftops) : takeFrom(facades)
    if (s) push('camera', s.pos)
  }

  // street furniture
  for (let i = 0; i < 16; i++) { const s = takeFrom(streets); if (s) push('road_sign', s.pos) }
  for (let i = 0; i < 12; i++) { const s = takeFrom(streets); if (s) push('reflector', s.pos) }

  // reflectors on the parked vehicles, which is where they really live
  world.vehiclePositions?.forEach(p => {
    push('reflector', new THREE.Vector3(p.x, 0.8, p.z))
  })

  // glass
  for (let i = 0; i < 30; i++) { const s = takeFrom(facades); if (s) push('window', s.pos) }

  // wet ground, fog only
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(40, 420)
    push('wet_surface', new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r), { onlyIn: ['fog'] })
  }

  // the diffuse floor: plain surfaces, everywhere, very weak
  for (let i = 0; i < 46; i++) {
    const b = world.buildings[Math.floor(rng.float() * world.buildings.length)]
    push('wall', new THREE.Vector3(
      b.x + rng.range(-b.w / 2, b.w / 2),
      rng.range(3, b.h),
      b.z + rng.range(-b.d / 2, b.d / 2)
    ))
  }

  return t
}

// Targets that exist under the current conditions.
export function activeTargets(targets, presetKey) {
  return targets.filter(t => !t.onlyIn || t.onlyIn.includes(presetKey))
}

// ------------------------------------------------------------------ markers
// Small points in the 3D view, one per target, green when the sensor can see
// them and red when a building is in the way. Turning these on is how you
// prove to yourself that the line of sight is really being cast.
export function makeTargetMarkers(scene) {
  const geo = new THREE.BufferGeometry()
  const mat = new THREE.PointsMaterial({
    size: 5, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.95, depthWrite: false
  })
  const points = new THREE.Points(geo, mat)
  points.visible = false
  points.frustumCulled = false
  scene.add(points)

  const lineGeo = new THREE.BufferGeometry()
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false
  }))
  lines.visible = false
  lines.frustumCulled = false
  scene.add(lines)

  return {
    points, lines,
    setVisible(v) { points.visible = v; lines.visible = v },
    update(targets, sensorPos) {
      const pos = new Float32Array(targets.length * 3)
      const col = new Float32Array(targets.length * 3)
      const lp = new Float32Array(targets.length * 6)
      const lc = new Float32Array(targets.length * 6)
      targets.forEach((t, i) => {
        pos[i * 3] = t.position.x; pos[i * 3 + 1] = t.position.y; pos[i * 3 + 2] = t.position.z
        const c = t.visible
          ? (t.optic ? [1.0, 0.30, 0.35] : [0.30, 0.85, 0.55])
          : [0.55, 0.22, 0.20]
        col.set(c, i * 3)
        // A blocked sight line is drawn only as far as the thing that blocks
        // it. That is the ray stopping in a wall, and it is why the target
        // returns nothing.
        const end = (!t.visible && t.blockedAt) ? t.blockedAt : t.position
        lp.set([sensorPos.x, sensorPos.y, sensorPos.z, end.x, end.y, end.z], i * 6)
        lc.set([...c, ...c], i * 6)
      })
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
      lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3))
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3))
    },
    dispose() { scene.remove(points, lines); geo.dispose(); lineGeo.dispose(); mat.dispose() }
  }
}

export { geometryFor }
