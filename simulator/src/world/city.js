// city.js -- the world, built from a seed.
//
// Nothing here knows about detection. It makes geometry and hands back the
// places where things can sit: rooftops, building faces, street kerbs.
//
// Everything is a box or a cylinder. That is deliberate: the ray caster in
// sim/visibility.js tests against these very meshes, so what you see blocking
// a sight line is what actually blocks it.

import * as THREE from 'three'
import { makeRng } from '../rng.js'

export const CELL = 110          // metres between block centres
export const GRID = 9            // blocks across
export const PLAZA_RADIUS = 78   // metres of open ground in the middle

// ---------------------------------------------------------------- shaders
// Window grids and the ground grid are drawn by nudging the standard
// material, so that fog and lighting keep working normally.

function injectWindows(material, glowRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowRef
    material.userData.shader = shader
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        #include <project_vertex>`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGlow; varying vec3 vWPos; varying vec3 vWNrm;
        float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 n = normalize(vWNrm);
          if (abs(n.y) < 0.5 && vWPos.y > 4.0) {
            vec2 uv = (abs(n.x) > abs(n.z)) ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
            vec2 f = fract(vec2(uv.x / 2.6, uv.y / 3.6));
            float mask = step(0.18, f.x) * step(f.x, 0.82) * step(0.24, f.y) * step(f.y, 0.78);
            diffuseColor.rgb = mix(diffuseColor.rgb * 1.06, diffuseColor.rgb * 0.42, mask);
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWNrm);
          if (abs(n.y) < 0.5 && vWPos.y > 4.0) {
            vec2 uv = (abs(n.x) > abs(n.z)) ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
            vec2 cell = vec2(uv.x / 2.6, uv.y / 3.6);
            vec2 id = floor(cell), f = fract(cell);
            float r = hash21(id);
            float lit = step(1.0 - uGlow, r);
            float mask = step(0.20, f.x) * step(f.x, 0.80) * step(0.26, f.y) * step(f.y, 0.76);
            vec3 tint = mix(vec3(0.30, 0.38, 0.50), vec3(0.46, 0.36, 0.22), step(0.55, fract(r * 31.7)));
            totalEmissiveRadiance += tint * lit * mask * (0.30 + 0.45 * fract(r * 71.3));
          }
        }`)
  }
}

function injectGroundGrid(material) {
  material.onBeforeCompile = (shader) => {
    material.userData.shader = shader
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWPos;')
      .replace('#include <project_vertex>',
        'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWPos;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 g = abs(fract(vWPos.xz / 25.0 + 0.5) - 0.5) / fwidth(vWPos.xz / 25.0);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          vec2 g2 = abs(fract(vWPos.xz / 100.0 + 0.5) - 0.5) / fwidth(vWPos.xz / 100.0);
          float line2 = 1.0 - min(min(g2.x, g2.y), 1.0);
          float fade = 1.0 - smoothstep(300.0, 900.0, length(vWPos.xz));
          totalEmissiveRadiance += vec3(0.07, 0.14, 0.18) * line * 0.45 * fade;
          totalEmissiveRadiance += vec3(0.09, 0.20, 0.25) * line2 * fade;
        }`)
  }
}

// ------------------------------------------------------------------ build
export function buildCity(scene, seed) {
  const rng = makeRng(seed)
  const group = new THREE.Group()
  group.name = 'city'
  scene.add(group)

  const glowRef = { value: 0.22 }   // how many windows are lit; the lighting preset sets it
  const buildings = []

  // --- where the blocks go -------------------------------------------------
  const half = (GRID - 1) / 2
  for (let ix = -half; ix <= half; ix++) {
    for (let iz = -half; iz <= half; iz++) {
      const cx = ix * CELL + rng.range(-12, 12)
      const cz = iz * CELL + rng.range(-12, 12)
      if (Math.hypot(cx, cz) < PLAZA_RADIUS + 26) continue      // keep the plaza open
      if (!rng.chance(0.88)) continue                            // the odd empty lot

      const split = rng.chance(0.32)
      const lots = split ? 2 : 1
      for (let k = 0; k < lots; k++) {
        const w = split ? rng.range(18, 34) : rng.range(26, 56)
        const d = split ? rng.range(18, 34) : rng.range(26, 56)
        const ring = Math.hypot(cx, cz) / (CELL * half)          // taller in the middle
        const h = rng.range(15, 120) * (1.15 - 0.45 * ring)
        const ox = split ? (k === 0 ? -20 : 20) + rng.range(-5, 5) : 0
        const oz = split ? rng.range(-8, 8) : 0
        buildings.push({
          x: cx + ox, z: cz + oz, w, d,
          h: Math.max(15, Math.min(120, h)),
          rot: rng.chance(0.25) ? rng.range(-0.12, 0.12) : 0
        })
      }
    }
  }
  while (buildings.length > 80) buildings.splice(Math.floor(rng.float() * buildings.length), 1)

  // --- the buildings themselves -------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  boxGeo.translate(0, 0.5, 0)                                    // sit on the ground

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2a323d, roughness: 0.86, metalness: 0.06, emissive: 0x000000
  })
  injectWindows(wallMat, glowRef)

  const mesh = new THREE.InstancedMesh(boxGeo, wallMat, buildings.length)
  mesh.name = 'buildings'
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
  buildings.forEach((b, i) => {
    e.set(0, b.rot, 0); q.setFromEuler(e)
    m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = mesh.receiveShadow = true
  group.add(mesh)

  // --- thin edge lines on the silhouettes ----------------------------------
  const edgePos = []
  const unitEdges = new THREE.EdgesGeometry(boxGeo).attributes.position.array
  const v = new THREE.Vector3()
  buildings.forEach(b => {
    e.set(0, b.rot, 0); q.setFromEuler(e)
    m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
    for (let i = 0; i < unitEdges.length; i += 3) {
      v.set(unitEdges[i], unitEdges[i + 1], unitEdges[i + 2]).applyMatrix4(m)
      edgePos.push(v.x, v.y, v.z)
    }
  })
  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: 0x4e6b80, transparent: true, opacity: 0.5, fog: true
  }))
  edges.name = 'edges'
  group.add(edges)

  // --- rooftop detail. This is where a man would lie. ----------------------
  const roofParts = []      // {type, pos, size}
  const rooftops = []       // places a target can sit
  buildings.forEach((b, i) => {
    const top = b.h
    // parapet: four low walls around the roof edge
    if (rng.chance(0.7)) {
      const t = 0.5, ph = rng.range(0.9, 1.6)
      roofParts.push({ p: [b.x, top, b.z - b.d / 2 + t / 2], s: [b.w, ph, t] })
      roofParts.push({ p: [b.x, top, b.z + b.d / 2 - t / 2], s: [b.w, ph, t] })
      roofParts.push({ p: [b.x - b.w / 2 + t / 2, top, b.z], s: [t, ph, b.d] })
      roofParts.push({ p: [b.x + b.w / 2 - t / 2, top, b.z], s: [t, ph, b.d] })
    }
    // stair housing
    if (rng.chance(0.55)) {
      const sw = rng.range(4, 8), sd = rng.range(4, 7), sh = rng.range(2.5, 4)
      const sx = b.x + rng.range(-1, 1) * (b.w / 2 - sw / 2 - 1)
      const sz = b.z + rng.range(-1, 1) * (b.d / 2 - sd / 2 - 1)
      roofParts.push({ p: [sx, top, sz], s: [sw, sh, sd] })
    }
    // water tank
    if (rng.chance(0.4)) {
      const tw = rng.range(2.5, 4.5), th = rng.range(2.5, 4)
      roofParts.push({
        p: [b.x + rng.range(-b.w / 3, b.w / 3), top, b.z + rng.range(-b.d / 3, b.d / 3)],
        s: [tw, th, tw], tank: true
      })
    }
    // somewhere on this roof a scope could rest
    rooftops.push({
      building: i,
      pos: new THREE.Vector3(b.x + rng.range(-b.w / 3, b.w / 3), top + 1.1,
                             b.z + rng.range(-b.d / 3, b.d / 3)),
      height: top
    })
  })

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.9, metalness: 0.05 })
  const roofMesh = new THREE.InstancedMesh(boxGeo, roofMat, roofParts.length)
  roofMesh.name = 'rooftop-detail'
  roofParts.forEach((r, i) => {
    m.compose(new THREE.Vector3(r.p[0], r.p[1], r.p[2]),
              new THREE.Quaternion(), new THREE.Vector3(r.s[0], r.s[1], r.s[2]))
    roofMesh.setMatrixAt(i, m)
  })
  roofMesh.instanceMatrix.needsUpdate = true
  roofMesh.castShadow = true
  group.add(roofMesh)

  // antenna masts, thin lines against the sky
  const mastPos = []
  buildings.forEach(b => {
    if (!rng.chance(0.3)) return
    const mh = rng.range(4, 14)
    const mx = b.x + rng.range(-b.w / 3, b.w / 3), mz = b.z + rng.range(-b.d / 3, b.d / 3)
    mastPos.push(mx, b.h, mz, mx, b.h + mh, mz)
  })
  const mastGeo = new THREE.BufferGeometry()
  mastGeo.setAttribute('position', new THREE.Float32BufferAttribute(mastPos, 3))
  group.add(new THREE.LineSegments(mastGeo, new THREE.LineBasicMaterial({
    color: 0x5c7183, transparent: true, opacity: 0.55
  })))

  // --- ground ---------------------------------------------------------------
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 1.0, metalness: 0.0 })
  injectGroundGrid(groundMat)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.name = 'ground'
  group.add(ground)

  // the plaza slab, a shade lighter
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_RADIUS, 64),
    new THREE.MeshStandardMaterial({ color: 0x141a21, roughness: 0.95 })
  )
  plaza.rotation.x = -Math.PI / 2
  plaza.position.y = 0.02
  plaza.receiveShadow = true
  group.add(plaza)

  // --- places for targets ---------------------------------------------------
  const facades = []
  buildings.forEach((b, i) => {
    const n = 2 + Math.floor(rng.float() * 3)
    for (let k = 0; k < n; k++) {
      const side = rng.int(0, 3)
      const y = rng.range(6, Math.max(8, b.h - 3))
      let p
      if (side === 0) p = new THREE.Vector3(b.x + rng.range(-b.w / 2, b.w / 2), y, b.z - b.d / 2 - 0.4)
      else if (side === 1) p = new THREE.Vector3(b.x + rng.range(-b.w / 2, b.w / 2), y, b.z + b.d / 2 + 0.4)
      else if (side === 2) p = new THREE.Vector3(b.x - b.w / 2 - 0.4, y, b.z + rng.range(-b.d / 2, b.d / 2))
      else p = new THREE.Vector3(b.x + b.w / 2 + 0.4, y, b.z + rng.range(-b.d / 2, b.d / 2))
      facades.push({ building: i, pos: p })
    }
  })

  const streets = []
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2)
    const r = rng.range(PLAZA_RADIUS + 8, CELL * half)
    const p = new THREE.Vector3(Math.cos(a) * r, rng.range(1.4, 3.2), Math.sin(a) * r)
    // keep them out of the buildings
    if (buildings.some(b => Math.abs(p.x - b.x) < b.w / 2 + 1 && Math.abs(p.z - b.z) < b.d / 2 + 1)) continue
    streets.push({ pos: p })
  }

  // --- skyline, for the priority-scan toggle --------------------------------
  // One elevation per degree of bearing: the top of the tallest thing that way.
  // This only steers the scan sector. It never touches the detection numbers.
  const sensorPos = new THREE.Vector3(0, 7.2, 0)
  const skyline = new Float32Array(360)
  buildings.forEach(b => {
    const dx = b.x - sensorPos.x, dz = b.z - sensorPos.z
    const r = Math.hypot(dx, dz)
    const centre = Math.atan2(dx, -dz) * 180 / Math.PI
    const halfAng = Math.atan2(Math.max(b.w, b.d) / 2, r) * 180 / Math.PI
    const el = Math.atan2(b.h - sensorPos.y, r) * 180 / Math.PI
    for (let a = Math.floor(centre - halfAng); a <= Math.ceil(centre + halfAng); a++) {
      const idx = ((a % 360) + 360) % 360
      if (el > skyline[idx]) skyline[idx] = el
    }
  })

  return {
    group, buildings, rooftops, facades, streets, skyline,
    sensorPos,
    protectedPos: new THREE.Vector3(16, 1.7, -14),
    occluders: [mesh, roofMesh],
    glowRef,
    materials: { wallMat, roofMat, groundMat, edges },
    radius: CELL * half + 60,
    skylineAt(azDeg) {
      const idx = ((Math.round(azDeg) % 360) + 360) % 360
      return this.skyline[idx]
    },
    dispose() {
      scene.remove(group)
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => mm.dispose())
      })
    }
  }
}
