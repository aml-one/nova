import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface VoiceOrbOptions {
  radius?: number;
  baseColor?: string;
  /** Clear WebGL to transparent so the page background shows (e.g. kiosk). */
  transparentBackground?: boolean;
}

export interface RotationDirection {
  x: number;
  y: number;
  z: number;
}

export type VoiceOrbPresetName = "calm" | "thinking" | "speaking" | "excited";

export interface VoiceOrbPreset {
  speechLevel: number;
  rotationSpeed: number;
  direction: RotationDirection;
}

const DEFAULT_PRESETS: Record<VoiceOrbPresetName, VoiceOrbPreset> = {
  calm: {
    speechLevel: 0,
    rotationSpeed: 0.085,
    direction: { x: 0.12, y: 1, z: 0.06 }
  },
  thinking: {
    speechLevel: 0.3,
    rotationSpeed: 0.7,
    direction: { x: 0.45, y: 0.9, z: 0.2 }
  },
  speaking: {
    speechLevel: 0.72,
    rotationSpeed: 1.8,
    direction: { x: 0.2, y: 1, z: 0.4 }
  },
  excited: {
    speechLevel: 0.96,
    rotationSpeed: 2.7,
    direction: { x: 0.8, y: 0.4, z: 0.75 }
  }
};

/** Classic Perlin 4D noise (Stefan Gustavson), from [organic-sphere](https://github.com/brunosimon/organic-sphere). */
const GLSL_PERLIN4D = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec4 fade(vec4 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

float perlin4d(vec4 P){
  vec4 Pi0 = floor(P);
  vec4 Pi1 = Pi0 + 1.0;
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec4 Pf0 = fract(P);
  vec4 Pf1 = Pf0 - 1.0;
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.zzzz);
  vec4 iz1 = vec4(Pi1.zzzz);
  vec4 iw0 = vec4(Pi0.wwww);
  vec4 iw1 = vec4(Pi1.wwww);

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 ixy00 = permute(ixy0 + iw0);
  vec4 ixy01 = permute(ixy0 + iw1);
  vec4 ixy10 = permute(ixy1 + iw0);
  vec4 ixy11 = permute(ixy1 + iw1);

  vec4 gx00 = ixy00 / 7.0;
  vec4 gy00 = floor(gx00) / 7.0;
  vec4 gz00 = floor(gy00) / 6.0;
  gx00 = fract(gx00) - 0.5;
  gy00 = fract(gy00) - 0.5;
  gz00 = fract(gz00) - 0.5;
  vec4 gw00 = vec4(0.75) - abs(gx00) - abs(gy00) - abs(gz00);
  vec4 sw00 = step(gw00, vec4(0.0));
  gx00 -= sw00 * (step(0.0, gx00) - 0.5);
  gy00 -= sw00 * (step(0.0, gy00) - 0.5);

  vec4 gx01 = ixy01 / 7.0;
  vec4 gy01 = floor(gx01) / 7.0;
  vec4 gz01 = floor(gy01) / 6.0;
  gx01 = fract(gx01) - 0.5;
  gy01 = fract(gy01) - 0.5;
  gz01 = fract(gz01) - 0.5;
  vec4 gw01 = vec4(0.75) - abs(gx01) - abs(gy01) - abs(gz01);
  vec4 sw01 = step(gw01, vec4(0.0));
  gx01 -= sw01 * (step(0.0, gx01) - 0.5);
  gy01 -= sw01 * (step(0.0, gy01) - 0.5);

  vec4 gx10 = ixy10 / 7.0;
  vec4 gy10 = floor(gx10) / 7.0;
  vec4 gz10 = floor(gy10) / 6.0;
  gx10 = fract(gx10) - 0.5;
  gy10 = fract(gy10) - 0.5;
  gz10 = fract(gz10) - 0.5;
  vec4 gw10 = vec4(0.75) - abs(gx10) - abs(gy10) - abs(gz10);
  vec4 sw10 = step(gw10, vec4(0.0));
  gx10 -= sw10 * (step(0.0, gx10) - 0.5);
  gy10 -= sw10 * (step(0.0, gy10) - 0.5);

  vec4 gx11 = ixy11 / 7.0;
  vec4 gy11 = floor(gx11) / 7.0;
  vec4 gz11 = floor(gy11) / 6.0;
  gx11 = fract(gx11) - 0.5;
  gy11 = fract(gy11) - 0.5;
  gz11 = fract(gz11) - 0.5;
  vec4 gw11 = vec4(0.75) - abs(gx11) - abs(gy11) - abs(gz11);
  vec4 sw11 = step(gw11, vec4(0.0));
  gx11 -= sw11 * (step(0.0, gx11) - 0.5);
  gy11 -= sw11 * (step(0.0, gy11) - 0.5);

  vec4 g0000 = vec4(gx00.x,gy00.x,gz00.x,gw00.x);
  vec4 g1000 = vec4(gx00.y,gy00.y,gz00.y,gw00.y);
  vec4 g0100 = vec4(gx00.z,gy00.z,gz00.z,gw00.z);
  vec4 g1100 = vec4(gx00.w,gy00.w,gz00.w,gw00.w);
  vec4 g0010 = vec4(gx10.x,gy10.x,gz10.x,gw10.x);
  vec4 g1010 = vec4(gx10.y,gy10.y,gz10.y,gw10.y);
  vec4 g0110 = vec4(gx10.z,gy10.z,gz10.z,gw10.z);
  vec4 g1110 = vec4(gx10.w,gy10.w,gz10.w,gw10.w);
  vec4 g0001 = vec4(gx01.x,gy01.x,gz01.x,gw01.x);
  vec4 g1001 = vec4(gx01.y,gy01.y,gz01.y,gw01.y);
  vec4 g0101 = vec4(gx01.z,gy01.z,gz01.z,gw01.z);
  vec4 g1101 = vec4(gx01.w,gy01.w,gz01.w,gw01.w);
  vec4 g0011 = vec4(gx11.x,gy11.x,gz11.x,gw11.x);
  vec4 g1011 = vec4(gx11.y,gy11.y,gz11.y,gw11.y);
  vec4 g0111 = vec4(gx11.z,gy11.z,gz11.z,gw11.z);
  vec4 g1111 = vec4(gx11.w,gy11.w,gz11.w,gw11.w);

  vec4 norm00 = taylorInvSqrt(vec4(dot(g0000, g0000), dot(g0100, g0100), dot(g1000, g1000), dot(g1100, g1100)));
  g0000 *= norm00.x;
  g0100 *= norm00.y;
  g1000 *= norm00.z;
  g1100 *= norm00.w;

  vec4 norm01 = taylorInvSqrt(vec4(dot(g0001, g0001), dot(g0101, g0101), dot(g1001, g1001), dot(g1101, g1101)));
  g0001 *= norm01.x;
  g0101 *= norm01.y;
  g1001 *= norm01.z;
  g1101 *= norm01.w;

  vec4 norm10 = taylorInvSqrt(vec4(dot(g0010, g0010), dot(g0110, g0110), dot(g1010, g1010), dot(g1110, g1110)));
  g0010 *= norm10.x;
  g0110 *= norm10.y;
  g1010 *= norm10.z;
  g1110 *= norm10.w;

  vec4 norm11 = taylorInvSqrt(vec4(dot(g0011, g0011), dot(g0111, g0111), dot(g1011, g1011), dot(g1111, g1111)));
  g0011 *= norm11.x;
  g0111 *= norm11.y;
  g1011 *= norm11.z;
  g1111 *= norm11.w;

  float n0000 = dot(g0000, Pf0);
  float n1000 = dot(g1000, vec4(Pf1.x, Pf0.yzw));
  float n0100 = dot(g0100, vec4(Pf0.x, Pf1.y, Pf0.zw));
  float n1100 = dot(g1100, vec4(Pf1.xy, Pf0.zw));
  float n0010 = dot(g0010, vec4(Pf0.xy, Pf1.z, Pf0.w));
  float n1010 = dot(g1010, vec4(Pf1.x, Pf0.y, Pf1.z, Pf0.w));
  float n0110 = dot(g0110, vec4(Pf0.x, Pf1.yz, Pf0.w));
  float n1110 = dot(g1110, vec4(Pf1.xyz, Pf0.w));
  float n0001 = dot(g0001, vec4(Pf0.xyz, Pf1.w));
  float n1001 = dot(g1001, vec4(Pf1.x, Pf0.yz, Pf1.w));
  float n0101 = dot(g0101, vec4(Pf0.x, Pf1.y, Pf0.z, Pf1.w));
  float n1101 = dot(g1101, vec4(Pf1.xy, Pf0.z, Pf1.w));
  float n0011 = dot(g0011, vec4(Pf0.xy, Pf1.zw));
  float n1011 = dot(g1011, vec4(Pf1.x, Pf0.y, Pf1.zw));
  float n0111 = dot(g0111, vec4(Pf0.x, Pf1.yzw));
  float n1111 = dot(g1111, Pf1);

  vec4 fade_xyzw = fade(Pf0);
  vec4 n_0w = mix(vec4(n0000, n1000, n0100, n1100), vec4(n0001, n1001, n0101, n1101), fade_xyzw.w);
  vec4 n_1w = mix(vec4(n0010, n1010, n0110, n1110), vec4(n0011, n1011, n0111, n1111), fade_xyzw.w);
  vec4 n_zw = mix(n_0w, n_1w, fade_xyzw.z);
  vec2 n_yzw = mix(n_zw.xy, n_zw.zw, fade_xyzw.y);
  float n_xyzw = mix(n_yzw.x, n_yzw.y, fade_xyzw.x);
  return 2.2 * n_xyzw;
}
`;

const ORGANIC_VERTEX_SHADER = `
#define M_PI 3.1415926535897932384626433832795

uniform vec3 uLightAColor;
uniform vec3 uLightAPosition;
uniform float uLightAIntensity;
uniform vec3 uLightBColor;
uniform vec3 uLightBPosition;
uniform float uLightBIntensity;

uniform vec2 uSubdivision;

uniform vec3 uOffset;

uniform float uDistortionFrequency;
uniform float uDistortionStrength;
uniform float uDisplacementFrequency;
uniform float uDisplacementStrength;

uniform float uFresnelOffset;
uniform float uFresnelMultiplier;
uniform float uFresnelPower;

uniform float uTime;

varying vec3 vColor;

${GLSL_PERLIN4D}

vec3 getDisplacedPosition(vec3 _position)
{
  vec3 distoredPosition = _position;
  distoredPosition += perlin4d(vec4(distoredPosition * uDistortionFrequency + uOffset, uTime)) * uDistortionStrength;

  float perlinStrength = perlin4d(vec4(distoredPosition * uDisplacementFrequency + uOffset, uTime));

  vec3 displacedPosition = _position;
  displacedPosition += normalize(_position) * perlinStrength * uDisplacementStrength;

  return displacedPosition;
}

void main()
{
  vec3 displacedPosition = getDisplacedPosition(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);

  float distanceA = (M_PI * 2.0) / uSubdivision.x;
  float distanceB = M_PI / uSubdivision.x;

  vec3 biTangent = cross(normal, tangent.xyz);

  vec3 positionA = position + tangent.xyz * distanceA;
  vec3 displacedPositionA = getDisplacedPosition(positionA);

  vec3 positionB = position + biTangent.xyz * distanceB;
  vec3 displacedPositionB = getDisplacedPosition(positionB);

  vec3 computedNormal = cross(displacedPositionA - displacedPosition, displacedPositionB - displacedPosition);
  computedNormal = normalize(computedNormal);

  vec3 worldNormal = normalize((modelMatrix * vec4(computedNormal, 0.0)).xyz);
  vec3 worldPos = (modelMatrix * vec4(displacedPosition, 1.0)).xyz;
  vec3 viewDirection = normalize(worldPos - cameraPosition);
  float fresnel = uFresnelOffset + (1.0 + dot(viewDirection, worldNormal)) * uFresnelMultiplier;
  fresnel = pow(max(0.0, fresnel), uFresnelPower);

  float lightAIntensity = max(0.0, - dot(worldNormal, normalize(- uLightAPosition))) * uLightAIntensity;
  float lightBIntensity = max(0.0, - dot(worldNormal, normalize(- uLightBPosition))) * uLightBIntensity;

  vec3 color = vec3(0.0);
  color = mix(color, uLightAColor, lightAIntensity * fresnel);
  color = mix(color, uLightBColor, lightBIntensity * fresnel);
  // Thin specular rim only — full white mix + bloom was washing the sphere to a flat blob.
  float rim = clamp(pow(max(0.0, fresnel - 0.76), 4.5), 0.0, 1.0);
  color = mix(color, vec3(1.0), rim * 0.14);

  vColor = color;
}
`;

const ORGANIC_FRAGMENT_SHADER = `
varying vec3 vColor;

void main()
{
  gl_FragColor = vec4(vColor, 1.0);
}
`;

/** Deep violet-black (reference organic-sphere promos), not grey. */
const ORGANIC_CLEAR = 0x0c0218;
const BLOOM_TINT_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D blurTexture1;
uniform sampler2D blurTexture2;
uniform sampler2D blurTexture3;
uniform sampler2D blurTexture4;
uniform sampler2D blurTexture5;
uniform float bloomStrength;
uniform float bloomRadius;
uniform float bloomFactors[NUM_MIPS];
uniform vec3 bloomTintColors[NUM_MIPS];
uniform vec3 uTintColor;
uniform float uTintStrength;

float lerpBloomFactor(const in float factor) {
  float mirrorFactor = 1.2 - factor;
  return mix(factor, mirrorFactor, bloomRadius);
}

void main() {
  vec4 color = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
    lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
    lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
    lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
    lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );

  color.rgb = mix(color.rgb, uTintColor, uTintStrength);
  gl_FragColor = color;
}
`;

type Variation = {
  current: number;
  target: number;
  upEasing: number;
  downEasing: number;
};

/**
 * Organic Perlin sphere (after [organic-sphere](https://github.com/brunosimon/organic-sphere)),
 * driven by TTS analyser envelope instead of the microphone.
 */
export class AIVoiceOrb {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;

  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  private rotationSpeed = 0.5;
  private rotationDirection = new THREE.Vector3(0.4, 1, 0.2).normalize();
  private targetDirection = this.rotationDirection.clone();
  private speechLevel = 0;
  private speechPeak = 0;

  /** Near-static mesh + slow breathing when Nova is not speaking (kiosk idle, etc.). */
  private presentationIdleCalm = false;

  private readonly moodTarget = {
    colorA: new THREE.Color("#ff2a08"),
    colorB: new THREE.Color("#0090ff")
  };

  private readonly moodCurrent = {
    colorA: new THREE.Color("#ff2a08"),
    colorB: new THREE.Color("#0090ff")
  };

  private rafId = 0;

  private readonly uniforms: {
    uLightAColor: THREE.IUniform<THREE.Color>;
    uLightAPosition: THREE.IUniform<THREE.Vector3>;
    uLightAIntensity: THREE.IUniform<number>;
    uLightBColor: THREE.IUniform<THREE.Color>;
    uLightBPosition: THREE.IUniform<THREE.Vector3>;
    uLightBIntensity: THREE.IUniform<number>;
    uSubdivision: THREE.IUniform<THREE.Vector2>;
    uOffset: THREE.IUniform<THREE.Vector3>;
    uDistortionFrequency: THREE.IUniform<number>;
    uDistortionStrength: THREE.IUniform<number>;
    uDisplacementFrequency: THREE.IUniform<number>;
    uDisplacementStrength: THREE.IUniform<number>;
    uFresnelOffset: THREE.IUniform<number>;
    uFresnelMultiplier: THREE.IUniform<number>;
    uFresnelPower: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>;
  };

  private dampedSpeak = 0;
  private dampedSpeakPeak = 0;

  private readonly variations: Record<"volume" | "lowLevel" | "mediumLevel" | "highLevel", Variation> = {
    volume: { current: 0.02, target: 0.02, upEasing: 0.03, downEasing: 0.002 },
    lowLevel: { current: 0.00008, target: 0.00008, upEasing: 0.005, downEasing: 0.002 },
    mediumLevel: { current: 2.08, target: 2.08, upEasing: 0.008, downEasing: 0.004 },
    highLevel: { current: 0.06, target: 0.06, upEasing: 0.02, downEasing: 0.001 }
  };

  private readonly offsetSpherical = new THREE.Spherical(1, Math.random() * Math.PI, Math.random() * Math.PI * 2);
  private readonly offsetDirection = new THREE.Vector3();
  private timeFrequency = 0.0003;

  /** Warm key ≈ top-right on screen, cool fill ≈ bottom-left (reference art). */
  private readonly lights = {
    a: {
      intensity: 2.05,
      spherical: new THREE.Spherical(1, 0.52, 0.55)
    },
    b: {
      intensity: 1.65,
      spherical: new THREE.Spherical(1, 2.15, -2.35)
    }
  };

  constructor(private readonly mount: HTMLElement, options: VoiceOrbOptions = {}) {
    const radius = options.radius ?? 1.8;
    const segs = 384;
    const w = this.mount.clientWidth;
    const h = Math.max(this.mount.clientHeight, 1);
    const pr = Math.min(window.devicePixelRatio, 2);
    const transparent = options.transparentBackground === true;

    this.mount.style.position = "relative";
    this.mount.style.overflow = "hidden";

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent });
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    if (transparent) {
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.renderer.setClearColor(ORGANIC_CLEAR, 1);
    }
    this.renderer.toneMapping = THREE.NoToneMapping;

    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    if (transparent) {
      canvas.style.background = "transparent";
    }
    this.mount.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(25, w / h, 0.1, 100);
    this.camera.position.set(0, 0, 7);

    this.renderPass = transparent
      ? new RenderPass(this.scene, this.camera, null, new THREE.Color(0, 0, 0), 0)
      : new RenderPass(this.scene, this.camera, null, new THREE.Color(ORGANIC_CLEAR), 1);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.55, 0.82);
    this.bloomPass.compositeMaterial.uniforms.uTintColor = { value: new THREE.Color("#4a0a6e") };
    this.bloomPass.compositeMaterial.uniforms.uTintStrength = { value: 0.09 };
    this.bloomPass.compositeMaterial.fragmentShader = BLOOM_TINT_FRAGMENT;
    this.bloomPass.compositeMaterial.needsUpdate = true;

    this.outputPass = new OutputPass();

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    const geometry = new THREE.SphereGeometry(radius, segs, segs);
    geometry.computeTangents();

    this.uniforms = {
      uLightAColor: { value: this.moodCurrent.colorA.clone() },
      uLightAPosition: { value: new THREE.Vector3(1, 1, 0) },
      uLightAIntensity: { value: this.lights.a.intensity },
      uLightBColor: { value: this.moodCurrent.colorB.clone() },
      uLightBPosition: { value: new THREE.Vector3(-1, -1, 0) },
      uLightBIntensity: { value: this.lights.b.intensity },
      uSubdivision: { value: new THREE.Vector2(geometry.parameters.widthSegments, geometry.parameters.heightSegments) },
      uOffset: { value: new THREE.Vector3(0, 0, 0) },
      uDistortionFrequency: { value: 1.35 },
      uDistortionStrength: { value: 0.52 },
      uDisplacementFrequency: { value: 1.95 },
      uDisplacementStrength: { value: 0.14 },
      uFresnelOffset: { value: -1.45 },
      uFresnelMultiplier: { value: 2.85 },
      uFresnelPower: { value: 1.95 },
      uTime: { value: 0 }
    };

    this.uniforms.uLightAPosition.value.setFromSpherical(this.lights.a.spherical);
    this.uniforms.uLightBPosition.value.setFromSpherical(this.lights.b.spherical);

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        defines: { USE_TANGENT: "" },
        vertexShader: ORGANIC_VERTEX_SHADER,
        fragmentShader: ORGANIC_FRAGMENT_SHADER
      })
    );

    this.scene.add(this.mesh);

    if (options.baseColor) {
      this.setBaseColor(options.baseColor);
    }

    window.addEventListener("resize", this.handleResize);
    this.animate();
  }

  setBaseColor(hex: string): void {
    const accent = new THREE.Color(hex);
    // Single accent was driving both lights to the same hue → flat white bloom. Anchor warm/cool like reference art.
    const warm = new THREE.Color("#ff2200").lerp(accent, 0.26);
    const cool = new THREE.Color("#0088ff").lerp(accent, 0.32);
    warm.offsetHSL(0, 0.06, 0.03);
    cool.offsetHSL(-0.02, 0.04, -0.04);
    this.moodTarget.colorA.copy(warm);
    this.moodTarget.colorB.copy(cool);
    this.moodCurrent.colorA.copy(warm);
    this.moodCurrent.colorB.copy(cool);
    this.syncLightUniforms();
  }

  setPresentationIdleCalm(calm: boolean): void {
    this.presentationIdleCalm = calm;
    if (calm) {
      this.speechLevel = 0;
      this.speechPeak = 0;
      this.dampedSpeak = 0;
      this.dampedSpeakPeak = 0;
      this.variations.volume.current = 0.018;
      this.variations.lowLevel.current = 0.00006;
      this.variations.mediumLevel.current = 2.02;
      this.variations.highLevel.current = 0.055;
    }
  }

  setSpeechEnvelope(smooth: number, peak: number): void {
    this.speechLevel = THREE.MathUtils.clamp(smooth, 0, 1);
    this.speechPeak = THREE.MathUtils.clamp(peak, 0, 1);
  }

  setSpeechLevel(level: number): void {
    const v = THREE.MathUtils.clamp(level, 0, 1);
    this.setSpeechEnvelope(v, v);
  }

  setMoodPalette(colorA: string, colorB: string, _shellRgb: string, _glowHex: string): void {
    void _shellRgb;
    void _glowHex;
    this.moodTarget.colorA.set(colorA);
    this.moodTarget.colorB.set(colorB);
  }

  setRotationSpeed(speed: number): void {
    this.rotationSpeed = Math.max(0, speed);
  }

  setRotationDirection(direction: RotationDirection): void {
    const v = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (v.lengthSq() > 0) {
      this.targetDirection.copy(v.normalize());
    }
  }

  randomizeDirection(): void {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (v.lengthSq() > 0) {
      this.targetDirection.copy(v.normalize());
    }
    if (Math.random() < 0.5) {
      this.targetDirection.multiplyScalar(-1);
    }
  }

  applyPreset(name: VoiceOrbPresetName): void {
    const preset = DEFAULT_PRESETS[name];
    if (!this.presentationIdleCalm) {
      this.setSpeechLevel(preset.speechLevel);
    }
    this.setRotationSpeed(preset.rotationSpeed);
    this.setRotationDirection(preset.direction);
  }

  applyPresetValues(values: VoiceOrbPreset): void {
    if (!this.presentationIdleCalm) {
      this.setSpeechLevel(values.speechLevel);
    }
    this.setRotationSpeed(values.rotationSpeed);
    this.setRotationDirection(values.direction);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.handleResize);

    this.mesh.geometry.dispose();
    this.mesh.material.dispose();

    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();

    this.renderer.dispose();
    try {
      if (this.renderer.domElement.parentNode === this.mount) {
        this.mount.removeChild(this.renderer.domElement);
      }
    } catch {
      // Ignore if DOM already detached.
    }
  }

  private syncLightUniforms(): void {
    this.uniforms.uLightAColor.value.copy(this.moodCurrent.colorA);
    this.uniforms.uLightBColor.value.copy(this.moodCurrent.colorB);
  }

  /**
   * Map TTS envelope to the same value ranges as organic-sphere's microphone `levels[0..2]`,
   * then apply Bruno's exact formulas (see Sphere.js in the demo repo).
   */
  private refreshSpeechTargets(speak: number, speakPeak: number): void {
    if (this.presentationIdleCalm) {
      this.variations.volume.target = 0.018;
      this.variations.lowLevel.target = 0.00006;
      this.variations.mediumLevel.target = 2.02;
      this.variations.highLevel.target = 0.055;
      return;
    }

    const s = THREE.MathUtils.clamp(speak, 0, 1);
    const p = THREE.MathUtils.clamp(speakPeak, 0, 1);
    const level0 = THREE.MathUtils.clamp(s * 0.55 + p * 0.35, 0, 1);
    const level1 = THREE.MathUtils.clamp(s * 0.5 + p * 0.42, 0, 1);
    const level2 = THREE.MathUtils.clamp(s * 0.28 + p * 0.62, 0, 1);

    this.variations.volume.target = Math.max(level0, level1, level2) * 0.3;

    let low = (level0 || 0) * 0.003;
    low += 0.0001;
    this.variations.lowLevel.target = Math.max(0, low);

    let med = (level1 || 0) * 1.35;
    med += 3.35;
    this.variations.mediumLevel.target = THREE.MathUtils.clamp(Math.max(3.35, med), 3.2, 4.05);

    let high = (level2 || 0) * 2.85;
    high += 0.52;
    this.variations.highLevel.target = THREE.MathUtils.clamp(Math.max(0.52, high), 0.5, 2.25);
  }

  /** organic-sphere uses `time.delta` in milliseconds (~16), not seconds. */
  private stepVariations(deltaMs: number): void {
    for (const key of Object.keys(this.variations) as (keyof typeof this.variations)[]) {
      const v = this.variations[key];
      const easing = v.target > v.current ? v.upEasing : v.downEasing;
      v.current += (v.target - v.current) * easing * deltaMs;
    }

    this.timeFrequency = this.variations.lowLevel.current;
    this.uniforms.uDisplacementStrength.value = this.variations.volume.current;
    this.uniforms.uDistortionStrength.value = this.variations.highLevel.current;
    this.uniforms.uFresnelMultiplier.value = this.variations.mediumLevel.current;
  }

  private stepOrganicOffset(deltaMs: number): void {
    if (this.presentationIdleCalm) {
      // Freeze noise phase drift so the surface stays visually calm; breathing is scale-only.
      this.uniforms.uTime.value += deltaMs * 0.000002;
      return;
    }

    const elapsedTime = deltaMs * this.timeFrequency;
    const offsetTime = elapsedTime * 0.3;
    this.offsetSpherical.phi = ((Math.sin(offsetTime * 0.001) * Math.sin(offsetTime * 0.00321)) * 0.5 + 0.5) * Math.PI;
    this.offsetSpherical.theta =
      ((Math.sin(offsetTime * 0.0001) * Math.sin(offsetTime * 0.000321)) * 0.5 + 0.5) * Math.PI * 2;
    this.offsetDirection.setFromSpherical(this.offsetSpherical);
    this.offsetDirection.multiplyScalar(this.timeFrequency * 2);
    this.uniforms.uOffset.value.add(this.offsetDirection);
    this.uniforms.uTime.value += elapsedTime;
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);

    const dt = this.clock.getDelta();
    const deltaMs = Math.min(dt * 1000, 60);

    const dampRate = this.presentationIdleCalm ? 22 : 10;
    const dampPeakRate = this.presentationIdleCalm ? 36 : 28;
    this.dampedSpeak = THREE.MathUtils.damp(this.dampedSpeak, this.speechLevel, dampRate, dt);
    this.dampedSpeakPeak = THREE.MathUtils.damp(this.dampedSpeakPeak, this.speechPeak, dampPeakRate, dt);

    this.refreshSpeechTargets(this.dampedSpeak, this.dampedSpeakPeak);
    this.stepVariations(deltaMs);
    this.stepOrganicOffset(deltaMs);

    const moodLerp = Math.min(1, dt * 4.2);
    this.moodCurrent.colorA.lerp(this.moodTarget.colorA, moodLerp);
    this.moodCurrent.colorB.lerp(this.moodTarget.colorB, moodLerp);
    this.syncLightUniforms();

    this.rotationDirection.lerp(this.targetDirection, Math.min(1, dt * 5));
    this.rotationDirection.normalize();

    const step = this.rotationSpeed * dt;
    this.mesh.rotateOnAxis(this.rotationDirection, step);

    const calm = this.presentationIdleCalm;
    const spk = calm ? 0 : Math.max(this.dampedSpeak, this.dampedSpeakPeak * 0.82);
    const breathOmega = calm ? 0.95 : 1.65;
    const breathAmp = calm ? 0.0075 : 0.018 * (1 + spk * 2.4);
    const breathing = 1 + Math.sin(this.clock.elapsedTime * breathOmega) * breathAmp;
    this.mesh.scale.setScalar(breathing);

    this.composer.render(dt);
  };

  private handleResize = (): void => {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    const pr = Math.min(window.devicePixelRatio, 2);

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
  };
}
