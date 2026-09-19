// lighting.js -- four sets of conditions.
//
// Each preset carries two things at once: how the scene looks, and the three
// numbers that decide how well the sensor can see.
//
//   backgroundLevel  the steady light already there before we emit anything
//   noiseSigma       how much the reading wobbles from one sample to the next
//   extinction       how much the air eats, per metre, out AND back
//
// The haze you can see and the extinction the detector uses are deliberately
// not the same number. The picture is what an eye sees, at visible
// wavelengths, where scattering is strong. The sensor works at 1064 and 1550
// nanometres, where the same air scatters far less. So a clear day looks
// hazy at a kilometre while the beam still gets out and back.
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
    sky: 0xa8bccd, ground: 0x10161c, sunColour: 0xfff4e2, sunIntensity: 3.1,
    sunDir: [0.45, 0.78, 0.36], ambient: 0.95, hemi: 0.9, exposure: 1.15,
    windowGlow: 0.02, floodlights: false, beamOpacity: 0.035, shadows: true,
    wallTint: 0x4c5766, roofTint: 0x414b57, groundTint: 0x1b2128, haze: 9.0e-4
  },
  dusk: {
    key: 'dusk', label: 'Dusk',
    backgroundLevel: 9000, noiseSigma: 900, extinction: 6e-4,
    plain: 'Low warm sun, long shadows. The background has dropped, so weaker returns start to show.',
    sky: 0x3a3038, ground: 0x0b0d11, sunColour: 0xff9a4d, sunIntensity: 2.2,
    sunDir: [0.92, 0.10, -0.28], ambient: 0.30, hemi: 0.38, exposure: 1.1,
    windowGlow: 0.26, floodlights: true, beamOpacity: 0.10, shadows: true,
    wallTint: 0x3b3742, roofTint: 0x322e38, groundTint: 0x14151b, haze: 8.5e-4
  },
  night: {
    key: 'night', label: 'Night',
    backgroundLevel: 3000, noiseSigma: 300, extinction: 4e-4,
    plain: 'Near black. The background is at its lowest, the alarm level follows it down, and this is when the sensor reaches furthest.',
    sky: 0x05080d, ground: 0x05070a, sunColour: 0x9ab4d6, sunIntensity: 0.22,
    sunDir: [-0.35, 0.55, -0.5], ambient: 0.10, hemi: 0.16, exposure: 1.25,
    windowGlow: 0.5, floodlights: true, beamOpacity: 0.26, shadows: false,
    wallTint: 0x2a323d, roofTint: 0x232a34, groundTint: 0x0b0e12, haze: 5.5e-4
  },
  fog: {
    key: 'fog', label: 'Fog',
    backgroundLevel: 10000, noiseSigma: 1000, extinction: 0.02,
    plain: 'Heavy fog. The background is only moderate, but the air eats the beam going out and again coming back, so range collapses.',
    sky: 0x2a333c, ground: 0x12171d, sunColour: 0xc8d6e4, sunIntensity: 1.1,
    sunDir: [0.3, 0.6, 0.2], ambient: 0.7, hemi: 0.8, exposure: 1.0,
    windowGlow: 0.3, floodlights: true, beamOpacity: 0.5, shadows: false,
    wallTint: 0x39424e, roofTint: 0x333b45, groundTint: 0x171d24, haze: 0.008
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
    const p = new THREE.PointLight(0xd8e6ff, 0, 340, 2)
    scene.add(p)
    floods.push(p)
  }

  return { ambient, hemi, sun, floods }
}

export function applyPreset(ctx, name) {
  const p = PRESETS[name]
  const { scene, renderer, lighting, world, props } = ctx

  scene.background = new THREE.Color(p.sky)
  // See the note at the top of this file: the haze in the picture is at
  // visible wavelengths, the extinction in the detector is in the near
  // infrared, and they are not the same number.
  scene.fog = new THREE.FogExp2(p.sky, p.haze)

  lighting.ambient.intensity = p.ambient
  lighting.hemi.intensity = p.hemi
  lighting.sun.color.setHex(p.sunColour)
  lighting.sun.intensity = p.sunIntensity
  lighting.sun.position.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize().multiplyScalar(900)
  lighting.sun.target.position.set(0, 0, 0)
  lighting.sun.castShadow = p.shadows
  lighting.sun.shadow.needsUpdate = true

  renderer.toneMappingExposure = p.exposure

  if (world) {
    world.glowRef.value = p.windowGlow
    world.materials.wallMat.color.setHex(p.wallTint)
    world.materials.roofMat.color.setHex(p.roofTint)
    world.materials.groundMat.color.setHex(p.groundTint)
    world.materials.edges.material.opacity = p.key === 'day' ? 0.22 : 0.5
  }
  if (props) {
    props.floodPositions.forEach((fp, i) => {
      const light = lighting.floods[i]
      if (!light) return
      light.position.copy(fp)
      light.intensity = p.floodlights ? 4200 : 0
    })
    props.setFloodlightsOn(p.floodlights)
    props.setBeamOpacity(p.beamOpacity)
  }
  return p
}
