// lighting.js -- four sets of conditions.
//
// Each preset carries two things at once: how the scene looks, and the three
// numbers that decide how well the sensor can see.
//
//   backgroundLevel  the steady light already there before we emit anything
//   noiseSigma       how much the reading wobbles from one sample to the next
//   extinction       how much the air eats, per metre, out AND back
//
// The optical numbers are ASSUMED, not measured. They are chosen so that the
// ratios between the four conditions are right: day sits about ten times
// higher than night, and fog eats light about fifty times faster than clear
// air. Nothing here is calibrated against a real instrument.

import * as THREE from 'three'

export const PRESETS = {
  day: {
    key: 'day', label: 'Day',
    backgroundLevel: 30000, noiseSigma: 3000, extinction: 4e-4,
    plain: 'Bright sky. The background is high, so the alarm level sits high, and only the strongest returns get through.',
    sky: 0x9fb3c6, ground: 0x10161c, sunColour: 0xfff4e2, sunIntensity: 2.6,
    sunDir: [0.45, 0.78, 0.36], ambient: 0.55, hemi: 0.55, exposure: 1.0,
    windowGlow: 0.02, floodlights: false, beamOpacity: 0.035, shadows: true,
    fogFloor: 2.6e-4
  },
  dusk: {
    key: 'dusk', label: 'Dusk',
    backgroundLevel: 9000, noiseSigma: 900, extinction: 6e-4,
    plain: 'Low warm sun, long shadows. The background has dropped, so weaker returns start to show.',
    sky: 0x2e2a33, ground: 0x0b0d11, sunColour: 0xff9a4d, sunIntensity: 1.5,
    sunDir: [0.92, 0.10, -0.28], ambient: 0.22, hemi: 0.3, exposure: 1.05,
    windowGlow: 0.24, floodlights: true, beamOpacity: 0.10, shadows: true,
    fogFloor: 3.4e-4
  },
  night: {
    key: 'night', label: 'Night',
    backgroundLevel: 3000, noiseSigma: 300, extinction: 4e-4,
    plain: 'Near black. The background is at its lowest, the alarm level follows it down, and this is when the sensor reaches furthest.',
    sky: 0x04060a, ground: 0x05070a, sunColour: 0x9ab4d6, sunIntensity: 0.16,
    sunDir: [-0.35, 0.55, -0.5], ambient: 0.08, hemi: 0.12, exposure: 1.25,
    windowGlow: 0.5, floodlights: true, beamOpacity: 0.26, shadows: false,
    fogFloor: 2.2e-4
  },
  fog: {
    key: 'fog', label: 'Fog',
    backgroundLevel: 10000, noiseSigma: 1000, extinction: 0.02,
    plain: 'Heavy fog. The background is only moderate, but the air eats the beam going out and again coming back, so range collapses.',
    sky: 0x1d242c, ground: 0x12171d, sunColour: 0xc8d6e4, sunIntensity: 0.9,
    sunDir: [0.3, 0.6, 0.2], ambient: 0.5, hemi: 0.6, exposure: 1.0,
    windowGlow: 0.3, floodlights: true, beamOpacity: 0.5, shadows: false,
    fogFloor: 0.011
  }
}

export function createLighting(scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.3)
  const hemi = new THREE.HemisphereLight(0x8fa8c0, 0x0a0d11, 0.4)
  const sun = new THREE.DirectionalLight(0xffffff, 1.0)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 2200
  const S = 620
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S
  sun.shadow.bias = -0.0009
  // The city does not move, so the shadow map is drawn once per preset
  // instead of once per frame. That is most of our frame budget saved.
  sun.shadow.autoUpdate = false
  scene.add(ambient, hemi, sun, sun.target)

  const floods = []
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PointLight(0xd8e6ff, 0, 220, 2)
    scene.add(p)
    floods.push(p)
  }

  return { ambient, hemi, sun, floods }
}

export function applyPreset(ctx, name) {
  const p = PRESETS[name]
  const { scene, renderer, lighting, world, props } = ctx

  scene.background = new THREE.Color(p.sky)
  // The visual fog is tied to the same extinction the detector uses, so the
  // picture and the numbers cannot drift apart.
  scene.fog = new THREE.FogExp2(p.sky, Math.max(p.fogFloor, p.extinction * 0.55))

  lighting.ambient.intensity = p.ambient
  lighting.hemi.intensity = p.hemi
  lighting.sun.color.setHex(p.sunColour)
  lighting.sun.intensity = p.sunIntensity
  lighting.sun.position.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize().multiplyScalar(900)
  lighting.sun.target.position.set(0, 0, 0)
  lighting.sun.castShadow = p.shadows
  lighting.sun.shadow.needsUpdate = true

  renderer.toneMappingExposure = p.exposure

  if (world) world.glowRef.value = p.windowGlow
  if (props) {
    props.floodPositions.forEach((fp, i) => {
      const light = lighting.floods[i]
      if (!light) return
      light.position.copy(fp)
      light.intensity = p.floodlights ? 260 : 0
    })
    props.setFloodlightsOn(p.floodlights)
    props.setBeamOpacity(p.beamOpacity)
  }
  return p
}
