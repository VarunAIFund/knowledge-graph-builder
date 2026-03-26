"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, Network, X, ExternalLink, Sparkles } from "lucide-react";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS, formatBytes } from "@/lib/utils";

// ── Utility ───────────────────────────────────────────────────────────────────

function isRawMeta(preview: string | undefined): boolean {
  if (!preview) return false;
  const t = preview.trim();
  return (
    /^(file|video file|audio file|image file|pdf file|text file|code file|folder)[\s:]/i.test(t) ||
    /^[A-Za-z]{2,6}: \S+\.(pdf|mp4|mov|avi|mp3|wav|jpg|jpeg|png|gif|webp|txt|md|tex|csv)\b/i.test(t)
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const [files, setFiles]         = useState<FileNode[]>([]);
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<FileNode[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files ?? []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!loading) setTimeout(() => inputRef.current?.focus(), 80);
  }, [loading]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      // Server-side embedding search
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 20 }),
      });
      if (res.ok) {
        const { results: hits } = await res.json();
        if (hits?.length > 0) {
          const fileMap = Object.fromEntries(files.map((f) => [f.id, f]));
          setResults(hits.map((h: { id: string }) => fileMap[h.id] ?? h).filter(Boolean));
          return;
        }
      }
      // Fallback: filename match
      const lower = q.toLowerCase();
      setResults(files.filter((f) => f.name.toLowerCase().includes(lower)).slice(0, 20));
    } finally {
      setSearching(false);
    }
  }, [files]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 280);
  };

  const openFile = (file: FileNode) => {
    fetch(`/api/open?path=${encodeURIComponent(file.path)}&action=open`, { method: "POST" });
  };

  const totalIndexed = files.filter((f) => f.embedding).length;

  return (
    <div className="app-bg w-screen h-screen overflow-hidden flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="glass fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-5"
        style={{ height: 56, borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0 }}
      >
        <div className="flex items-center gap-3">
          <span className="font-orbitron font-black text-[15px] tracking-wide text-slate-100">
            Neural<span className="text-indigo-400">Vault</span>
          </span>
          <span className="text-slate-300 select-none">·</span>
          <div className="flex items-center gap-0.5">
            <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
              <Network size={13} />
              Graph
            </Link>
            <Link href="/search" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold bg-white/[0.09] text-slate-100 transition-colors">
              <Search size={13} />
              Search
            </Link>
          </div>
        </div>
        <span className="text-[12px] text-slate-400 tabular-nums">
          {loading ? "Loading…" : query && results.length > 0
            ? `${results.length} result${results.length !== 1 ? "s" : ""}`
            : !query && !loading
              ? `${files.length.toLocaleString()} files`
              : ""}
        </span>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden" style={{ paddingTop: 56 }}>

        {/* Search bar */}
        <div style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="max-w-3xl mx-auto px-6 py-4 relative">
            <div className="absolute left-10 top-1/2 -translate-y-1/2 pointer-events-none z-10">
              {searching
                ? <Loader2 size={15} className="text-indigo-500" style={{ animation: "spin 0.8s linear infinite" }} />
                : <Search size={15} className="text-slate-400" />}
            </div>
            <input
              ref={inputRef}
              className="search-input w-full rounded-lg py-2.5 pl-10 pr-9 text-[15px]"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
              placeholder={loading ? "Loading…" : `Search ${files.length.toLocaleString()} files…`}
              value={query}
              onChange={handleChange}
              disabled={loading}
            />
            <AnimatePresence>
              {query && (
                <motion.button
                  initial={{ opacity: 0, transform: "scale(0.7)" }}
                  animate={{ opacity: 1, transform: "scale(1)" }}
                  exit={{ opacity: 0, transform: "scale(0.7)" }}
                  transition={{ duration: 0.1 }}
                  onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                  className="absolute right-10 top-1/2 -translate-y-1/2 pressable text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={14} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={22} className="text-slate-300" style={{ animation: "spin 0.9s linear infinite" }} />
            </div>
          ) : !query ? (
            <EmptyState fileCount={files.length} indexedCount={totalIndexed} />
          ) : results.length === 0 && !searching ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-[14px] text-slate-400">No results for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-3">
              {results.map((file, i) => (
                <ResultRow key={file.id} file={file} index={i} onOpen={openFile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ fileCount, indexedCount }: { fileCount: number; indexedCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 select-none pb-16">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(129,140,248,0.12)", border: "1px solid rgba(129,140,248,0.22)" }}
      >
        <Sparkles size={20} style={{ color: "#818cf8" }} />
      </div>
      <div className="text-center">
        <p className="text-[16px] font-semibold text-slate-100">Search your Desktop</p>
        <p className="text-[13px] text-slate-400 mt-1.5">
          {indexedCount > 0
            ? `Semantic search across ${indexedCount.toLocaleString()} of ${fileCount.toLocaleString()} files`
            : `${fileCount.toLocaleString()} files · generate embeddings for semantic search`}
        </p>
      </div>
      {indexedCount > 0 && (
        <div
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium"
          style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", color: "#34d399" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          Semantic search active
        </div>
      )}
    </div>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({ file, index, onOpen }: { file: FileNode; index: number; onOpen: (f: FileNode) => void }) {
  const color = FILE_TYPE_COLORS[file.type as keyof typeof FILE_TYPE_COLORS] ?? "#94a3b8";
  const preview = !isRawMeta(file.preview) ? file.preview : undefined;

  // Shorten path for display: show last 3 segments
  const parts = file.path.split("/").filter(Boolean);
  const shortPath = parts.length > 3
    ? "…/" + parts.slice(-3, -1).join("/")
    : "/" + parts.slice(0, -1).join("/");

  return (
    <motion.div
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0)" }}
      transition={{ delay: Math.min(index * 0.02, 0.3), duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      <button
        onClick={() => onOpen(file)}
        className="w-full text-left group"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "12px 4px",
          transition: "background 120ms",
          borderRadius: 6,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        {/* Thumbnail / type block */}
        <Thumbnail file={file} color={color} />

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-semibold text-slate-100 truncate">{file.name}</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              {file.size > 0 && (
                <span className="text-[11px] text-slate-400 tabular-nums">{formatBytes(file.size)}</span>
              )}
              <span
                className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ color, background: `${color}18` }}
              >
                {file.ext ?? file.type}
              </span>
              <ExternalLink size={12} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">{shortPath}</p>
          {preview && (
            <p className="text-[12px] text-slate-400 mt-1.5 leading-relaxed"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {preview}
            </p>
          )}
        </div>
      </button>
    </motion.div>
  );
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

function Thumbnail({ file, color }: { file: FileNode; color: string }) {
  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">("loading");
  const isImage = file.type === "image";
  const isPdf   = file.type === "pdf";
  const canPreview = isImage || isPdf;

  if (canPreview) {
    return (
      <div
        className="flex-shrink-0 rounded-md overflow-hidden bg-slate-100"
        style={{ width: 48, height: 48 }}
      >
        {isImage ? (
          <>
            {imgState !== "loaded" && (
              <div className="w-full h-full bg-slate-100" />
            )}
            <img
              src={`/api/preview?path=${encodeURIComponent(file.path)}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              style={{ opacity: imgState === "loaded" ? 1 : 0, transition: "opacity 150ms" }}
              onLoad={() => setImgState("loaded")}
              onError={() => setImgState("error")}
            />
            {imgState === "error" && <TypeBlock color={color} ext={file.ext ?? file.type} />}
          </>
        ) : (
          <TypeBlock color={color} ext={file.ext ?? file.type} />
        )}
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 rounded-md overflow-hidden" style={{ width: 48, height: 48 }}>
      <TypeBlock color={color} ext={file.ext ?? file.type} />
    </div>
  );
}

function TypeBlock({ color, ext }: { color: string; ext: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: `${color}14` }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider"
        style={{ color: `${color}cc` }}
      >
        {ext.slice(0, 4)}
      </span>
    </div>
  );
}
