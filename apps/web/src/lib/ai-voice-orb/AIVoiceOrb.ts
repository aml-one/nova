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

export class AIVoiceOrb {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();

  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly shell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly glow: THREE.Sprite;

  private rotationSpeed = 0.5;
  private rotationDirection = new THREE.Vector3(0.4, 1, 0.2).normalize();
  private targetDirection = this.rotationDirection.clone();
  private speechLevel = 0.2;
  private rafId = 0;

  private readonly uniforms = {
    uTime: { value: 0 },
    uSpeak: { value: 0.2 },
    uColorA: { value: new THREE.Color("#39b9ff") },
    uColorB: { value: new THREE.Color("#94f0ff") }
  };

  constructor(private readonly mount: HTMLElement, options: VoiceOrbOptions = {}) {
    const radius = options.radius ?? 1.8;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.mount.clientWidth, this.mount.clientHeight);
    this.mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, this.mount.clientWidth / this.mount.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 8);

    this.scene.add(new THREE.AmbientLight(0x66b6ff, 0.45));

    const keyLight = new THREE.PointLight(0x3aa7ff, 2.4, 20);
    keyLight.position.set(3, 4, 5);
    this.scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x5de8ff, 1.8, 20);
    rimLight.position.set(-5, -2, -2);
    this.scene.add(rimLight);

    const geometry = new THREE.SphereGeometry(radius, 160, 160);

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPos;
          uniform float uTime;
          uniform float uSpeak;

          void main() {
            vNormal = normal;

            float wave1 = sin(position.y * 5.0 + uTime * 1.8) * 0.06;
            float wave2 = sin(position.x * 7.5 - uTime * 2.4) * 0.05;
            float wave3 = sin((position.z + position.x) * 9.0 + uTime * 2.0) * 0.035;
            float pulse = (wave1 + wave2 + wave3) * (0.5 + uSpeak * 1.7);

            vec3 displaced = position + normal * pulse;
            vPos = displaced;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          varying vec3 vPos;
          uniform float uTime;
          uniform float uSpeak;
          uniform vec3 uColorA;
          uniform vec3 uColorB;

          void main() {
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.6);

            float ribbons = sin((vPos.y + vPos.x) * 8.0 + uTime * 2.8) * 0.5 + 0.5;
            ribbons += sin((vPos.y - vPos.z) * 11.0 - uTime * 2.2) * 0.5 + 0.5;
            ribbons = ribbons * 0.5;

            float alpha = smoothstep(0.18, 1.0, ribbons) * (0.3 + fresnel * 0.95) * (0.45 + uSpeak * 1.2);
            vec3 col = mix(uColorA, uColorB, ribbons + fresnel * 0.4);

            gl_FragColor = vec4(col, alpha);
          }
        `
      })
    );

    this.shell = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vNormal;
          uniform float uTime;
          uniform float uSpeak;

          void main() {
            vNormal = normal;
            float shellWave = sin(position.y * 3.0 + uTime * 1.2) * 0.08 * (1.0 + uSpeak);
            vec3 p = position + normal * (0.32 + shellWave);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform float uTime;
          uniform float uSpeak;

          void main() {
            float edge = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.0);
            float ripple = sin(vNormal.y * 9.0 + uTime * 2.0) * 0.5 + 0.5;
            float alpha = edge * (0.18 + ripple * 0.18) * (0.5 + uSpeak);
            gl_FragColor = vec4(0.24, 0.72, 1.0, alpha);
          }
        `
      })
    );

    const glowMap = this.buildGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowMap,
      color: 0x2ea8ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(7.2, 7.2, 1);

    this.scene.add(this.glow);
    this.scene.add(this.shell);
    this.scene.add(this.mesh);

    if (options.baseColor) {
      this.setBaseColor(options.baseColor);
    }

    window.addEventListener("resize", this.handleResize);
    this.animate();
  }

  setBaseColor(hex: string): void {
    const c = new THREE.Color(hex);
    this.uniforms.uColorA.value.copy(c);
    this.uniforms.uColorB.value.copy(c.clone().offsetHSL(0.06, 0.08, 0.22));
  }

  setSpeechLevel(level: number): void {
    this.speechLevel = THREE.MathUtils.clamp(level, 0, 1);
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
    this.shell.material.dispose();

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

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);

    const dt = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;

    this.uniforms.uTime.value = elapsed;
    this.uniforms.uSpeak.value = THREE.MathUtils.damp(this.uniforms.uSpeak.value, this.speechLevel, 8, dt);

    this.rotationDirection.lerp(this.targetDirection, Math.min(1, dt * 5));
    this.rotationDirection.normalize();

    const step = this.rotationSpeed * dt;
    this.mesh.rotateOnAxis(this.rotationDirection, step);
    this.shell.rotateOnAxis(this.rotationDirection, step * 0.9);

    const breathing = 1 + Math.sin(elapsed * 1.7) * 0.02 * (1 + this.uniforms.uSpeak.value * 2.2);
    this.mesh.scale.setScalar(breathing);
    this.shell.scale.setScalar(1 + (breathing - 1) * 1.2);

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
    grad.addColorStop(0, "rgba(138, 226, 255, 1)");
    grad.addColorStop(0.25, "rgba(90, 188, 255, 0.6)");
    grad.addColorStop(1, "rgba(9, 25, 54, 0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
