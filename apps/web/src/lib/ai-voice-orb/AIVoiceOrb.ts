import * as THREE from "three";

export interface VoiceOrbOptions {
  radius?: number;
  baseColor?: string;
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
    speechLevel: 0.14,
    rotationSpeed: 0.34,
    direction: { x: 0.15, y: 1, z: 0.1 }
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
  vec4 viewPosition = modelViewMatrix * vec4(displacedPosition, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  float distanceA = (M_PI * 2.0) / uSubdivision.x;
  float distanceB = M_PI / uSubdivision.x;

  vec3 biTangent = cross(normal, tangent.xyz);

  vec3 positionA = position + tangent.xyz * distanceA;
  vec3 displacedPositionA = getDisplacedPosition(positionA);

  vec3 positionB = position + biTangent.xyz * distanceB;
  vec3 displacedPositionB = getDisplacedPosition(positionB);

  vec3 computedNormal = cross(displacedPositionA - displacedPosition, displacedPositionB - displacedPosition);
  computedNormal = normalize(computedNormal);

  vec3 viewDirection = normalize(displacedPosition - cameraPosition);
  float fresnel = uFresnelOffset + (1.0 + dot(viewDirection, computedNormal)) * uFresnelMultiplier;
  fresnel = pow(max(0.0, fresnel), uFresnelPower);

  float lightAIntensity = max(0.0, - dot(computedNormal, normalize(- uLightAPosition))) * uLightAIntensity;
  float lightBIntensity = max(0.0, - dot(computedNormal, normalize(- uLightBPosition))) * uLightBIntensity;

  vec3 color = vec3(0.0);
  color = mix(color, uLightAColor, lightAIntensity * fresnel);
  color = mix(color, uLightBColor, lightBIntensity * fresnel);
  color = mix(color, vec3(1.0), clamp(pow(max(0.0, fresnel - 0.8), 3.0), 0.0, 1.0));

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

  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly glow: THREE.Sprite;

  private rotationSpeed = 0.5;
  private rotationDirection = new THREE.Vector3(0.4, 1, 0.2).normalize();
  private targetDirection = this.rotationDirection.clone();
  private speechLevel = 0.2;
  private speechPeak = 0.2;

  private readonly moodTarget = {
    colorA: new THREE.Color("#ff3e00"),
    colorB: new THREE.Color("#0063ff"),
    glow: new THREE.Color("#2ea8ff")
  };

  private readonly moodCurrent = {
    colorA: new THREE.Color("#ff3e00"),
    colorB: new THREE.Color("#0063ff"),
    glow: new THREE.Color("#2ea8ff")
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

  private dampedSpeak = 0.2;
  private dampedSpeakPeak = 0.2;

  private glowMaterial: THREE.SpriteMaterial;

  private readonly variations: Record<"volume" | "lowLevel" | "mediumLevel" | "highLevel", Variation> = {
    volume: { current: 0.152, target: 0.152, upEasing: 0.03, downEasing: 0.002 },
    lowLevel: { current: 0.0003, target: 0.0003, upEasing: 0.005, downEasing: 0.002 },
    mediumLevel: { current: 3.587, target: 3.587, upEasing: 0.008, downEasing: 0.004 },
    highLevel: { current: 0.65, target: 0.65, upEasing: 0.02, downEasing: 0.001 }
  };

  private readonly offsetSpherical = new THREE.Spherical(1, Math.random() * Math.PI, Math.random() * Math.PI * 2);
  private readonly offsetDirection = new THREE.Vector3();
  private timeFrequency = 0.0003;

  private readonly lights = {
    a: {
      intensity: 1.85,
      spherical: new THREE.Spherical(1, 0.615, 2.049)
    },
    b: {
      intensity: 1.4,
      spherical: new THREE.Spherical(1, 2.561, -1.844)
    }
  };

  constructor(private readonly mount: HTMLElement, options: VoiceOrbOptions = {}) {
    const radius = options.radius ?? 1.8;
    const segs = 220;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.mount.clientWidth, this.mount.clientHeight);
    this.renderer.setClearColor(0x000000, 0);
    this.mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      25,
      this.mount.clientWidth / Math.max(this.mount.clientHeight, 1),
      0.1,
      100
    );
    this.camera.position.set(0, 0, 7);

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
      uDistortionFrequency: { value: 1.5 },
      uDistortionStrength: { value: 0.65 },
      uDisplacementFrequency: { value: 2.12 },
      uDisplacementStrength: { value: 0.152 },
      uFresnelOffset: { value: -1.609 },
      uFresnelMultiplier: { value: 3.587 },
      uFresnelPower: { value: 1.793 },
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

    const glowMap = this.buildGlowTexture();
    this.glowMaterial = new THREE.SpriteMaterial({
      map: glowMap,
      color: this.moodCurrent.glow.clone(),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.scale.set(7.8, 7.8, 1);

    this.scene.add(this.glow);
    this.scene.add(this.mesh);

    if (options.baseColor) {
      this.setBaseColor(options.baseColor);
    }

    window.addEventListener("resize", this.handleResize);
    this.animate();
  }

  setBaseColor(hex: string): void {
    const c = new THREE.Color(hex);
    this.moodTarget.colorA.copy(c).offsetHSL(0.02, 0.06, 0.04);
    this.moodTarget.colorB.copy(c).offsetHSL(-0.04, 0.02, 0.12);
    this.moodTarget.glow.copy(c);
    this.moodCurrent.colorA.copy(this.moodTarget.colorA);
    this.moodCurrent.colorB.copy(this.moodTarget.colorB);
    this.moodCurrent.glow.copy(this.moodTarget.glow);
    this.syncLightUniforms();
  }

  setSpeechEnvelope(smooth: number, peak: number): void {
    this.speechLevel = THREE.MathUtils.clamp(smooth, 0, 1);
    this.speechPeak = THREE.MathUtils.clamp(peak, 0, 1);
  }

  setSpeechLevel(level: number): void {
    const v = THREE.MathUtils.clamp(level, 0, 1);
    this.setSpeechEnvelope(v, v);
  }

  setMoodPalette(colorA: string, colorB: string, _shellRgb: string, glowHex: string): void {
    void _shellRgb;
    this.moodTarget.colorA.set(colorA);
    this.moodTarget.colorB.set(colorB);
    this.moodTarget.glow.set(glowHex);
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
    this.setSpeechLevel(preset.speechLevel);
    this.setRotationSpeed(preset.rotationSpeed);
    this.setRotationDirection(preset.direction);
  }

  applyPresetValues(values: VoiceOrbPreset): void {
    this.setSpeechLevel(values.speechLevel);
    this.setRotationSpeed(values.rotationSpeed);
    this.setRotationDirection(values.direction);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.handleResize);

    this.mesh.geometry.dispose();
    this.mesh.material.dispose();

    const spriteMaterial = this.glow.material as THREE.SpriteMaterial;
    spriteMaterial.map?.dispose();
    spriteMaterial.dispose();

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
    this.glowMaterial.color.copy(this.moodCurrent.glow);
  }

  private refreshSpeechTargets(speak: number, speakPeak: number): void {
    const s = speak;
    const p = speakPeak;
    const drive = Math.min(1, s * 0.85 + p * 0.95);

    this.variations.volume.target = THREE.MathUtils.clamp(0.11 + s * 0.34 + p * 0.48, 0.08, 0.78);
    this.variations.lowLevel.target = THREE.MathUtils.clamp(0.00022 + drive * 0.00115, 0.00012, 0.0018);
    this.variations.mediumLevel.target = THREE.MathUtils.clamp(3.35 + s * 0.55 + p * 1.05, 2.8, 6.2);
    this.variations.highLevel.target = THREE.MathUtils.clamp(0.42 + s * 1.85 + p * 2.95, 0.35, 7.5);
  }

  private stepVariations(dt: number): void {
    for (const key of Object.keys(this.variations) as (keyof typeof this.variations)[]) {
      const v = this.variations[key];
      const easing = v.target > v.current ? v.upEasing : v.downEasing;
      v.current += (v.target - v.current) * easing * dt;
    }

    this.timeFrequency = this.variations.lowLevel.current;
    this.uniforms.uDisplacementStrength.value = this.variations.volume.current;
    this.uniforms.uDistortionStrength.value = this.variations.highLevel.current;
    this.uniforms.uFresnelMultiplier.value = this.variations.mediumLevel.current;
  }

  private stepOrganicOffset(dt: number): void {
    const elapsedTime = dt * this.timeFrequency;
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

    this.dampedSpeak = THREE.MathUtils.damp(this.dampedSpeak, this.speechLevel, 10, dt);
    this.dampedSpeakPeak = THREE.MathUtils.damp(this.dampedSpeakPeak, this.speechPeak, 28, dt);

    this.refreshSpeechTargets(this.dampedSpeak, this.dampedSpeakPeak);
    this.stepVariations(dt);
    this.stepOrganicOffset(dt);

    const moodLerp = Math.min(1, dt * 4.2);
    this.moodCurrent.colorA.lerp(this.moodTarget.colorA, moodLerp);
    this.moodCurrent.colorB.lerp(this.moodTarget.colorB, moodLerp);
    this.moodCurrent.glow.lerp(this.moodTarget.glow, moodLerp);
    this.syncLightUniforms();

    this.rotationDirection.lerp(this.targetDirection, Math.min(1, dt * 5));
    this.rotationDirection.normalize();

    const step = this.rotationSpeed * dt;
    this.mesh.rotateOnAxis(this.rotationDirection, step);

    const spk = Math.max(this.dampedSpeak, this.dampedSpeakPeak * 0.82);
    const breathing = 1 + Math.sin(this.clock.elapsedTime * 1.65) * 0.018 * (1 + spk * 2.4);
    this.mesh.scale.setScalar(breathing);
    this.glow.scale.setScalar(7.8 * (0.92 + spk * 0.22));

    this.renderer.render(this.scene, this.camera);
  };

  private handleResize = (): void => {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private buildGlowTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return new THREE.Texture();
    }

    const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(200, 230, 255, 0.95)");
    grad.addColorStop(0.28, "rgba(90, 140, 255, 0.45)");
    grad.addColorStop(1, "rgba(9, 25, 54, 0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
