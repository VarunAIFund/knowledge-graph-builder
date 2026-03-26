"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, RefreshCw, Loader2,
  FileText, Image, Code, Film, Music, Folder, File,
  type LucideIcon,
} from "lucide-react";
import type { FileNode, GraphData } from "@/types";
import { FILE_TYPE_COLORS, buildLinks } from "@/lib/utils";
import FileDetails from "@/components/FileDetails";
import SearchBar from "@/components/SearchBar";
import { Button } from "@/components/ui/button";

const Graph3D = dynamic(() => import("@/components/Graph3D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <Loader2 size={24} className="text-indigo-400" style={{ animation: "spin 1s linear infinite" }} />
    </div>
  ),
});

const TYPE_ICONS: Record<string, LucideIcon> = {
  image: Image, text: FileText, code: Code, pdf: FileText,
  video: Film, audio: Music, folder: Folder, other: File,
};

export default function Home() {
  const [files, setFiles]               = useState<FileNode[]>([]);
  const [graphData, setGraphData]       = useState<GraphData>({ nodes: [], links: [] });
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(true);
  const [isEmbedding, setIsEmbedding]   = useState(false);
  const [embeddingProgress, setEmbeddingProgress] = useState(0);
  const [embeddingCurrent, setEmbeddingCurrent]   = useState("");
  const [embeddedCount, setEmbeddedCount]         = useState(0);
  const [filterType, setFilterType]     = useState<string | null>(null);
  const [neo4jConnected, setNeo4jConnected] = useState(false);
  const [communityCount, setCommunityCount] = useState(0);
  const filesRef = useRef<FileNode[]>([]);

  useEffect(() => { loadFiles(); }, []);

  /** Load files, then pull graph from Neo4j if available. */
  const loadFiles = async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/files");
      const data = await res.json();
      const loaded: FileNode[] = data.files ?? [];
      setFiles(loaded);
      filesRef.current = loaded;

      // Try fetching the Neo4j graph first
      const graphRes = await fetch("/api/graph");
      if (graphRes.ok) {
        const gd = await graphRes.json();
        if (gd.neo4j && (gd.nodes.length > 0 || gd.links.length > 0)) {
          // Enrich Neo4j nodes with full file data (embeddings etc.) from /api/files
          const fileMap = Object.fromEntries(loaded.map((f) => [f.id, f]));
          const mergedNodes = gd.nodes.map((n: Record<string, unknown>) => ({
            ...(fileMap[n.id as string] ?? {}),
            ...n,
            // Use val from Neo4j (degree-boosted) if present
            val: n.degree
              ? Math.max(2, Math.min(12, (n.baseVal as number ?? 3) + Math.round((n.degree as number) * 0.8)))
              : (fileMap[n.id as string]?.val ?? 3),
          }));
          setGraphData({ nodes: mergedNodes, links: gd.links });
          setNeo4jConnected(true);
          setCommunityCount(gd.communities ?? 0);
        } else {
          // Neo4j has no data yet — build links client-side from loaded embeddings
          setGraphData({ nodes: loaded, links: buildLinks(loaded) });
          setNeo4jConnected(gd.neo4j ?? false);
        }
      } else {
        setGraphData({ nodes: loaded, links: buildLinks(loaded) });
      }
    } finally {
      setLoading(false);
    }
  };

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
          if (embedding) updated[i] = { ...file, embedding, preview };
        }
      } catch { /* skip */ }
      setEmbeddingProgress(((i + 1) / current.length) * 100);
      setEmbeddedCount(i + 1);

      // Incremental client-side graph update every 5 files
      if (i % 5 === 0 || i === current.length - 1) {
        const links = buildLinks(updated);
        setFiles([...updated]);
        filesRef.current = [...updated];
        setGraphData({ nodes: [...updated], links });
      }
    }

    setIsEmbedding(false);
    setEmbeddingCurrent("");

    // After all embeddings done, refresh graph from Neo4j for community data
    setTimeout(async () => {
      try {
        const graphRes = await fetch("/api/graph");
        if (graphRes.ok) {
          const gd = await graphRes.json();
          if (gd.neo4j && gd.nodes.length > 0) {
            const fileMap = Object.fromEntries(filesRef.current.map((f) => [f.id, f]));
            const mergedNodes = gd.nodes.map((n: Record<string, unknown>) => ({
              ...(fileMap[n.id as string] ?? {}),
              ...n,
              val: n.degree
                ? Math.max(2, Math.min(12, (n.baseVal as number ?? 3) + Math.round((n.degree as number) * 0.8)))
                : (fileMap[n.id as string]?.val ?? 3),
            }));
            setGraphData({ nodes: mergedNodes, links: gd.links });
            setNeo4jConnected(true);
            setCommunityCount(gd.communities ?? 0);
          }
        }
      } catch { /* ignore */ }
    }, 3000); // wait 3s for background link-building to finish
  }, [isEmbedding]);

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

  const typeCounts = files.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] ?? 0) + 1;
    return acc;
  }, {});
  const embCount = files.filter((f) => f.embedding).length;

  return (
    <div className="app-bg w-screen h-screen">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="glass fixed top-0 left-0 z-40 flex items-center justify-between px-5"
        style={{
          right: selectedFile ? 336 : 0,
          height: 56,
          borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0,
          transition: "right 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <span className="font-orbitron font-black text-[15px] tracking-wide text-slate-100">
            Neural<span className="text-indigo-400">Vault</span>
          </span>
          <span className="text-slate-700 select-none">·</span>
          <span className="text-[12px] text-slate-500 font-medium hidden sm:block">
            Desktop Intelligence
          </span>
        </div>

        {/* Stats + Neo4j status */}
        <div className="hidden md:flex items-center gap-4 text-[12px] text-slate-500">
          <span><span className="text-slate-300 font-semibold">{files.length}</span> files</span>
          <span><span className="text-slate-300 font-semibold">{embCount}</span> indexed</span>
          <span><span className="text-slate-300 font-semibold">{graphData.links.length}</span> links</span>
          {neo4jConnected && communityCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                style={{ boxShadow: "0 0 4px #22c55e" }}
              />
              <span className="text-emerald-600 text-[11px]">{communityCount} clusters</span>
            </span>
          )}
        </div>

        {/* Type filter */}
        <div className="hidden lg:flex items-center gap-1">
          <button
            onClick={() => setFilterType(null)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors pressable ${
              filterType === null
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]"
            }`}
          >
            All
          </button>
          {Object.entries(typeCounts).slice(0, 5).map(([type, count]) => {
            const color = FILE_TYPE_COLORS[type as keyof typeof FILE_TYPE_COLORS] ?? "#64748b";
            const Icon  = TYPE_ICONS[type] ?? File;
            return (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? null : type)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors pressable ${
                  filterType === type ? "border" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]"
                }`}
                style={filterType === type ? { color, borderColor: `${color}40`, backgroundColor: `${color}14` } : {}}
              >
                <Icon size={11} style={{ color: filterType === type ? color : undefined }} />
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="sm"
            onClick={loadFiles}
            disabled={loading || isEmbedding}
            className="h-8 px-3 text-[12px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] gap-1.5"
          >
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Scan
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={generateEmbeddings}
            disabled={isEmbedding || files.length === 0}
            className="h-8 px-3 text-[12px] gap-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/50"
          >
            <Zap size={12} />
            {isEmbedding ? `${Math.round(embeddingProgress)}%` : embCount > 0 ? "Re-embed" : "Generate embeddings"}
          </Button>
        </div>
      </header>

      {/* ── Loading overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center"
            style={{ background: "rgba(9,9,11,0.9)", backdropFilter: "blur(4px)" }}
          >
            <Loader2 size={32} className="text-indigo-400 mb-4" style={{ animation: "spin 0.8s linear infinite" }} />
            <p className="text-[14px] font-medium text-slate-300">Scanning Desktop…</p>
            <p className="text-[12px] text-slate-600 mt-1">Building file index</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Embedding progress ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isEmbedding && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="glass fixed bottom-20 left-1/2 -translate-x-1/2 z-[55] rounded-xl px-5 py-3.5"
            style={{ width: "min(480px, calc(100vw - 64px))" }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Zap size={12} className="text-indigo-400" />
                <span className="text-[12px] font-medium text-slate-300">Generating embeddings → Neo4j</span>
              </div>
              <span className="text-[12px] text-slate-500 font-mono">{embeddedCount} / {files.length}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="progress-bar h-full rounded-full" style={{ width: `${embeddingProgress}%` }} />
            </div>
            {embeddingCurrent && (
              <p className="font-mono text-[10px] text-slate-600 mt-2 truncate">{embeddingCurrent}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 3D Graph ────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed", inset: 0, paddingTop: 56,
          paddingRight: selectedFile ? 336 : 0,
          transition: "padding-right 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
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

      {/* ── File details ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedFile && (
          <FileDetails
            file={files.find((f) => f.id === selectedFile.id) ?? selectedFile}
            onClose={() => setSelectedFile(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <SearchBar
        files={files}
        onHighlight={setHighlightIds}
        onSelectFile={(f) => setSelectedFile(f)}
      />
    </div>
  );
}
