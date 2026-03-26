"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Loader2, Network, X,
  FileText, Image, Code, Film, Music, Folder, File,
  type LucideIcon,
} from "lucide-react";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS, formatBytes } from "@/lib/utils";
import { cosineSimilarity } from "@/lib/client-embed";

const TYPE_ICONS: Record<string, LucideIcon> = {
  image: Image, text: FileText, code: Code, pdf: FileText,
  video: Film, audio: Music, folder: Folder, other: File,
};

export default function SearchPage() {
  const [files, setFiles]       = useState<FileNode[]>([]);
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<FileNode[]>([]);
  const [loading, setLoading]   = useState(true);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data) => {
        const loaded: FileNode[] = data.files ?? [];
        setFiles(loaded);
        setResults([]);  // Don't show anything until a query is entered
        setLoading(false);
      });
  }, []);

  // Focus search on mount
  useEffect(() => {
    if (!loading) setTimeout(() => inputRef.current?.focus(), 100);
  }, [loading]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const embeddedFiles = files.filter((f) => f.embedding);
        if (embeddedFiles.length > 0) {
          const res = await fetch("/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "__query__", type: "text", queryText: q }),
          });
          if (res.ok) {
            const { embedding } = await res.json();
            if (embedding) {
              const scored = embeddedFiles
                .map((f) => ({ file: f, score: cosineSimilarity(embedding, f.embedding!) }))
                .filter((x) => x.score > 0.25)
                .sort((a, b) => b.score - a.score);
              if (scored.length > 0) {
                setResults(scored.map((x) => x.file).slice(0, 20));
                return;
              }
            }
          }
        }
        // Fallback: filename match
        const lower = q.toLowerCase();
        setResults(files.filter((f) => f.name.toLowerCase().includes(lower)).slice(0, 20));
      } finally {
        setSearching(false);
      }
    },
    [files]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  };

  const clearSearch = () => {
    setQuery("");
    setResults(files);
    inputRef.current?.focus();
  };

  const openFile = (file: FileNode) => {
    fetch(`/api/open?path=${encodeURIComponent(file.path)}&action=open`, { method: "POST" });
  };

  return (
    <div className="app-bg w-screen h-screen overflow-hidden flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="glass fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-5"
        style={{ height: 56, borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0 }}
      >
        {/* Logo + tabs */}
        <div className="flex items-center gap-3">
          <span className="font-orbitron font-black text-[15px] tracking-wide text-slate-800">
            Neural<span className="text-indigo-500">Vault</span>
          </span>
          <span className="text-slate-300 select-none">·</span>
          <div className="flex items-center gap-0.5">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-500 hover:text-slate-700 hover:bg-black/[0.05] transition-colors"
            >
              <Network size={13} />
              Graph
            </Link>
            <Link
              href="/search"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold bg-black/[0.07] text-slate-800 transition-colors"
            >
              <Search size={13} />
              Search
            </Link>
          </div>
        </div>

        {/* Result count */}
        <span className="text-[12px] text-slate-400">
          {loading ? "Loading…" : query && results.length > 0 ? `${results.length} result${results.length !== 1 ? "s" : ""}` : ""}
        </span>
      </header>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden" style={{ paddingTop: 56 }}>

        {/* Search bar */}
        <div
          className="px-6 py-4"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div className="max-w-2xl mx-auto relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
              {searching
                ? <Loader2 size={16} className="text-indigo-500" style={{ animation: "spin 0.8s linear infinite" }} />
                : <Search size={16} className="text-slate-400" />
              }
            </div>
            <input
              ref={inputRef}
              className="search-input w-full rounded-xl py-3 pl-11 pr-10 text-[15px]"
              style={{
                background: "white",
                border: "1px solid rgba(0,0,0,0.1)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              }}
              placeholder="Search files by name, content, or meaning…"
              value={query}
              onChange={handleChange}
            />
            <AnimatePresence>
              {query && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pressable text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={15} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* File grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={28} className="text-indigo-500" style={{ animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : !query ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 select-none" style={{ paddingBottom: 80 }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.08)" }}>
                <Search size={28} className="text-indigo-400" />
              </div>
              <p className="text-[15px] font-medium text-slate-600">Search your Desktop</p>
              <p className="text-[13px] text-slate-400 text-center max-w-xs leading-relaxed">
                Type to search by filename or meaning —{" "}
                {files.length > 0 ? `${files.length} files indexed` : "loading files…"}
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-2">
              <Search size={28} className="text-slate-200" />
              <p className="text-[14px] text-slate-400">No files found for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 12,
              }}
            >
              {results.map((file, i) => (
                <FileCard key={file.id} file={file} index={i} onOpen={openFile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── File card ────────────────────────────────────────────────────────────────

function FileCard({
  file,
  index,
  onOpen,
}: {
  file: FileNode;
  index: number;
  onOpen: (f: FileNode) => void;
}) {
  const color = FILE_TYPE_COLORS[file.type as keyof typeof FILE_TYPE_COLORS] ?? "#64748b";
  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">("loading");

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.015, 0.4), duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      onClick={() => onOpen(file)}
      title={`Open ${file.name}`}
      className="pressable text-left rounded-xl overflow-hidden border border-black/[0.07] bg-white shadow-sm hover:shadow-md hover:border-black/[0.13] transition-all duration-150 group"
      style={{ display: "flex", flexDirection: "column" }}
    >
      {/* Preview area */}
      <div className="relative overflow-hidden bg-slate-50 flex-shrink-0" style={{ height: 160 }}>
        {file.type === "image" ? (
          <>
            {/* Skeleton shown while loading */}
            {imgState === "loading" && (
              <div className="absolute inset-0 bg-slate-100 animate-pulse" />
            )}
            {/* Actual image — always rendered so onLoad/onError fire */}
            <img
              src={`/api/preview?path=${encodeURIComponent(file.path)}`}
              alt={file.name}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              style={{ opacity: imgState === "loaded" ? 1 : 0, transition: "opacity 0.2s" }}
              onLoad={() => setImgState("loaded")}
              onError={() => setImgState("error")}
            />
            {/* Fallback icon shown only on error */}
            {imgState === "error" && <IconPreview file={file} color={color} />}
          </>
        ) : file.type === "pdf" ? (
          <PdfPreview path={file.path} />
        ) : (
          <IconPreview file={file} color={color} />
        )}

        {/* Type badge overlay */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={{
            background: color,
            color: "white",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}
        >
          {file.type}
        </div>
      </div>

      {/* Metadata */}
      <div className="p-3 flex-1 flex flex-col gap-1">
        <p
          className="text-[13px] font-semibold text-slate-800 truncate leading-tight"
          title={file.name}
        >
          {file.name}
        </p>
        <div className="flex items-center justify-between">
          {file.ext && (
            <span className="text-[10px] font-mono text-slate-400 uppercase">.{file.ext}</span>
          )}
          {file.size > 0 && (
            <span className="text-[11px] text-slate-400 ml-auto">{formatBytes(file.size)}</span>
          )}
        </div>
        {file.preview && (
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
            {file.preview}
          </p>
        )}
      </div>
    </motion.button>
  );
}

// ── PDF preview — first-page embed ───────────────────────────────────────────

function PdfPreview({ path }: { path: string }) {
  const [error, setError] = useState(false);
  const src = `/api/preview?path=${encodeURIComponent(path)}`;

  if (error) {
    return <IconPreview file={{ type: "pdf" } as FileNode} color="#FF6B00" />;
  }

  return (
    <div className="w-full h-full overflow-hidden bg-white">
      <iframe
        src={src}
        title="PDF preview"
        style={{
          width: "115%",
          height: "115%",
          border: "none",
          pointerEvents: "none",
          transform: "scale(0.87)",
          transformOrigin: "top left",
        }}
        onError={() => setError(true)}
      />
    </div>
  );
}

// ── Icon fallback for non-image/pdf files ─────────────────────────────────────

function IconPreview({ file, color }: { file: FileNode; color: string }) {
  const Icon = TYPE_ICONS[file.type] ?? File;
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-3"
      style={{
        background: `linear-gradient(145deg, ${color}15, ${color}06)`,
      }}
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: `${color}20`, border: `1.5px solid ${color}35` }}
      >
        <Icon size={22} style={{ color }} />
      </div>
      {(file as FileNode).preview && (
        <p
          className="text-[10px] text-center px-3 leading-relaxed font-mono"
          style={{ color: `${color}99`, maxWidth: "90%", overflow: "hidden" }}
        >
          {(file as FileNode).preview!.slice(0, 100)}
        </p>
      )}
    </div>
  );
}
