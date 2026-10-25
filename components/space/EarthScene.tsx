"use client";

import { useEffect, useRef, useState } from "react";
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import { EARTH_TEXTURE } from "./earth-texture";
import { paintFlagTexture } from "./flag-texture";
import { LAUNCH_MS } from "./launch";

const EARTH_TILT = 0.41; // Earth's axial tilt, radians
const SPIN_PER_SECOND = 0.05; // gentle rotation
const EARTH_OFFSET_Y = -0.62; // sit the globe low in the frame, under the search box
const START_FOV = 35;
const END_FOV = 52; // widening field of view during the zoom adds a sense of speed

// Perspective already makes the approach accelerate on screen, so ease the camera *out*: the globe
// visibly swells from the first frame and fills the view before the overlay dissolves.
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * Rotating, lit 3D Earth in a starfield. When `launching` turns true, the camera rushes toward
 * the globe over LAUNCH_MS until its surface fills the frame. Calls `onUnsupported` if WebGL is
 * unavailable so the caller can show a flat fallback.
 */
export function EarthScene({ launching, onUnsupported }: { launching: boolean; onUnsupported: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (launching && launchRef.current === null) launchRef.current = performance.now();
  }, [launching]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      onUnsupported();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(START_FOV, 1, 0.01, 400);

    // Earth, tilted on its axis.
    const earthCenter = new Vector3(0, EARTH_OFFSET_Y, 0);
    const tiltGroup = new Group();
    tiltGroup.position.copy(earthCenter);
    tiltGroup.rotation.z = EARTH_TILT;
    scene.add(tiltGroup);

    // Paint every country's flag over the Blue Marble, then reveal the globe (plain Earth if that fails).
    let disposed = false;
    let flagTexture: CanvasTexture | null = null;
    const texture = new TextureLoader().load(EARTH_TEXTURE, () => {
      paintFlagTexture(texture.image as HTMLImageElement, Math.min(4096, renderer.capabilities.maxTextureSize))
        .then((canvas) => {
          if (disposed) return;
          flagTexture = new CanvasTexture(canvas);
          flagTexture.colorSpace = SRGBColorSpace;
          flagTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          earthMaterial.map = flagTexture;
          earthMaterial.needsUpdate = true;
        })
        .catch(() => {})
        .finally(() => {
          if (!disposed) setReady(true);
        });
    });
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthGeometry = new SphereGeometry(1, 128, 128);
    const earthMaterial = new MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 });
    const earth = new Mesh(earthGeometry, earthMaterial);
    earth.rotation.y = -1.9; // open on the Atlantic, Europe and Africa
    tiltGroup.add(earth);

    // Atmosphere: a back-facing shell with a Fresnel glow.
    const atmosphereGeometry = new SphereGeometry(1, 64, 64);
    const atmosphereMaterial = new ShaderMaterial({
      uniforms: {},
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
          gl_FragColor = vec4(0.45, 0.72, 1.0, 1.0) * intensity;
        }`,
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmosphere = new Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphere.position.copy(earthCenter);
    atmosphere.scale.setScalar(1.16);
    scene.add(atmosphere);

    // Sunlight from the upper left gives a day/night terminator.
    const sun = new DirectionalLight(0xffffff, 2.6);
    sun.position.set(-5, 2.5, 4);
    scene.add(sun);
    scene.add(new AmbientLight(0xc8d2e6, 2.6)); // enough fill that flags on the night side still read

    // Stars scattered on a distant shell.
    const starPositions: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * 60;
      const s = Math.sqrt(1 - u * u);
      starPositions.push(r * s * Math.cos(theta), r * s * Math.sin(theta), r * u);
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
    const starMaterial = new PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.85 });
    const stars = new Points(starGeometry, starMaterial);
    scene.add(stars);

    // Frame the globe: about 58% of the height, never wider than ~78% of the width.
    const restPosition = new Vector3();
    const frame = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      const halfTan = Math.tan(((START_FOV / 2) * Math.PI) / 180);
      const byHeight = 2 / (0.58 * 2 * halfTan);
      const byWidth = 2 / (0.78 * 2 * halfTan * camera.aspect);
      restPosition.set(0, 0, Math.max(byHeight, byWidth));
      if (launchRef.current === null) {
        camera.position.copy(restPosition);
        camera.fov = START_FOV;
      }
      camera.updateProjectionMatrix();
    };
    frame();
    const resizeObserver = new ResizeObserver(frame);
    resizeObserver.observe(mount);

    // Zoom target: just above the surface, facing the globe, so it fills the screen.
    const launchTarget = earthCenter.clone().add(new Vector3(0, 0, 1.06));
    const lookTarget = new Vector3();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      earth.rotation.y += SPIN_PER_SECOND * dt;
      stars.rotation.y += SPIN_PER_SECOND * 0.08 * dt;

      if (launchRef.current !== null) {
        const t = Math.min((now - launchRef.current) / LAUNCH_MS, 1);
        const e = easeOutQuad(t);
        camera.position.lerpVectors(restPosition, launchTarget, e);
        camera.fov = START_FOV + (END_FOV - START_FOV) * e;
        // Look from the frame's centre toward the globe's centre as we approach.
        lookTarget.set(0, 0, 0).lerp(earthCenter, e);
        camera.lookAt(lookTarget);
        camera.updateProjectionMatrix();
        earth.rotation.y += SPIN_PER_SECOND * 6 * dt; // spin up slightly while rushing in
      } else {
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      earthGeometry.dispose();
      earthMaterial.dispose();
      texture.dispose();
      flagTexture?.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onUnsupported]);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="absolute inset-0 transition-opacity duration-700"
      style={{ opacity: ready ? 1 : 0 }}
    />
  );
}
