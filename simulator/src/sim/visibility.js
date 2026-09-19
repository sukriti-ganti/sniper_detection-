// visibility.js -- can the sensor actually see that point?
//
// This is real ray casting against the meshes that are on screen. Nothing is
// precomputed and nothing is approximated. Put a building between the sensor
// and a target, and the ray stops in the building, so the target returns
// nothing at all. Move the camera and you can see why.

import * as THREE from 'three'

export function makeVisibility(occluders) {
  const ray = new THREE.Raycaster()
  ray.firstHitOnly = true
  const dir = new THREE.Vector3()
  let rayCount = 0
  // where the last ray stopped, when something stopped it
  let lastHit = null

  return {
    get rayCount() { return rayCount },
    resetCount() { rayCount = 0 },
    setOccluders(list) { occluders = list },

    get lastHit() { return lastHit },

    // true if nothing stands between `from` and `to`
    clear(from, to) {
      lastHit = null
      dir.subVectors(to, from)
      const dist = dir.length()
      if (dist < 1e-6) return true
      dir.multiplyScalar(1 / dist)
      ray.set(from, dir)
      ray.near = 0.4
      // stop just short of the target itself, or the surface it sits on
      // would count as its own blocker
      ray.far = dist - 0.3
      if (ray.far <= ray.near) return true
      rayCount++
      const hits = ray.intersectObjects(occluders, false)
      if (hits.length) lastHit = hits[0].point.clone()
      return hits.length === 0
    },

    // recompute bearing, elevation, range and line of sight for every target
    update(targets, sensorPos) {
      for (const t of targets) {
        geometryFor(t, sensorPos)
        t.visible = this.clear(sensorPos, t.position)
        // remember where the ray stopped, so the picture can show it
        t.blockedAt = t.visible ? null : this.lastHit
        if (t.gate && !t.gate()) t.visible = false   // e.g. a covered scope
      }
    }
  }
}

// Where a point sits as seen from the sensor: bearing clockwise from north,
// elevation above the horizontal, and the straight line distance.
export function geometryFor(t, sensorPos) {
  const dx = t.position.x - sensorPos.x
  const dy = t.position.y - sensorPos.y
  const dz = t.position.z - sensorPos.z
  const flat = Math.hypot(dx, dz)
  t.bearing = Math.atan2(dx, -dz) * 180 / Math.PI
  t.elevation = Math.atan2(dy, flat) * 180 / Math.PI
  t.range = Math.hypot(flat, dy)
  return t
}
