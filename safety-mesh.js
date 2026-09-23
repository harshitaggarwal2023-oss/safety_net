"use strict";

/**
 * Safety Net — Interactive 3D Particle & Protective Mesh Visualizer
 * Built with Three.js (with lightweight Canvas2D fallback).
 * Renders an ambient cyber-mesh representing safety defense nodes across India.
 */

(function initSafetyMesh() {
  if (typeof window === "undefined") return;

  // Create canvas container
  const canvas = document.createElement("canvas");
  canvas.id = "safety-mesh-canvas";
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "-1";
  canvas.style.opacity = "0.32";
  document.body.prepend(canvas);

  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;

  window.addEventListener("pointermove", (e) => {
    mouseX = (e.clientX - window.innerWidth / 2) * 0.05;
    mouseY = (e.clientY - window.innerHeight / 2) * 0.05;
  }, { passive: true });

  // Check if Three.js is available
  if (window.THREE) {
    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
      camera.position.z = 240;

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      // Particle Geometry
      const particleCount = 75;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const velocities = [];

      for (let i = 0; i < particleCount; i++) {
        const x = (Math.random() - 0.5) * 400;
        const y = (Math.random() - 0.5) * 300;
        const z = (Math.random() - 0.5) * 200;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        velocities.push({
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          vz: (Math.random() - 0.5) * 0.15,
        });
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      // Points material
      const pMaterial = new THREE.PointsMaterial({
        color: 0x0ea5a4,
        size: 3.5,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });

      const pointCloud = new THREE.Points(geometry, pMaterial);
      scene.add(pointCloud);

      // Line mesh for connected nodes
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
      });

      const lineGeometry = new THREE.BufferGeometry();
      const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(lineMesh);

      function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
      window.addEventListener("resize", onResize, { passive: true });

      let animationId;
      function animate() {
        animationId = requestAnimationFrame(animate);

        // Smooth camera drift toward mouse
        targetX += (mouseX - targetX) * 0.05;
        targetY += (mouseY - targetY) * 0.05;
        camera.position.x = targetX;
        camera.position.y = -targetY;
        camera.lookAt(scene.position);

        const pos = geometry.attributes.position.array;
        const linePositions = [];

        for (let i = 0; i < particleCount; i++) {
          pos[i * 3] += velocities[i].vx;
          pos[i * 3 + 1] += velocities[i].vy;
          pos[i * 3 + 2] += velocities[i].vz;

          // Bounce boundaries
          if (Math.abs(pos[i * 3]) > 220) velocities[i].vx *= -1;
          if (Math.abs(pos[i * 3 + 1]) > 170) velocities[i].vy *= -1;
          if (Math.abs(pos[i * 3 + 2]) > 120) velocities[i].vz *= -1;

          // Check proximity for connection lines
          for (let j = i + 1; j < particleCount; j++) {
            const dx = pos[i * 3] - pos[j * 3];
            const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
            const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq < 5200) {
              linePositions.push(
                pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
                pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]
              );
            }
          }
        }

        geometry.attributes.position.needsUpdate = true;
        lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));

        pointCloud.rotation.y += 0.0008;
        lineMesh.rotation.y += 0.0008;

        renderer.render(scene, camera);
      }
      animate();
      return;
    } catch (e) {
      console.warn("Safety Net: Three.js initialization failed, falling back to 2D Canvas.", e);
    }
  }

  // --- Fallback Canvas2D Ambient Constellation ---
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }, { passive: true });

  const points = [];
  const count = Math.min(Math.floor((width * height) / 22000), 55);

  for (let i = 0; i < count; i++) {
    points.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 2 + 1.2,
    });
  }

  function draw2D() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(14, 165, 164, 0.7)";
      ctx.fill();

      for (let j = i + 1; j < points.length; j++) {
        const p2 = points[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.2 * (1 - dist / 110)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw2D);
  }
  draw2D();
})();
