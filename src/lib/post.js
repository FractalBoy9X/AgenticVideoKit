// Post-processing: 3D scene → HUD composite → bloom → film grade → sRGB.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const HudComposite = {
  uniforms: { tDiffuse: { value: null }, tHud: { value: null }, hudGain: { value: 1.0 }, uLinear: { value: 1.0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tHud; uniform float hudGain; uniform float uLinear;
    varying vec2 vUv;
    vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 hud = texture2D(tHud, vUv);
      vec3 h = uLinear > 0.5 ? toLinear(hud.rgb) * hudGain : hud.rgb;
      vec3 col = mix(base.rgb, h, hud.a);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uFlash: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uAberration: { value: 0 },
    uRes: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: HudComposite.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uFade, uFlash, uVignette, uGrain, uAberration;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // vignette
      float v = smoothstep(0.95, 0.15, length(d * vec2(1.0, 0.82)) * uVignette * 1.25);
      col *= mix(0.55, 1.0, v);
      // flash
      col += vec3(0.85, 0.95, 1.0) * uFlash;
      // grain (animated, frame-deterministic)
      float g = h(floor(vUv * uRes) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (0.5 + 0.5 * l);
      col *= uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/** hudLate: composite the 2D layer after tone mapping / sRGB (exact text colours, no bloom on it). */
export function createPost(renderer, scene, camera, hudCanvas, W, H, { hudLate = false } = {}) {
  const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(W, H);

  composer.addPass(new RenderPass(scene, camera));

  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.minFilter = THREE.LinearFilter;
  hudTex.magFilter = THREE.LinearFilter;
  hudTex.generateMipmaps = false;
  hudTex.colorSpace = THREE.NoColorSpace;
  const hudPass = new ShaderPass(HudComposite);
  hudPass.uniforms.tHud.value = hudTex;
  if (!hudLate) composer.addPass(hudPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0, 0.55, 0.55);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());
  if (hudLate) { hudPass.uniforms.uLinear.value = 0; composer.addPass(hudPass); }

  // Grade after the sRGB conversion so grain / vignette act on display values.
  const grade = new ShaderPass(Grade);
  grade.uniforms.uRes.value.set(W, H);
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    hudTex,
    render(t, { fade = 1, flash = 0, bloomStrength = 0, bloomThreshold = 0.55, bloomRadius = 0.55 } = {}) {
      hudTex.needsUpdate = true;
      bloom.strength = bloomStrength;
      bloom.threshold = bloomThreshold;
      bloom.radius = bloomRadius;
      grade.uniforms.uTime.value = t;
      grade.uniforms.uFade.value = fade;
      grade.uniforms.uFlash.value = flash;
      composer.render();
    },
  };
}
