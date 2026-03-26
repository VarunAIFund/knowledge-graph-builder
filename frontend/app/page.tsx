"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, RefreshCw, Loader2, Network, Search } from "lucide-react";
import type { FileNode, GraphData } from "@/types";
import { buildLinks } from "@/lib/utils";
import FileDetails from "@/components/FileDetails";
import SearchBar from "@/components/SearchBar";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { GlassFilter } from "@/components/ui/liquid-glass";

const Graph3D = dynamic(() => import("@/components/Graph3D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <Loader2
        size={24}
        className="text-indigo-500"
        style={{ animation: "spin 1s linear infinite" }}
      />
    </div>
  ),
});

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
  const [neo4jConnected, setNeo4jConnected] = useState(false);
  const [communityCount, setCommunityCount] = useState(0);
  const filesRef = useRef<FileNode[]>([]);

  useEffect(() => { loadFiles(); }, []);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/files");
      const data = await res.json();
      const loaded: FileNode[] = data.files ?? [];
      setFiles(loaded);
      filesRef.current = loaded;

      const graphRes = await fetch("/api/graph");
      if (graphRes.ok) {
        const gd = await graphRes.json();
        if (gd.neo4j && (gd.nodes.length > 0 || gd.links.length > 0)) {
          const fileMap = Object.fromEntries(loaded.map((f) => [f.id, f]));
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
        } else {
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

      if (i % 5 === 0 || i === current.length - 1) {
        const links = buildLinks(updated);
        setFiles([...updated]);
        filesRef.current = [...updated];
        setGraphData({ nodes: [...updated], links });
      }
    }

    setIsEmbedding(false);
    setEmbeddingCurrent("");

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
    }, 3000);
  }, [isEmbedding]);

  const embCount = files.filter((f) => f.embedding).length;

  const displayData = useMemo<GraphData>(() => {
    if (graphData.links.length === 0) return graphData;
    const linked = new Set<string>();
    for (const l of graphData.links) {
      const src = typeof l.source === "string" ? l.source : (l.source as FileNode).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as FileNode).id;
      linked.add(src);
      linked.add(tgt);
    }
    return {
      nodes: graphData.nodes.filter((n) => linked.has(n.id)),
      links: graphData.links,
    };
  }, [graphData]);

  return (
    <div className="app-bg w-screen h-screen">
      <GlassFilter />

      {/* ── Header — macOS menubar glass ────────────────────────────────── */}
      <header
        className="glass fixed top-0 left-0 z-40 flex items-center justify-between px-4"
        style={{
          right: selectedFile ? 336 : 0,
          height: 52,
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
          borderRadius: 0,
          transition: "right 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Logo + nav */}
        <div className="flex items-center gap-3">
          <span className="font-orbitron font-black text-[14px] tracking-wider text-[#1c1c1e]">
            Neural<span style={{ color: "var(--accent)" }}>Vault</span>
          </span>

          <span className="text-black/15 select-none text-[9px]">●</span>

          <nav className="flex items-center gap-0.5">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150"
              style={{
                color: "var(--accent)",
                background: "rgba(88, 86, 214, 0.1)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 0 0 0.5px rgba(88,86,214,0.2)",
              }}
            >
              <Network size={12} />
              Graph
            </Link>
            <Link
              href="/search"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
                e.currentTarget.style.background = "rgba(0,0,0,0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.background = "";
              }}
            >
              <Search size={12} />
              Search
            </Link>
          </nav>
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-5 text-[11px]" style={{ color: "var(--text-dim)" }}>
          <span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>{files.length}</span>
            <span className="ml-1">files</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>{embCount}</span>
            <span className="ml-1">indexed</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>{graphData.links.length}</span>
            <span className="ml-1">links</span>
          </span>
          {neo4jConnected && communityCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--green)", boxShadow: "0 0 5px rgba(52,199,89,0.6)" }}
              />
              <span style={{ color: "var(--green)" }} className="font-medium">{communityCount} clusters</span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <LiquidButton
            variant="ghost"
            size="sm"
            onClick={loadFiles}
            disabled={loading || isEmbedding}
          >
            <RefreshCw
              size={12}
              style={{ animation: loading ? "spin 1s linear infinite" : "none" }}
            />
            Scan
          </LiquidButton>

          <LiquidButton
            variant="accent"
            size="sm"
            onClick={generateEmbeddings}
            disabled={isEmbedding || files.length === 0}
            tint="rgba(88, 86, 214, 0.1)"
          >
            <Zap size={12} />
            {isEmbedding
              ? `${Math.round(embeddingProgress)}%`
              : embCount > 0
              ? "Re-embed"
              : "Generate embeddings"}
          </LiquidButton>
        </div>
      </header>

      {/* ── Loading overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center"
            style={{
              background: "rgba(238, 240, 248, 0.8)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
            }}
          >
            <div
              className="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl"
              style={{
                background: "rgba(255, 255, 255, 0.75)",
                boxShadow: [
                  "inset 0 1.5px 0 rgba(255,255,255,1)",
                  "inset 0 -1px 0 rgba(0,0,0,0.03)",
                  "0 0 0 0.5px rgba(0,0,0,0.1)",
                  "0 16px 48px rgba(60,60,120,0.16)",
                ].join(", "),
              }}
            >
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{
                  background: "rgba(88,86,214,0.1)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 0.5px rgba(88,86,214,0.2)",
                }}
              >
                <Loader2
                  size={20}
                  style={{ color: "var(--accent)", animation: "spin 0.9s linear infinite" }}
                />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                  Scanning Desktop
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Building file index…
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Embedding progress toast ─────────────────────────────────────── */}
      <AnimatePresence>
        {isEmbedding && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[55] rounded-2xl px-5 py-4"
            style={{
              width: "min(420px, calc(100vw - 48px))",
              background: "rgba(255, 255, 255, 0.75)",
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              boxShadow: [
                "inset 0 1.5px 0 rgba(255,255,255,1)",
                "inset 0 -1px 0 rgba(0,0,0,0.04)",
                "0 0 0 0.5px rgba(0,0,0,0.1)",
                "0 12px 40px rgba(60,60,120,0.16)",
              ].join(", "),
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{
                    background: "rgba(88,86,214,0.1)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
                  }}
                >
                  <Zap size={10} style={{ color: "var(--accent)" }} />
                </div>
                <span className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>
                  Generating embeddings
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
                {embeddedCount} / {files.length}
              </span>
            </div>

            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: "rgba(0,0,0,0.06)" }}
            >
              <div
                className="progress-bar h-full rounded-full"
                style={{ width: `${embeddingProgress}%` }}
              />
            </div>

            {embeddingCurrent && (
              <p className="font-mono text-[10px] mt-2 truncate" style={{ color: "var(--text-dim)" }}>
                {embeddingCurrent}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 2D Graph ────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          paddingTop: 52,
          paddingRight: selectedFile ? 336 : 0,
          transition: "padding-right 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {!loading && (
          <Graph3D
            data={displayData}
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
