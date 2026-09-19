// props.js -- the sensor, the beam, and the things standing around the plaza.
//
// The vehicles, barriers and the checkpoint are not decoration only. They are
// in the occluder list, so a reflector lying behind a truck really is hidden
// from the sensor.

import * as THREE from 'three'
import { makeRng } from '../rng.js'

const BEAM_LENGTH = 1500

function concrete(c = 0x39404a) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0.03 })
}

function helipadTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#12171d'; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#8fa3b5'; g.lineWidth = 7
  g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke()
  g.lineWidth = 22; g.beginPath()
  g.moveTo(88, 76); g.lineTo(88, 180); g.moveTo(168, 76); g.lineTo(168, 180)
  g.moveTo(88, 128); g.lineTo(168, 128); g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildProps(scene, world, seed) {
  const rng = makeRng(seed ^ 0x9e37)
  const group = new THREE.Group()
  group.name = 'props'
  scene.add(group)
  const occluders = []

  // ------------------------------------------------------------- the sensor
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.42, world.sensorPos.y, 10),
    new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.6, metalness: 0.5 })
  )
  mast.position.set(world.sensorPos.x, world.sensorPos.y / 2, world.sensorPos.z)
  mast.castShadow = true
  group.add(mast)

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.5, 16), concrete(0x2a313a))
  base.position.set(world.sensorPos.x, 0.25, world.sensorPos.z)
  base.receiveShadow = true
  group.add(base)

  const head = new THREE.Group()
  head.position.copy(world.sensorPos)
  group.add(head)

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.0, 1.9),
    new THREE.MeshStandardMaterial({ color: 0x3c454f, roughness: 0.45, metalness: 0.6 })
  )
  housing.castShadow = true
  head.add(housing)

  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20),
    new THREE.MeshStandardMaterial({
      color: 0x0a2c33, roughness: 0.1, metalness: 0.9,
      emissive: 0x1d6d78, emissiveIntensity: 0.9
    })
  )
  lens.rotation.x = Math.PI / 2
  lens.position.set(0, 0, -0.98)
  head.add(lens)

  // the beam itself: a long soft cone down -Z of the head
  const beamGeo = new THREE.CylinderGeometry(2.4, 0.16, BEAM_LENGTH, 12, 1, true)
  beamGeo.rotateX(-Math.PI / 2)
  beamGeo.translate(0, 0, -BEAM_LENGTH / 2)
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x49e3f0, transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true
  })
  const beam = new THREE.Mesh(beamGeo, beamMat)
  beam.renderOrder = 3
  head.add(beam)

  const coreGeo = new THREE.BufferGeometry()
  coreGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -BEAM_LENGTH], 3))
  const core = new THREE.Line(coreGeo, new THREE.LineBasicMaterial({
    color: 0x9ff4ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
  }))
  head.add(core)

  // --------------------------------------------------------- protected point
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.0, 40),
    new THREE.MeshBasicMaterial({ color: 0x37d0e0, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.set(world.protectedPos.x, 0.06, world.protectedPos.z)
  group.add(ring)

  // ------------------------------------------------------------- checkpoint
  const hut = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 5), concrete(0x333b45))
  hut.position.set(world.protectedPos.x + 9, 1.6, world.protectedPos.z - 5)
  hut.castShadow = hut.receiveShadow = true
  group.add(hut); occluders.push(hut)

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 8), concrete(0x2b323b))
  canopy.position.set(world.protectedPos.x + 5, 4.2, world.protectedPos.z - 4)
  canopy.castShadow = true
  group.add(canopy); occluders.push(canopy)

  // ------------------------------------------------- barriers and bollards
  const barGeo = new THREE.BoxGeometry(3.0, 1.0, 0.75)
  const barrierMesh = new THREE.InstancedMesh(barGeo, concrete(0x434a53), 40)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rng.range(-0.02, 0.02)
    const r = 34 + rng.range(-1.5, 1.5)
    e.set(0, -a, 0); q.setFromEuler(e)
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1))
    barrierMesh.setMatrixAt(i, m)
  }
  barrierMesh.instanceMatrix.needsUpdate = true
  barrierMesh.castShadow = barrierMesh.receiveShadow = true
  group.add(barrierMesh); occluders.push(barrierMesh)

  const bolGeo = new THREE.CylinderGeometry(0.22, 0.26, 1.1, 8)
  bolGeo.translate(0, 0.55, 0)
  const bollards = new THREE.InstancedMesh(bolGeo, concrete(0x50585f), 28)
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    const r = 21
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))
    bollards.setMatrixAt(i, m)
  }
  bollards.instanceMatrix.needsUpdate = true
  bollards.castShadow = true
  group.add(bollards)

  // ---------------------------------------------------------------- vehicles
  const vehicles = []
  const vehicleSpots = [
    [-26, 18, 0.5], [30, 26, -1.1], [-8, -34, 2.4]
  ]
  vehicleSpots.forEach(([vx, vz, vrot]) => {
    const v = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 5.6), concrete(0x2f3840))
    body.position.y = 1.05
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 2.2), concrete(0x262d35))
    cab.position.set(0, 2.0, -0.4)
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(2.14, 0.6, 2.24),
      new THREE.MeshStandardMaterial({ color: 0x0d1a22, roughness: 0.12, metalness: 0.7 })
    )
    glass.position.set(0, 2.05, -0.4)
    v.add(body, cab, glass)
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10)
    wheelGeo.rotateZ(Math.PI / 2)
    const wheelMat = concrete(0x14181d)
    ;[[-1.2, 1.7], [1.2, 1.7], [-1.2, -1.7], [1.2, -1.7]].forEach(([wx, wz]) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat)
      w.position.set(wx, 0.55, wz)
      v.add(w)
    })
    v.position.set(vx, 0, vz)
    v.rotation.y = vrot
    v.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    group.add(v)
    vehicles.push(v)
    occluders.push(body, cab)
  })

  // ----------------------------------------------------- floodlight masts
  const floodPositions = []
  const floodSpots = [[-44, -44], [44, -44], [44, 44], [-44, 44]]
  floodSpots.forEach(([fx, fz]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 14, 8), concrete(0x4c545c))
    pole.position.set(fx, 7, fz)
    pole.castShadow = true
    group.add(pole)
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x20262c, emissive: 0xffe6b0, emissiveIntensity: 0 })
    )
    lamp.position.set(fx, 14.1, fz)
    lamp.lookAt(0, 0, 0)
    lamp.userData.isLamp = true
    group.add(lamp)
    floodPositions.push(new THREE.Vector3(fx, 13.6, fz))
  })

  // ------------------------------------------------------ perimeter fencing
  const fencePosts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 2.4, 0.16), concrete(0x555d66), 34
  )
  const wire = []
  for (let i = 0; i < 34; i++) {
    const fx = -190 + i * 11.5, fz = -150
    m.compose(new THREE.Vector3(fx, 1.2, fz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))
    fencePosts.setMatrixAt(i, m)
    if (i > 0) {
      for (const h of [0.7, 1.4, 2.1]) wire.push(fx - 11.5, h, fz, fx, h, fz)
    }
  }
  fencePosts.instanceMatrix.needsUpdate = true
  group.add(fencePosts)
  const wireGeo = new THREE.BufferGeometry()
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3))
  group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
    color: 0x49566180, transparent: true, opacity: 0.4
  })))

  // --------------------------------------------------------------- helipad
  const padRoof = world.rooftops.length
    ? world.rooftops.reduce((a, b) => (a.height > b.height ? a : b))
    : null
  if (padRoof) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(9, 40),
      new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.95 })
    )
    pad.rotation.x = -Math.PI / 2
    const b = world.buildings[padRoof.building]
    pad.position.set(b.x, b.h + 0.06, b.z)
    group.add(pad)
  }

  const api = {
    group, occluders, head, beam, vehicles, floodPositions,
    setBeam(azDeg, elDeg) {
      const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180
      const dir = new THREE.Vector3(
        Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)
      )
      head.lookAt(head.position.clone().add(dir))
    },
    setBeamOpacity(o) {
      beamMat.opacity = o
      core.material.opacity = Math.min(0.85, o * 2.4)
      beam.visible = core.visible = o > 0.001
    },
    setBeamVisible(v) { beam.visible = core.visible = v },
    setFloodlightsOn(on) {
      group.traverse(o => {
        if (o.userData.isLamp) o.material.emissiveIntensity = on ? 2.2 : 0
      })
    },
    dispose() {
      scene.remove(group)
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => mm.dispose())
      })
    }
  }
  return api
}
