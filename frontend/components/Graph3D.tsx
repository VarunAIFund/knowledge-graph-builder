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

const MIN_CLUSTER = 5;

// ── Topic palette ─────────────────────────────────────────────────────────────
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
  const haloCanvasRef = useRef<HTMLCanvasElement>(null);
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

  // ── Community map ─────────────────────────────────────────────────────────
  const communities = useMemo(() => {
    const map = new Map<number, FileNode[]>();
    for (const node of data.nodes) {
      const n = node as FileNode;
      if (n.community !== undefined && n.community !== null) {
        if (!map.has(n.community)) map.set(n.community, []);
        map.get(n.community)!.push(n);
      }
    }
    return map;
  }, [data.nodes]);

  // ── Filter small clusters ─────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    const smallCIds = new Set<number>();
    communities.forEach((nodes, cId) => {
      if (nodes.length <= MIN_CLUSTER) smallCIds.add(cId);
    });
    if (smallCIds.size === 0) return data;
    const validIds = new Set(
      data.nodes
        .filter(n => (n as FileNode).community === undefined || !smallCIds.has((n as FileNode).community!))
        .map(n => (n as FileNode).id)
    );
    return {
      nodes: data.nodes.filter(n => validIds.has((n as FileNode).id)),
      links: data.links.filter(l => {
        const s = typeof l.source === "string" ? l.source : (l.source as FileNode).id;
        const t = typeof l.target === "string" ? l.target : (l.target as FileNode).id;
        return validIds.has(s) && validIds.has(t);
      }),
    };
  }, [data, communities]);

  // ── O(1) node lookup ──────────────────────────────────────────────────────
  const nodeById = useMemo(() => {
    const m = new Map<string, FileNode>();
    for (const n of data.nodes) m.set((n as FileNode).id, n as FileNode);
    return m;
  }, [data.nodes]);

  // ── Fetch AI cluster labels ───────────────────────────────────────────────
  useEffect(() => {
    if (communities.size === 0) return;
    const payload: Record<string, { name: string; preview?: string; type: string }[]> = {};
    communities.forEach((nodes, cId) => {
      if (nodes.length > MIN_CLUSTER)
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

  // ── Community centers (highest-degree node) ───────────────────────────────
  const communityCenters = useMemo(() => {
    const centers = new Map<number, string>();
    communities.forEach((nodes, cId) => {
      if (nodes.length <= MIN_CLUSTER) return;
      const top = nodes.reduce((a, b) => ((a.degree ?? 0) >= (b.degree ?? 0) ? a : b));
      centers.set(cId, top.id);
    });
    return centers;
  }, [communities]);

  const hubNodeIds = useMemo(() => new Set(communityCenters.values()), [communityCenters]);

  // ── Fallback file-type centers ────────────────────────────────────────────
  const fileTypeCenters = useMemo(() => {
    if (communities.size > 0) return new Map<string, string>();
    const groups = new Map<string, FileNode[]>();
    for (const n of data.nodes) {
      const fn = n as FileNode;
      if (!groups.has(fn.type)) groups.set(fn.type, []);
      groups.get(fn.type)!.push(fn);
    }
    const centers = new Map<string, string>();
    groups.forEach((nodes, type) => {
      const top = nodes.reduce((a, b) => ((a.degree ?? 0) >= (b.degree ?? 0) ? a : b));
      if ((top.degree ?? 0) > 0) centers.set(type, top.id);
    });
    return centers;
  }, [communities.size, data.nodes]);

  // ── nodeId → label ────────────────────────────────────────────────────────
  const nodeLabelMap = useMemo(() => {
    const map = new Map<string, { label: string; isTopic: boolean }>();
    communityCenters.forEach((nodeId, cId) => {
      map.set(nodeId, { label: aiLabels.get(cId) ?? `Topic ${cId}`, isTopic: true });
    });
    fileTypeCenters.forEach((nodeId, type) => {
      if (!map.has(nodeId))
        map.set(nodeId, { label: TYPE_TO_TOPIC[type] ?? type, isTopic: true });
    });
    return map;
  }, [communityCenters, fileTypeCenters, aiLabels]);

  const labelNodeIds = useMemo(() => {
    const ids = new Set<string>(nodeLabelMap.keys());
    [...filteredData.nodes]
      .sort((a, b) => ((b as FileNode).val ?? 0) - ((a as FileNode).val ?? 0))
      .slice(0, 12)
      .forEach(n => ids.add((n as FileNode).id));
    return ids;
  }, [nodeLabelMap, filteredData.nodes]);

  // ── Throttled RAF: labels + cluster halos ─────────────────────────────────
  useEffect(() => {
    let rafId: number;
    let lastUpdate = 0;

    const tick = (timestamp: number) => {
      if (!fgRef.current) { rafId = requestAnimationFrame(tick); return; }

      if (timestamp - lastUpdate >= 50) {
        lastUpdate = timestamp;

        // Update HTML label positions
        const items: LabelItem[] = [];
        for (const rawNode of filteredData.nodes) {
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

        // Draw cluster halos on the background canvas
        const haloCtx = haloCanvasRef.current?.getContext("2d");
        if (haloCtx) {
          haloCtx.clearRect(0, 0, dimensions.width, dimensions.height);
          communities.forEach((nodes, cId) => {
            if (nodes.length <= MIN_CLUSTER) return;
            const positions = nodes
              .map(n => {
                const fn = n as FileNode & { x?: number; y?: number };
                if (fn.x === undefined || fn.y === undefined) return null;
                return fgRef.current!.graph2ScreenCoords(fn.x, fn.y);
              })
              .filter((p): p is { x: number; y: number } => p !== null && isFinite(p.x) && isFinite(p.y));
            if (positions.length < 2) return;
            const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
            const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
            const spread = Math.max(...positions.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)));
            const r = Math.max(60, spread * 1.4 + 50);
            const color = TOPIC_PALETTE[cId % TOPIC_PALETTE.length];
            const grad = haloCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, hexToRgba(color, 0.13));
            grad.addColorStop(0.55, hexToRgba(color, 0.06));
            grad.addColorStop(1, hexToRgba(color, 0));
            haloCtx.beginPath();
            haloCtx.arc(cx, cy, r, 0, Math.PI * 2);
            haloCtx.fillStyle = grad;
            haloCtx.fill();
          });
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [filteredData.nodes, labelNodeIds, nodeLabelMap, communities, dimensions]);

  // ── Node rendering ────────────────────────────────────────────────────────
  const nodeCanvasObject = useCallback(
    (rawNode: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as FileNode & { x: number; y: number };
      const color = getCommunityColor(node.community, node.type);
      const rawVal = node.val ?? 3;
      const radius = Math.max(3, isFinite(rawVal) ? rawVal * 1.4 : 3);
      const highlighted = highlightIds?.has(node.id);
      const isHub = hubNodeIds.has(node.id);

      if (!isFinite(node.x) || !isFinite(node.y)) return;

      // Bloom glow — highlighted or hub only
      if (highlighted || isHub) {
        const glowR = radius * (highlighted ? 4.5 : 3.2);
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR);
        glow.addColorStop(0, hexToRgba(color, highlighted ? 0.38 : 0.18));
        glow.addColorStop(1, hexToRgba(color, 0));
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Hub rings
      if (isHub) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 5 / globalScale, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(color, 0.22);
        ctx.lineWidth = 3.5 / globalScale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 2.5 / globalScale, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(color, 0.6);
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // Highlight ring
      if (highlighted) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3 / globalScale, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Solid node body
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // White rim (crisp edge)
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // Clipped top-left sheen (stays inside the circle)
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(node.x - radius * 0.2, node.y - radius * 0.28, radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fill();
      ctx.restore();

      // Indexed center dot
      if (node.indexed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fill();
      }
    },
    [highlightIds, hubNodeIds]
  );

  // ── Link color — O(1) lookup ──────────────────────────────────────────────
  const linkColor = useCallback(
    (link: object) => {
      const l = link as { value?: number; source?: unknown; target?: unknown };
      const score = l.value ?? 0.75;
      const alpha = 0.18 + score * 0.34;
      const srcId = typeof l.source === "string" ? l.source : (l.source as FileNode)?.id;
      const srcNode = nodeById.get(srcId);
      if (srcNode?.community !== undefined) {
        return hexToRgba(TOPIC_PALETTE[srcNode.community % TOPIC_PALETTE.length], alpha);
      }
      return hexToRgba("#6366f1", 0.2 + score * 0.28);
    },
    [nodeById]
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

  // Visible communities (> MIN_CLUSTER)
  const visibleCommunities = useMemo(() => {
    const result = new Map<number, FileNode[]>();
    communities.forEach((nodes, cId) => {
      if (nodes.length > MIN_CLUSTER) result.set(cId, nodes);
    });
    return result;
  }, [communities]);

  return (
    <>
      {/* ── Cluster halo canvas (behind graph) ── */}
      <canvas
        ref={haloCanvasRef}
        width={dimensions.width}
        height={dimensions.height - 56}
        style={{
          position: "fixed",
          left: 0,
          top: 56,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* ── ForceGraph (above halos) ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "auto" }}>
        <ForceGraph2D
          ref={fgRef}
          graphData={filteredData as { nodes: object[]; links: object[] }}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          linkColor={linkColor}
          linkWidth={(link: object) => {
            const l = link as { value?: number };
            return 0.3 + (l.value ?? 0.75) * 1.1;
          }}
          linkCurvature={0.18}
          backgroundColor="rgba(0,0,0,0)"
          onNodeClick={(rawNode: object) => onNodeClick(rawNode as FileNode)}
          onNodeHover={handleNodeHover as (node: object | null, prev: object | null) => void}
          nodeLabel={() => ""}
          warmupTicks={100}
          cooldownTicks={120}
          d3AlphaDecay={0.028}
          d3VelocityDecay={0.4}
          width={dimensions.width}
          height={dimensions.height - 56}
          onEngineStop={() => {
            if (!hasZoomed.current) {
              hasZoomed.current = true;
              fgRef.current?.zoomToFit(600, 48);
            }
          }}
        />
      </div>

      {/* ── HTML label overlay ── */}
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
            color: item.isTopic ? item.color : "rgba(28,28,30,0.6)",
            textShadow: "0 1px 4px rgba(255,255,255,0.95), 0 0 10px rgba(255,255,255,0.85)",
            letterSpacing: item.isTopic ? "0.02em" : "0",
          }}
        >
          {item.label}
        </div>
      ))}

      {/* ── Tooltip ── */}
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
                  ? aiLabels.get(hovered.community) ?? hovered.type
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

      {/* ── Cluster legend (only shows clusters > MIN_CLUSTER) ── */}
      {visibleCommunities.size > 0 && (
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
            {Array.from(visibleCommunities.entries())
              .sort((a, b) => b[1].length - a[1].length)
              .slice(0, 8)
              .map(([cId, nodes]) => {
                const color = TOPIC_PALETTE[cId % TOPIC_PALETTE.length];
                const label = aiLabels.get(cId) ?? `Topic ${cId}`;
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
