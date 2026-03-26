"use client";
import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { FileNode, GraphData } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";

interface Props {
  data: GraphData;
  onNodeClick: (node: FileNode) => void;
  highlightIds?: Set<string>;
}

// ── 6 clean topic colors ─────────────────────────────────────────────────────
const TOPIC_PALETTE = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#10b981", // emerald
  "#8b5cf6", // violet
];

const TYPE_TO_TOPIC: Record<string, string> = {
  image:  "Visuals",
  video:  "Media",
  audio:  "Audio",
  code:   "Code",
  text:   "Documents",
  pdf:    "Research",
  folder: "Projects",
  other:  "Files",
};

function getTopicLabel(nodes: FileNode[]): string {
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return TYPE_TO_TOPIC[dominant ?? "other"] ?? "Files";
}

function getCommunityColor(communityId: number | undefined, fileType: string): string {
  if (communityId !== undefined && communityId !== null) {
    return TOPIC_PALETTE[communityId % TOPIC_PALETTE.length];
  }
  return FILE_TYPE_COLORS[fileType as keyof typeof FILE_TYPE_COLORS] ?? "#64748b";
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type LabelItem = { id: string; x: number; y: number; label: string; color: string; isTopic: boolean };

export default function Graph3D({ data, onNodeClick, highlightIds }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>();
  const hasZoomed = useRef(false);
  const [hovered, setHovered] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [labelItems, setLabelItems] = useState<LabelItem[]>([]);
  const [dimensions, setDimensions] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    hasZoomed.current = false;
  }, [data]);

  // Community → nodes
  const communities = useMemo(() => {
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

  // Community → deduplicated topic label
  const topicLabels = useMemo(() => {
    const entries = Array.from(communities.entries())
      .sort((a, b) => b[1].length - a[1].length);
    const labelCount: Record<string, number> = {};
    for (const [, nodes] of entries) {
      const base = getTopicLabel(nodes);
      labelCount[base] = (labelCount[base] ?? 0) + 1;
    }
    const labelSeen: Record<string, number> = {};
    const result = new Map<number, string>();
    for (const [cId, nodes] of entries) {
      const base = getTopicLabel(nodes);
      labelSeen[base] = (labelSeen[base] ?? 0) + 1;
      result.set(cId, labelCount[base] > 1 ? `${base} ${labelSeen[base]}` : base);
    }
    return result;
  }, [communities]);

  // Community → highest-degree node id
  const communityCenters = useMemo(() => {
    const centers = new Map<number, string>();
    Array.from(communities.entries()).forEach(([cId, nodes]) => {
      const top = nodes.reduce((a: FileNode, b: FileNode) =>
        ((a.degree ?? 0) >= (b.degree ?? 0) ? a : b)
      );
      centers.set(cId, top.id);
    });
    return centers;
  }, [communities]);

  // Fallback when no community data: group by file type, label the hub of each type
  const fileTypeCenters = useMemo(() => {
    if (communities.size > 0) return new Map<string, string>();
    const groups = new Map<string, FileNode[]>();
    for (const n of data.nodes) {
      const fn = n as FileNode;
      if (!groups.has(fn.type)) groups.set(fn.type, []);
      groups.get(fn.type)!.push(fn);
    }
    const centers = new Map<string, string>(); // fileType → nodeId
    groups.forEach((nodes, type) => {
      const top = nodes.reduce((a: FileNode, b: FileNode) =>
        ((a.degree ?? 0) >= (b.degree ?? 0) ? a : b)
      );
      if ((top.degree ?? 0) > 0) centers.set(type, top.id);
    });
    return centers;
  }, [communities.size, data.nodes]);

  // nodeId → topic label string (covers both community and file-type modes)
  const nodeLabelMap = useMemo(() => {
    const map = new Map<string, { label: string; isTopic: boolean }>();
    // Community mode
    communityCenters.forEach((nodeId, cId) => {
      map.set(nodeId, { label: topicLabels.get(cId) ?? `Topic ${cId}`, isTopic: true });
    });
    // Fallback file-type mode
    fileTypeCenters.forEach((nodeId, type) => {
      if (!map.has(nodeId))
        map.set(nodeId, { label: TYPE_TO_TOPIC[type] ?? type, isTopic: true });
    });
    return map;
  }, [communityCenters, fileTypeCenters, topicLabels]);

  // Nodes to label: all topic centers + top 15 connected nodes by val
  const labelNodeIds = useMemo(() => {
    const ids = new Set<string>(nodeLabelMap.keys());
    [...data.nodes]
      .sort((a, b) => ((b as FileNode).val ?? 0) - ((a as FileNode).val ?? 0))
      .slice(0, 15)
      .forEach((n) => ids.add((n as FileNode).id));
    return ids;
  }, [nodeLabelMap, data.nodes]);

  // HTML label overlay — updates every animation frame using graph→screen coords
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      if (!fgRef.current) { rafId = requestAnimationFrame(tick); return; }
      const items: LabelItem[] = [];
      for (const rawNode of data.nodes) {
        const n = rawNode as FileNode & { x?: number; y?: number };
        if (!labelNodeIds.has(n.id) || n.x === undefined || n.y === undefined) continue;
        const screen = fgRef.current.graph2ScreenCoords(n.x, n.y);
        const topicEntry = nodeLabelMap.get(n.id);
        const isTopic = topicEntry?.isTopic ?? false;
        const label = topicEntry
          ? topicEntry.label
          : (n.name.length > 22 ? n.name.slice(0, 20) + "…" : n.name);
        items.push({ id: n.id, x: screen.x, y: screen.y, label, color: getCommunityColor(n.community, n.type), isTopic });
      }
      setLabelItems(items);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [data.nodes, labelNodeIds, nodeLabelMap]);

  // 2D canvas node rendering — no text, just geometry
  const nodeCanvasObject = useCallback(
    (rawNode: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as FileNode & { x: number; y: number };
      const color = getCommunityColor(node.community, node.type);
      const radius = Math.max(3, (node.val ?? 3) * 1.4);
      const highlighted = highlightIds?.has(node.id);
      const highDegree = (node.degree ?? 0) > 3;

      // Soft glow
      if (highlighted || highDegree) {
        const glowRadius = radius * (highlighted ? 4 : 3);
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
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

      // Inner dot for indexed nodes
      if (node.indexed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 0.35, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
      }
    },
    [highlightIds]
  );

  // Link color
  const linkColor = useCallback(
    (link: object) => {
      const l = link as { value?: number; source?: unknown; target?: unknown };
      const score = l.value ?? 0.75;
      const alpha = 0.2 + score * 0.5;
      const srcId = typeof l.source === "string" ? l.source : (l.source as FileNode)?.id;
      const srcNode = data.nodes.find((n) => n.id === srcId) as FileNode | undefined;
      if (srcNode?.community !== undefined) {
        const c = TOPIC_PALETTE[srcNode.community % TOPIC_PALETTE.length];
        return hexToRgba(c, alpha);
      }
      return hexToRgba("#6366f1", 0.22 + score * 0.3);
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
        onEngineStop={() => {
          if (!hasZoomed.current) {
            hasZoomed.current = true;
            fgRef.current?.zoomToFit(600, 48);
          }
        }}
      />

      {/* ── HTML label overlay — always crisp, tracks node positions ── */}
      {labelItems.map((item) => (
        <div
          key={item.id}
          style={{
            position: "fixed",
            left: item.x,
            top: item.y + (item.isTopic ? 10 : 7),
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 20,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-outfit)",
            fontWeight: item.isTopic ? 700 : 500,
            fontSize: item.isTopic ? 12 : 10,
            color: item.isTopic ? item.color : "rgba(255,255,255,0.7)",
            textShadow: "0 1px 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9)",
            letterSpacing: item.isTopic ? "0.02em" : "0",
          }}
        >
          {item.label}
        </div>
      ))}

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            background: "rgba(13,15,20,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 100,
            maxWidth: 280,
            backdropFilter: "blur(16px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: getCommunityColor(hovered.community, hovered.type),
                flexShrink: 0,
                boxShadow: `0 0 6px ${getCommunityColor(hovered.community, hovered.type)}80`,
              }}
            />
            <span style={{ color: "#94a3b8", fontSize: 10, fontFamily: "var(--font-space-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {hovered.community !== undefined
                ? topicLabels.get(hovered.community) ?? hovered.type
                : hovered.type}
              {hovered.degree ? ` · ${hovered.degree} link${hovered.degree !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div style={{ color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-outfit)", fontWeight: 500 }}>
            {hovered.name}
          </div>
        </div>
      )}

      {/* Topic legend — bottom left */}
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
            background: "rgba(13,15,20,0.88)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            backdropFilter: "blur(16px)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: "var(--font-space-mono)", letterSpacing: "0.12em", marginBottom: 4, textTransform: "uppercase" }}>
            topics
          </div>
          {Array.from(communities.entries())
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 8)
            .map(([cId, nodes]) => {
              const color = TOPIC_PALETTE[cId % TOPIC_PALETTE.length];
              const label = topicLabels.get(cId) ?? `Topic ${cId}`;
              return (
                <div key={cId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}60` }} />
                  <span style={{ fontSize: 11, color: "#e2e8f0", fontFamily: "var(--font-outfit)", fontWeight: 500 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto", fontFamily: "var(--font-space-mono)", paddingLeft: 12 }}>
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
