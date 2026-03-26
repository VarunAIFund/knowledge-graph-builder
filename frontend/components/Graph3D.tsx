"use client";
import { useRef, useEffect, useCallback, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { FileNode, GraphData } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";

interface Props {
  data: GraphData;
  onNodeClick: (node: FileNode) => void;
  highlightIds?: Set<string>;
}

// ── Community palette — 20 distinct hues ────────────────────────────────────
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

// ── Hex color to rgba ────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function Graph3D({ data, onNodeClick, highlightIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>();
  const [hovered, setHovered] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  // Track window size
  useEffect(() => {
    const onResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Compute community membership for legend
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

  // 2D canvas node rendering
  const nodeCanvasObject = useCallback(
    (rawNode: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as FileNode & { x: number; y: number };
      const color = getCommunityColor(node.community, node.type);
      const radius = Math.max(4, (node.val ?? 3) * 1.4);
      const highlighted = highlightIds?.has(node.id);
      const highDegree = (node.degree ?? 0) > 3;

      // Soft glow for highlighted or high-degree nodes
      if (highlighted || highDegree) {
        const glowRadius = radius * (highlighted ? 4 : 3);
        const gradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius
        );
        gradient.addColorStop(0, hexToRgba(color, highlighted ? 0.35 : 0.2));
        gradient.addColorStop(1, hexToRgba(color, 0));
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Highlight ring
      if (highlighted) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Core circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Inner white dot for indexed nodes (like Neo4j Bloom style)
      if (node.indexed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 0.35, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
      }

      // Label at higher zoom levels
      if (globalScale > 2) {
        const fontSize = Math.min(4, 10 / globalScale);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = "#1e293b";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = node.name.length > 18 ? node.name.slice(0, 16) + "…" : node.name;
        ctx.fillText(label, node.x, node.y + radius + 1.5);
      }
    },
    [highlightIds]
  );

  // Link color — light-background friendly
  const linkColor = useCallback(
    (link: object) => {
      const l = link as { value?: number; source?: unknown; target?: unknown };
      const score = l.value ?? 0.75;
      const alpha = 0.15 + score * 0.45;
      const srcId = typeof l.source === "string" ? l.source : (l.source as FileNode)?.id;
      const srcNode = data.nodes.find((n) => n.id === srcId) as FileNode | undefined;
      if (srcNode?.community !== undefined) {
        const c = COMMUNITY_PALETTE[srcNode.community % COMMUNITY_PALETTE.length];
        return hexToRgba(c, alpha);
      }
      // Default: slate-400 → indigo based on score
      return hexToRgba("#94a3b8", alpha + 0.1);
    },
    [data.nodes]
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

  const communities = communityNodes();

  return (
    <>
      <ForceGraph2D
        ref={fgRef}
        graphData={data as { nodes: object[]; links: object[] }}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkColor={linkColor}
        linkWidth={(link: object) => {
          const l = link as { value?: number };
          return 0.5 + (l.value ?? 0.75) * 1.5;
        }}

        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={(link: object) => {
          const l = link as { value?: number };
          return 0.002 + (l.value ?? 0.75) * 0.006;
        }}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={linkColor}
        backgroundColor="rgba(0,0,0,0)"

        onNodeClick={(rawNode: object) => onNodeClick(rawNode as FileNode)}
        onNodeHover={handleNodeHover as (node: object | null, prev: object | null) => void}
        nodeLabel={() => ""}
        cooldownTicks={150}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
        width={dimensions.width}
        height={dimensions.height - 56}
      />

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            background: "rgba(255,255,255,0.96)",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 100,
            maxWidth: 280,
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: getCommunityColor(hovered.community, hovered.type),
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#64748b", fontSize: 10, fontFamily: "var(--font-space-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {hovered.type}
              {hovered.community !== undefined ? ` · cluster ${hovered.community}` : ""}
              {hovered.degree ? ` · ${hovered.degree} link${hovered.degree !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div style={{ color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-outfit)", fontWeight: 500 }}>
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
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 10,
            backdropFilter: "blur(12px)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 9, color: "#94a3b8", fontFamily: "var(--font-space-mono)", letterSpacing: "0.12em", marginBottom: 4, textTransform: "uppercase" }}>
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
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#475569", fontFamily: "var(--font-outfit)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {topNode?.name ?? `Cluster ${cId}`}
                  </span>
                  <span style={{ fontSize: 10, color, marginLeft: "auto", fontFamily: "var(--font-space-mono)" }}>
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
