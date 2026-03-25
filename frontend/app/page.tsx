"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, RefreshCw, ChevronDown, ChevronUp,
  FileText, Image, Code, Film, Music, Folder, File, Link2,
  Activity, Layers, Database, type LucideIcon,
} from "lucide-react";
import type { FileNode, GraphData } from "@/types";
import { FILE_TYPE_COLORS, FILE_TYPE_LABELS, buildLinks, formatBytes } from "@/lib/utils";
import FileDetails from "@/components/FileDetails";
import SearchBar from "@/components/SearchBar";

// 3D graph is browser-only
const Graph3D = dynamic(() => import("@/components/Graph3D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <div className="text-center">
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "2px solid var(--cyan)",
            borderTopColor: "transparent",
            animation: "spin 1s linear infinite",
            margin: "0 auto 16px",
          }}
        />
        <p className="font-orbitron" style={{ fontSize: 10, letterSpacing: "0.15em", color: "var(--text-muted)" }}>
          INITIALIZING RENDERER
        </p>
      </div>
    </div>
  ),
});

const TYPE_ICONS: Record<string, LucideIcon> = {
  image: Image,
  text: FileText,
  code: Code,
  pdf: FileText,
  video: Film,
  audio: Music,
  folder: Folder,
  other: File,
};

export default function Home() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embeddingProgress, setEmbeddingProgress] = useState(0);
  const [embeddingCurrent, setEmbeddingCurrent] = useState("");
  const [embeddedCount, setEmbeddedCount] = useState(0);
  const [statsOpen, setStatsOpen] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const filesRef = useRef<FileNode[]>([]);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      const loaded: FileNode[] = data.files ?? [];
      setFiles(loaded);
      filesRef.current = loaded;
      setGraphData({
        nodes: loaded,
        links: [],
      });
    } finally {
      setLoading(false);
    }
  };

  // Generate embeddings for all files
  const generateEmbeddings = useCallback(async () => {
    if (isEmbedding) return;
    setIsEmbedding(true);
    setEmbeddingProgress(0);

    const current = [...filesRef.current];
    const updated = [...current];

    for (let i = 0; i < current.length; i++) {
      const file = current[i];
      setEmbeddingCurrent(file.name);
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.path, type: file.type }),
        });
        if (res.ok) {
          const { embedding, preview } = await res.json();
          if (embedding) {
            updated[i] = { ...file, embedding, preview };
          }
        }
      } catch {
        // skip failed files silently
      }
      const progress = ((i + 1) / current.length) * 100;
      setEmbeddingProgress(progress);
      setEmbeddedCount(i + 1);

      // Update graph incrementally every 5 files
      if (i % 5 === 0 || i === current.length - 1) {
        const links = buildLinks(updated);
        setFiles([...updated]);
        filesRef.current = [...updated];
        setGraphData({ nodes: [...updated], links });
      }
    }

    setIsEmbedding(false);
    setEmbeddingCurrent("");
  }, [isEmbedding]);

  // Apply type filter to graph
  const filteredGraphData: GraphData = filterType
    ? {
        nodes: graphData.nodes.filter((n) => n.type === filterType),
        links: graphData.links.filter((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as FileNode).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as FileNode).id;
          const filtered = new Set(graphData.nodes.filter((n) => n.type === filterType).map((n) => n.id));
          return filtered.has(src) && filtered.has(tgt);
        }),
      }
    : graphData;

  // Count by type
  const typeCounts = files.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] ?? 0) + 1;
    return acc;
  }, {});

  const totalSize = files.reduce((acc, f) => acc + (f.size ?? 0), 0);
  const embCount = files.filter((f) => f.embedding).length;

  return (
    <div className="neural-bg w-screen h-screen">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="glass"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: selectedFile ? 352 : 0,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          zIndex: 40,
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
          borderRadius: 0,
          transition: "right 0.4s ease",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "1.5px solid var(--cyan)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "radial-gradient(circle, rgba(0,212,255,0.15) 0%, transparent 70%)",
            }}
          >
            <Activity size={14} color="var(--cyan)" />
          </div>
          <div>
            <span className="font-orbitron font-black neon-cyan logo-flicker" style={{ fontSize: 16, letterSpacing: "0.08em" }}>
              NEURAL
            </span>
            <span className="font-orbitron font-black neon-magenta" style={{ fontSize: 16, letterSpacing: "0.08em" }}>
              VAULT
            </span>
          </div>
          <div
            style={{
              width: 1,
              height: 24,
              background: "var(--border)",
              margin: "0 8px",
            }}
          />
          <span className="font-orbitron" style={{ fontSize: 8, letterSpacing: "0.18em", color: "var(--text-muted)" }}>
            DESKTOP INTELLIGENCE
          </span>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6">
          <StatChip icon={<Layers size={11} />} label="FILES" value={files.length} color="var(--cyan)" />
          <StatChip icon={<Database size={11} />} label="INDEXED" value={embCount} color="var(--green)" />
          <StatChip icon={<Link2 size={11} />} label="LINKS" value={graphData.links.length} color="var(--magenta)" />
          <button
            onClick={() => setStatsOpen((s) => !s)}
            className="glass flex items-center gap-1 px-3 py-1.5"
            style={{
              fontSize: 9,
              fontFamily: "var(--font-orbitron)",
              letterSpacing: "0.1em",
              color: "var(--text-muted)",
              cursor: "pointer",
              borderRadius: 2,
            }}
          >
            {statsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            TYPES
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button onClick={loadFiles} className="btn-neon" disabled={loading || isEmbedding}>
            <RefreshCw size={11} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Scan
          </button>
          <button
            onClick={generateEmbeddings}
            className={embCount > 0 ? "btn-magenta btn-neon" : "btn-neon"}
            disabled={isEmbedding || files.length === 0}
          >
            <Zap size={11} />
            {isEmbedding ? `Embedding… ${Math.round(embeddingProgress)}%` : embCount > 0 ? "Re-Embed" : "Generate Embeddings"}
          </button>
        </div>
      </header>

      {/* ── Type filter dropdown ─────────────────────────────────────────── */}
      <AnimatePresence>
        {statsOpen && (
          <motion.div
            className="glass"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              position: "fixed",
              top: 68,
              right: selectedFile ? 368 : 16,
              zIndex: 45,
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 200,
            }}
          >
            <div
              className="font-orbitron pb-1"
              style={{ fontSize: 8, letterSpacing: "0.15em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}
            >
              FILTER BY TYPE
            </div>
            <button
              onClick={() => setFilterType(null)}
              className="flex items-center justify-between px-2 py-1.5 rounded transition-colors"
              style={{ background: filterType === null ? "rgba(0,212,255,0.1)" : "transparent", width: "100%", cursor: "pointer" }}
            >
              <span style={{ fontSize: 11, color: "var(--text)", fontFamily: "var(--font-outfit)" }}>All files</span>
              <span className="font-mono-space" style={{ fontSize: 10, color: "var(--cyan)" }}>{files.length}</span>
            </button>
            {Object.entries(typeCounts).map(([type, count]) => {
              const color = FILE_TYPE_COLORS[type as keyof typeof FILE_TYPE_COLORS] ?? "#64748B";
              const Icon = TYPE_ICONS[type] ?? File;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(filterType === type ? null : type)}
                  className="flex items-center justify-between px-2 py-1.5 rounded transition-colors"
                  style={{
                    background: filterType === type ? `${color}18` : "transparent",
                    width: "100%",
                    cursor: "pointer",
                    border: filterType === type ? `1px solid ${color}44` : "1px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={11} color={color} />
                    <span style={{ fontSize: 11, color: "var(--text)", fontFamily: "var(--font-outfit)" }}>
                      {FILE_TYPE_LABELS[type as keyof typeof FILE_TYPE_LABELS] ?? type}
                    </span>
                  </div>
                  <span className="font-mono-space" style={{ fontSize: 10, color }}>{count}</span>
                </button>
              );
            })}
            <div style={{ height: 1, background: "var(--border)" }} />
            <div className="font-orbitron" style={{ fontSize: 8, color: "var(--text-muted)", padding: "2px 8px" }}>
              TOTAL SIZE: {formatBytes(totalSize)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading state ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,5,8,0.85)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                border: "2px solid var(--cyan)",
                borderTopColor: "transparent",
                animation: "spin 0.8s linear infinite",
                marginBottom: 24,
              }}
            />
            <p className="font-orbitron neon-cyan" style={{ fontSize: 12, letterSpacing: "0.2em" }}>
              SCANNING DESKTOP
            </p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, fontFamily: "var(--font-outfit)" }}>
              Building neural index…
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Embedding progress bar ───────────────────────────────────────── */}
      <AnimatePresence>
        {isEmbedding && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="glass"
            style={{
              position: "fixed",
              bottom: 104,
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(520px, calc(100vw - 360px))",
              padding: "12px 20px",
              zIndex: 55,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-orbitron" style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--cyan)" }}>
                EMBEDDING WITH GEMINI
              </span>
              <span className="font-mono-space" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {embeddedCount} / {files.length}
              </span>
            </div>
            <div style={{ background: "var(--border)", height: 2, borderRadius: 1, overflow: "hidden" }}>
              <div
                className="progress-bar"
                style={{ width: `${embeddingProgress}%`, height: "100%" }}
              />
            </div>
            {embeddingCurrent && (
              <p className="font-mono-space mt-2 truncate" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                ↳ {embeddingCurrent}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 3D Graph ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          paddingTop: 60,
          paddingRight: selectedFile ? 336 : 0,
          transition: "padding-right 0.4s ease",
        }}
      >
        {!loading && (
          <Graph3D
            data={filteredGraphData}
            onNodeClick={(node) => setSelectedFile(node)}
            highlightIds={highlightIds}
          />
        )}
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div
        className="glass"
        style={{
          position: "fixed",
          bottom: 104,
          left: 16,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          zIndex: 30,
        }}
      >
        <div className="font-orbitron" style={{ fontSize: 7, letterSpacing: "0.15em", color: "var(--text-muted)", marginBottom: 2 }}>
          NODE TYPES
        </div>
        {Object.entries(typeCounts).map(([type, count]) => {
          const color = FILE_TYPE_COLORS[type as keyof typeof FILE_TYPE_COLORS] ?? "#64748B";
          return (
            <div key={type} className="flex items-center gap-2">
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                }}
              />
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-outfit)" }}>
                {FILE_TYPE_LABELS[type as keyof typeof FILE_TYPE_LABELS] ?? type}
              </span>
              <span className="font-mono-space" style={{ fontSize: 10, color, marginLeft: "auto", paddingLeft: 8 }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Hints ────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: 104,
          right: selectedFile ? 352 : 16,
          padding: "10px 14px",
          zIndex: 30,
          transition: "right 0.4s ease",
        }}
      >
        <div
          className="glass font-orbitron"
          style={{
            fontSize: 8,
            letterSpacing: "0.1em",
            color: "var(--text-dim)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 14px",
          }}
        >
          <span>⬡ CLICK NODE → DETAILS</span>
          <span>⬡ DRAG → ROTATE GRAPH</span>
          <span>⬡ SCROLL → ZOOM</span>
          <span>⬡ ⌘+K → FOCUS SEARCH</span>
        </div>
      </div>

      {/* ── File details panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedFile && (
          <FileDetails
            file={files.find((f) => f.id === selectedFile.id) ?? selectedFile}
            onClose={() => setSelectedFile(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <SearchBar
        files={files}
        onHighlight={setHighlightIds}
        onSelectFile={(f) => { setSelectedFile(f); setStatsOpen(false); }}
      />
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      <div>
        <div className="font-orbitron" style={{ fontSize: 8, letterSpacing: "0.12em", color: "var(--text-muted)" }}>
          {label}
        </div>
        <div className="font-mono-space" style={{ fontSize: 13, color, lineHeight: 1 }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
