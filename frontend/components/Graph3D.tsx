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

// ── Community palette — 20 distinct hues that look good on dark backgrounds ──
const COMMUNITY_PALETTE = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ef4444", // red
  "#f97316", // orange
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#22d3ee", // sky
  "#fb7185", // rose
  "#fbbf24", // yellow
  "#4ade80", // green
  "#60a5fa", // light blue
  "#c084fc", // light purple
  "#34d399", // light emerald
  "#f472b6", // light pink
];

function getCommunityColor(communityId: number | undefined, fileType: string): string {
  if (communityId !== undefined && communityId !== null) {
    return COMMUNITY_PALETTE[communityId % COMMUNITY_PALETTE.length];
  }
  return FILE_TYPE_COLORS[fileType as keyof typeof FILE_TYPE_COLORS] ?? "#64748b";
}

// ── Glow texture cache ────────────────────────────────────────────────────────
const textureCache = new Map<string, THREE.Texture>();

function makeGlowTexture(color: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,   color + "ff");
  g.addColorStop(0.25, color + "cc");
  g.addColorStop(0.6,  color + "44");
  g.addColorStop(1,    color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function getTexture(color: string): THREE.Texture {
  if (!textureCache.has(color)) textureCache.set(color, makeGlowTexture(color));
  return textureCache.get(color)!;
}

// ── Cluster shell geometry cache ──────────────────────────────────────────────
const shellCache = new Map<string, THREE.Mesh>();

export default function Graph3D({ data, onNodeClick, highlightIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>();
  const [hovered, setHovered] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Compute community membership for cluster shell rendering
  const communityNodes = useCallback(() => {
    const map = new Map<number, FileNode[]>();
    for (const node of data.nodes) {
      const n = node as FileNode;
      if (n.community !== undefined && n.community !== null) {
        const c = n.community;
        if (!map.has(c)) map.set(c, []);
        map.get(c)!.push(n);
      }
    }
    return map;
  }, [data.nodes]);

  // Scene setup
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ z: 400, y: 40 });

    const scene = fg.scene() as THREE.Scene;

    // Remove old lights
    const toRemove = scene.children.filter(
      (c) => c instanceof THREE.AmbientLight || c instanceof THREE.PointLight
    );
    toRemove.forEach((c) => scene.remove(c));

    scene.add(new THREE.AmbientLight(0x0a0a18, 3));

    const p1 = new THREE.PointLight(0x6366f1, 2.5, 900);
    p1.position.set(250, 250, 200);
    scene.add(p1);

    const p2 = new THREE.PointLight(0x8b5cf6, 1.8, 700);
    p2.position.set(-250, -150, 150);
    scene.add(p2);

    const p3 = new THREE.PointLight(0x14b8a6, 1.2, 500);
    p3.position.set(0, -300, -200);
    scene.add(p3);
  }, []);

  // Camera auto-rotation
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let angle  = 0;
    let tilt   = 0;
    let running = true;
    const R = 400, Y = 40;
    const tick = () => {
      if (!running) return;
      angle += 0.0007;
      tilt   = Math.sin(angle * 0.3) * 30;
      fg.cameraPosition({ x: R * Math.sin(angle), z: R * Math.cos(angle), y: Y + tilt });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; };
  }, []);

  const nodeThreeObject = useCallback(
    (rawNode: object) => {
      const node       = rawNode as FileNode;
      const community  = node.community;
      const color      = getCommunityColor(community, node.type);
      const colorHex   = parseInt(color.replace("#", ""), 16);
      const highlighted = highlightIds?.has(node.id);
      const radius      = node.val ?? 3;
      const group       = new THREE.Group();

      // Core sphere — slightly different material based on indexed status
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        new THREE.MeshStandardMaterial({
          color:            colorHex,
          emissive:         colorHex,
          emissiveIntensity: highlighted ? 1.4 : node.indexed ? 0.7 : 0.35,
          metalness:        0.5,
          roughness:        node.indexed ? 0.1 : 0.4,
        })
      );
      group.add(sphere);

      // Glow halo — larger for highly-connected nodes
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map:         getTexture(color),
          transparent: true,
          blending:    THREE.AdditiveBlending,
          depthWrite:  false,
          opacity:     highlighted ? 0.9 : 0.65,
        })
      );
      const glowMult = highlighted ? 8 : (node.degree ?? 0) > 3 ? 7 : 5;
      sprite.scale.set(radius * glowMult, radius * glowMult, 1);
      group.add(sprite);

      // Highlight ring for search results
      if (highlighted) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 2, 0.35, 8, 40),
          new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.7 })
        );
        group.add(ring);

        // Second outer ring for extra pop
        const ring2 = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 2.8, 0.2, 8, 40),
          new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.35 })
        );
        group.add(ring2);
      }

      return group;
    },
    [highlightIds]
  );

  // Link color — gradient from muted (low similarity) to vivid (high similarity)
  const linkColor = useCallback((link: object) => {
    const l     = link as { value?: number; source?: unknown; target?: unknown };
    const score = l.value ?? 0.75;
    // Interpolate: low similarity → slate-700, high → indigo-400
    const alpha = Math.round(60 + score * 160).toString(16).padStart(2, "0");
    // Pick hue from community if available — else use indigo
    const srcId = typeof l.source === "string" ? l.source : (l.source as FileNode)?.id;
    const srcNode = data.nodes.find((n) => n.id === srcId) as FileNode | undefined;
    if (srcNode?.community !== undefined) {
      const c = COMMUNITY_PALETTE[srcNode.community % COMMUNITY_PALETTE.length];
      return c + alpha;
    }
    return `#818cf8${alpha}`; // indigo-400
  }, [data.nodes]);

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

  const communities = communityNodes();

  return (
    <>
      <ForceGraph3D
        ref={fgRef}
        graphData={data as { nodes: object[]; links: object[] }}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={(link: object) => {
          const l = link as { value?: number };
          return 0.4 + (l.value ?? 0.75) * 1.2;
        }}
        linkOpacity={0.5}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={(link: object) => {
          const l = link as { value?: number };
          return 0.002 + (l.value ?? 0.75) * 0.006;
        }}
        linkDirectionalParticleWidth={1.0}
        linkDirectionalParticleColor={linkColor}
        backgroundColor="rgba(0,0,0,0)"
        showNavInfo={false}
        onNodeClick={(rawNode: object) => onNodeClick(rawNode as FileNode)}
        onNodeHover={handleNodeHover as (node: object | null, prev: object | null) => void}
        nodeLabel={() => ""}
        cooldownTicks={150}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
        width={typeof window !== "undefined" ? window.innerWidth : 1200}
        height={typeof window !== "undefined" ? window.innerHeight : 800}
      />

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            background: "rgba(9,9,11,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 100,
            maxWidth: 280,
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: getCommunityColor(hovered.community, hovered.type),
                flexShrink: 0,
                boxShadow: `0 0 6px ${getCommunityColor(hovered.community, hovered.type)}`,
              }}
            />
            <span style={{ color: "#94a3b8", fontSize: 10, fontFamily: "var(--font-space-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {hovered.type}
              {hovered.community !== undefined ? ` · cluster ${hovered.community}` : ""}
              {hovered.degree ? ` · ${hovered.degree} link${hovered.degree !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div style={{ color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-outfit)" }}>
            {hovered.name}
          </div>
        </div>
      )}

      {/* Community legend — bottom left, only when communities exist */}
      {communities.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 16,
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 14px",
            background: "rgba(9,9,11,0.7)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 10,
            backdropFilter: "blur(12px)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 9, color: "#475569", fontFamily: "var(--font-space-mono)", letterSpacing: "0.12em", marginBottom: 4, textTransform: "uppercase" }}>
            {communities.size} clusters
          </div>
          {Array.from(communities.entries())
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 12)
            .map(([cId, nodes]) => {
              const color = COMMUNITY_PALETTE[cId % COMMUNITY_PALETTE.length];
              const topNode = nodes.sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))[0];
              return (
                <div key={cId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: color,
                      boxShadow: `0 0 5px ${color}`,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "var(--font-outfit)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {topNode?.name ?? `Cluster ${cId}`}
                  </span>
                  <span style={{ fontSize: 10, color: color, marginLeft: "auto", fontFamily: "var(--font-space-mono)" }}>
                    {nodes.length}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </>
  );
}
