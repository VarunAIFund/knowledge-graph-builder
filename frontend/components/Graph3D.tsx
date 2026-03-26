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
  // Use the most common top-level Desktop subfolder as the label
  const segCounts: Record<string, number> = {};
  for (const n of nodes) {
    const parts = (n.path ?? "").split("/").filter(Boolean);
    const desktopIdx = parts.indexOf("Desktop");
    const seg = desktopIdx >= 0 && parts[desktopIdx + 1]
      ? parts[desktopIdx + 1]
      : parts[parts.length - 2];
    if (seg) segCounts[seg] = (segCounts[seg] ?? 0) + 1;
  }
  const dominant = Object.entries(segCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant) return dominant;
  // Fallback to file type
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  const domType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return TYPE_TO_TOPIC[domType ?? "other"] ?? "Files";
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
  const [aiLabels, setAiLabels] = useState<Map<number, string>>(new Map());
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

  // Fetch AI-generated cluster labels from Gemini when communities load
  useEffect(() => {
    if (communities.size === 0) return;
    const payload: Record<string, { name: string; preview?: string; type: string }[]> = {};
    communities.forEach((nodes, cId) => {
      payload[String(cId)] = nodes.map(n => ({ name: n.name, preview: n.preview, type: n.type }));
    });
    fetch("/api/cluster-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communities: payload }),
    })
      .then(r => r.json())
      .then(({ labels }) => {
        const map = new Map<number, string>();
        for (const [k, v] of Object.entries(labels as Record<string, string>)) {
          map.set(Number(k), v);
        }
        setAiLabels(map);
      })
      .catch(() => {});
  }, [communities]);

  // Community → AI-generated label only
  const topicLabels = useMemo(() => aiLabels, [aiLabels]);

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
      if ((highlighted || highDegree) && isFinite(node.x) && isFinite(node.y)) {
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

  // Link color — higher alpha floor for light-mode readability
  const linkColor = useCallback(
    (link: object) => {
      const l = link as { value?: number; source?: unknown; target?: unknown };
      const score = l.value ?? 0.75;
      const alpha = 0.35 + score * 0.45;
      const srcId = typeof l.source === "string" ? l.source : (l.source as FileNode)?.id;
      const srcNode = data.nodes.find((n) => n.id === srcId) as FileNode | undefined;
      if (srcNode?.community !== undefined) {
        const c = TOPIC_PALETTE[srcNode.community % TOPIC_PALETTE.length];
        return hexToRgba(c, alpha);
      }
      return hexToRgba("#6366f1", 0.38 + score * 0.35);
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
            color: item.isTopic ? item.color : "rgba(28,28,30,0.65)",
            textShadow: "0 1px 3px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.8)",
            letterSpacing: item.isTopic ? "0.02em" : "0",
          }}
        >
          {item.label}
        </div>
      ))}

      {/* Tooltip — liquid glass */}
      {hovered && (
        <div
          style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            pointerEvents: "none",
            zIndex: 100,
            maxWidth: 260,
          }}
        >
          {/* Apple glass tooltip */}
          <div
            style={{
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              background: "rgba(255, 255, 255, 0.82)",
              border: "1px solid rgba(255, 255, 255, 0.85)",
              borderRadius: 12,
              padding: "9px 13px",
              boxShadow: [
                "inset 0 1.5px 0 rgba(255,255,255,1)",
                "inset 0 -1px 0 rgba(0,0,0,0.04)",
                "0 0 0 0.5px rgba(0,0,0,0.1)",
                "0 8px 24px rgba(60,60,120,0.16)",
                "0 2px 6px rgba(60,60,120,0.08)",
              ].join(", "),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: getCommunityColor(hovered.community, hovered.type),
                  boxShadow: `0 0 6px ${getCommunityColor(hovered.community, hovered.type)}70`,
                }}
              />
              <span
                style={{
                  color: "rgba(110,110,115,0.9)",
                  fontSize: 9,
                  fontFamily: "var(--font-space-mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontWeight: 600,
                }}
              >
                {hovered.community !== undefined
                  ? topicLabels.get(hovered.community) ?? hovered.type
                  : hovered.type}
                {hovered.degree ? ` · ${hovered.degree}` : ""}
              </span>
            </div>
            <div
              style={{
                color: "#1c1c1e",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-outfit)",
                fontWeight: 500,
                fontSize: 13,
                letterSpacing: "-0.01em",
              }}
            >
              {hovered.name}
            </div>
          </div>
        </div>
      )}

      {/* Topic legend — liquid glass, bottom left */}
      {communities.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 16,
            zIndex: 30,
          }}
        >
          <div
            style={{
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              background: "rgba(255, 255, 255, 0.78)",
              border: "1px solid rgba(255,255,255,0.88)",
              borderRadius: 14,
              padding: "11px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 5,
              boxShadow: [
                "inset 0 1.5px 0 rgba(255,255,255,1)",
                "inset 0 -1px 0 rgba(0,0,0,0.04)",
                "0 0 0 0.5px rgba(0,0,0,0.1)",
                "0 8px 32px rgba(60,60,120,0.14)",
                "0 2px 8px rgba(60,60,120,0.08)",
              ].join(", "),
            }}
          >
            <div
              style={{
                fontSize: 8,
                color: "rgba(110,110,115,0.7)",
                fontFamily: "var(--font-space-mono)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 3,
                fontWeight: 700,
              }}
            >
              clusters
            </div>
            {Array.from(communities.entries())
              .sort((a, b) => b[1].length - a[1].length)
              .slice(0, 8)
              .map(([cId, nodes]) => {
                const color = TOPIC_PALETTE[cId % TOPIC_PALETTE.length];
                const label = topicLabels.get(cId) ?? `Topic ${cId}`;
                return (
                  <div key={cId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: color, flexShrink: 0,
                        boxShadow: `0 0 6px ${color}80`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: "#1c1c1e",
                        fontFamily: "var(--font-outfit)",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(110,110,115,0.7)",
                        marginLeft: "auto",
                        fontFamily: "var(--font-space-mono)",
                        paddingLeft: 12,
                        fontWeight: 500,
                      }}
                    >
                      {nodes.length}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </>
  );
}
