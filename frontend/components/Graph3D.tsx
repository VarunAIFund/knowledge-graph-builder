"use client";
import { useRef, useEffect, useCallback, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import type { FileNode, GraphData } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";

interface Props {
  data: GraphData;
  onNodeClick: (node: FileNode) => void;
  highlightIds?: Set<string>;
}

function makeGlowTexture(color: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color + "ff");
  gradient.addColorStop(0.3, color + "88");
  gradient.addColorStop(1, color + "00");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Cache textures per color
const textureCache = new Map<string, THREE.Texture>();
function getCachedTexture(color: string): THREE.Texture {
  if (!textureCache.has(color)) textureCache.set(color, makeGlowTexture(color));
  return textureCache.get(color)!;
}

export default function Graph3D({ data, onNodeClick, highlightIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>();
  const [hovered, setHovered] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Initial camera + lighting setup
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.cameraPosition({ z: 380, y: 30 });

    const scene = fg.scene() as THREE.Scene;

    const ambient = new THREE.AmbientLight(0x0a1a2e, 4);
    scene.add(ambient);

    const point1 = new THREE.PointLight(0x00d4ff, 2, 800);
    point1.position.set(200, 200, 200);
    scene.add(point1);

    const point2 = new THREE.PointLight(0xff0080, 1.5, 600);
    point2.position.set(-200, -100, 100);
    scene.add(point2);
  }, []);

  // Slow camera auto-rotation
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let angle = 0;
    let running = true;
    const R = 380;
    const Y = 30;
    const tick = () => {
      if (!running) return;
      angle += 0.0008;
      fg.cameraPosition({
        x: R * Math.sin(angle),
        z: R * Math.cos(angle),
        y: Y,
      });
      requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(id); };
  }, []);

  const nodeThreeObject = useCallback(
    (rawNode: object) => {
      const node = rawNode as FileNode;
      const color = FILE_TYPE_COLORS[node.type] ?? "#64748B";
      const colorHex = parseInt(color.replace("#", ""), 16);
      const radius = node.val ?? 3;
      const highlighted = highlightIds?.has(node.id);

      const group = new THREE.Group();

      // Core sphere
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 20),
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: colorHex,
          emissiveIntensity: highlighted ? 1.2 : 0.55,
          metalness: 0.6,
          roughness: 0.15,
        })
      );
      group.add(sphere);

      // Glow halo sprite
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getCachedTexture(color),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const glowSize = radius * (highlighted ? 7 : 5);
      sprite.scale.set(glowSize, glowSize, 1);
      group.add(sprite);

      // Pulse ring for highlighted nodes
      if (highlighted) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 1.8, 0.3, 8, 32),
          new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.6,
          })
        );
        group.add(ring);
      }

      return group;
    },
    [highlightIds]
  );

  const handleNodeHover = useCallback(
    (rawNode: object | null, _prev: object | null, event?: MouseEvent) => {
      setHovered(rawNode ? (rawNode as FileNode) : null);
      if (event) setTooltipPos({ x: event.clientX + 14, y: event.clientY - 10 });
      document.body.style.cursor = rawNode ? "pointer" : "default";
    },
    []
  );

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setTooltipPos({ x: e.clientX + 14, y: e.clientY - 10 });
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  return (
    <>
      <ForceGraph3D
        ref={fgRef}
        graphData={data as { nodes: object[]; links: object[] }}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={(link: object) => {
          const l = link as { value: number };
          const alpha = Math.round((l.value ?? 0.5) * 180).toString(16).padStart(2, "0");
          return `#00D4FF${alpha}`;
        }}
        linkWidth={(link: object) => ((link as { value: number }).value ?? 0.5) * 1.5}
        linkOpacity={0.6}
        linkDirectionalParticles={3}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={0.8}
        linkDirectionalParticleColor={() => "#00D4FF"}
        backgroundColor="rgba(0,0,0,0)"
        showNavInfo={false}
        onNodeClick={(rawNode: object) => onNodeClick(rawNode as FileNode)}
        onNodeHover={handleNodeHover as (node: object | null, prev: object | null) => void}
        nodeLabel={() => ""}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        width={typeof window !== "undefined" ? window.innerWidth : 1200}
        height={typeof window !== "undefined" ? window.innerHeight : 800}
      />

      {/* Tooltip */}
      {hovered && (
        <div
          className="node-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div style={{ color: FILE_TYPE_COLORS[hovered.type], marginBottom: 2, fontSize: 9, letterSpacing: "0.1em", fontFamily: "var(--font-orbitron)" }}>
            {hovered.type.toUpperCase()}
          </div>
          <div style={{ color: "#E0F2FE", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
            {hovered.name}
          </div>
        </div>
      )}
    </>
  );
}
