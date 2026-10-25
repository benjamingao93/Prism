"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
  WebGLRenderer,
} from "three";
import { paintFlagTexture } from "./flag-texture";

const EARTH_TILT = 0.41; // Earth's axial tilt, radians
const IDLE_SPIN = 0.08; // radians per second
const SEARCH_SPIN = 2.4; // while a search runs
const SPIN_EASE = 2.5; // how quickly the spin speed follows (per second)
const FOV = 35;
const ATMOSPHERE_SCALE = 1.16;

/**
 * Rotating, lit cartoon Earth (every country painted with its flag) in a starfield. The canvas
 * fills its parent; the globe is framed to sit wholly inside `slotRef`'s box, glow included.
 * While `spinning`, the globe winds up to a fast spin. Calls `onUnsupported` without WebGL.
 */
export function EarthScene({
  spinning,
  slotRef,
  onUnsupported,
}: {
  spinning: boolean;
  slotRef: RefObject<HTMLElement | null>;
  onUnsupported: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const spinningRef = useRef(spinning);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    spinningRef.current = spinning;
  }, [spinning]);

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
    const camera = new PerspectiveCamera(FOV, 1, 0.01, 400);

    // Earth, tilted on its axis, at the origin.
    const tiltGroup = new Group();
    tiltGroup.rotation.z = EARTH_TILT;
    scene.add(tiltGroup);

    const earthGeometry = new SphereGeometry(1, 128, 128);
    const earthMaterial = new MeshStandardMaterial({ color: 0x8fd6f5, roughness: 0.85, metalness: 0 });
    const earth = new Mesh(earthGeometry, earthMaterial);
    earth.rotation.y = -1.9; // open on the Atlantic, Europe and Africa
    tiltGroup.add(earth);

    // Paint every country's flag, then reveal the globe (a plain blue ball if painting fails).
    let disposed = false;
    let flagTexture: CanvasTexture | null = null;
    paintFlagTexture(Math.min(4096, renderer.capabilities.maxTextureSize))
      .then((canvas) => {
        if (disposed) return;
        flagTexture = new CanvasTexture(canvas);
        flagTexture.colorSpace = SRGBColorSpace;
        flagTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        earthMaterial.map = flagTexture;
        earthMaterial.color.set(0xffffff);
        earthMaterial.needsUpdate = true;
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setReady(true);
      });

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
          gl_FragColor = vec4(0.55, 0.85, 1.0, 1.0) * intensity;
        }`,
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmosphere = new Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphere.scale.setScalar(ATMOSPHERE_SCALE);
    scene.add(atmosphere);

    // Soft, mostly flat lighting suits the cartoon globe: a gentle terminator, never a dark side.
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(-5, 2.5, 4);
    scene.add(sun);
    scene.add(new AmbientLight(0xdde6f5, 3.2));

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

    // Frame the globe inside the slot: pick the camera distance that gives the right on-screen
    // radius, then shift the view so the globe's centre lands on the slot's centre.
    const frame = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;

      const mountBox = mount.getBoundingClientRect();
      const slotBox = slotRef.current?.getBoundingClientRect();
      const cx = slotBox ? slotBox.left + slotBox.width / 2 - mountBox.left : w / 2;
      const cy = slotBox ? slotBox.top + slotBox.height / 2 - mountBox.top : h / 2;
      const slotSize = slotBox ? Math.min(slotBox.width, slotBox.height) : Math.min(w, h) * 0.7;
      const radiusPx = Math.max(40, slotSize / 2 / (ATMOSPHERE_SCALE + 0.06));

      // A unit sphere at distance d spans 1/√(d²−1) in tangent space; solve for d.
      const k = h / 2 / (radiusPx * Math.tan(((FOV / 2) * Math.PI) / 180));
      camera.position.set(0, 0, Math.sqrt(k * k + 1));
      camera.lookAt(0, 0, 0);
      camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
      camera.updateProjectionMatrix();
    };
    frame();
    const resizeObserver = new ResizeObserver(frame);
    resizeObserver.observe(mount);
    if (slotRef.current) resizeObserver.observe(slotRef.current);

    let raf = 0;
    let last = performance.now();
    let speed = IDLE_SPIN;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const target = spinningRef.current ? SEARCH_SPIN : IDLE_SPIN;
      speed += (target - speed) * Math.min(1, dt * SPIN_EASE);
      earth.rotation.y += speed * dt;
      stars.rotation.y += IDLE_SPIN * 0.08 * dt;
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
      flagTexture?.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onUnsupported, slotRef]);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="absolute inset-0 transition-opacity duration-700"
      style={{ opacity: ready ? 1 : 0 }}
    />
  );
}
