"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2, FileText, Image, Code, Film, Music, Folder, File, type LucideIcon } from "lucide-react";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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

interface Props {
  files: FileNode[];
  onHighlight: (ids: Set<string>) => void;
  onSelectFile: (f: FileNode) => void;
}

export default function SearchBar({ files, onHighlight, onSelectFile }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FileNode[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexedCount = files.filter((f) => f.embedding).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setResults([]);
      setQuery("");
      onHighlight(new Set());
    }
  }, [open, onHighlight]);

  useEffect(() => { setActiveIndex(0); }, [results]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        onHighlight(new Set());
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 10 }),
        });
        if (res.ok) {
          const { results: hits } = await res.json();
          if (hits?.length > 0) {
            const fileMap = Object.fromEntries(files.map((f) => [f.id, f]));
            const found: FileNode[] = hits.map((h: { id: string }) => fileMap[h.id] ?? h).filter(Boolean);
            setResults(found);
            onHighlight(new Set(found.map((f) => f.id)));
            return;
          }
        }
        const lower = q.toLowerCase();
        const found = files.filter((f) => f.name.toLowerCase().includes(lower)).slice(0, 10);
        setResults(found);
        onHighlight(new Set(found.map((f) => f.id)));
      } finally {
        setLoading(false);
      }
    },
    [files, onHighlight]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    search(e.target.value);
  };

  const selectFile = (file: FileNode) => {
    onSelectFile(file);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIndex]) selectFile(results[activeIndex]);
  };

  return (
    <>
      {/* Trigger pill — liquid glass */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 h-10 rounded-full pressable z-40 transition-all duration-200"
        style={{
          background: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: [
            "inset 0 1.5px 0 rgba(255,255,255,0.95)",
            "inset 0 -1px 0 rgba(0,0,0,0.05)",
            "0 0 0 0.5px rgba(0,0,0,0.1)",
            "0 4px 20px rgba(60,60,120,0.14)",
          ].join(", "),
          color: "var(--text-muted)",
          fontSize: 13,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <Search size={13} />
        <span>Search files…</span>
        <kbd
          className="ml-1 text-[11px] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: "rgba(0,0,0,0.06)",
            color: "var(--text-muted)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
          }}
        >
          ⌘K
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50"
              style={{
                background: "rgba(238,240,248,0.5)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
              onClick={() => setOpen(false)}
            />

            {/* Palette card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -6 }}
              transition={{ type: "spring", duration: 0.25, bounce: 0.08 }}
              style={{
                willChange: "transform, opacity",
                background: "rgba(255,255,255,0.82)",
                backdropFilter: "blur(48px) saturate(200%)",
                WebkitBackdropFilter: "blur(48px) saturate(200%)",
                boxShadow: [
                  "inset 0 1.5px 0 rgba(255,255,255,1)",
                  "inset 0 -1px 0 rgba(0,0,0,0.04)",
                  "0 0 0 0.5px rgba(0,0,0,0.1)",
                  "0 24px 64px rgba(60,60,120,0.2)",
                  "0 4px 16px rgba(60,60,120,0.1)",
                ].join(", "),
              }}
              className="fixed top-[15vh] left-1/2 -translate-x-1/2 w-full max-w-2xl mx-4 z-50 rounded-2xl overflow-hidden"
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-5 py-4">
                {loading ? (
                  <Loader2
                    size={16}
                    style={{ color: "var(--accent)", animation: "spin 0.8s linear infinite", flexShrink: 0 }}
                  />
                ) : (
                  <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                )}
                <input
                  ref={inputRef}
                  className="search-input flex-1 text-[16px]"
                  placeholder="Search your Desktop files…"
                  value={query}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                />
                {query ? (
                  <button
                    onClick={() => { setQuery(""); setResults([]); onHighlight(new Set()); }}
                    className="pressable transition-colors flex-shrink-0"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd
                    className="text-[11px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                    style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}
                  >
                    esc
                  </kbd>
                )}
              </div>

              <Separator style={{ background: "rgba(0,0,0,0.07)" }} />

              {/* Results */}
              {results.length > 0 && (
                <ScrollArea className="max-h-[420px]">
                  <div className="py-1.5">
                    <div className="px-4 py-2">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {results.length} result{results.length !== 1 ? "s" : ""}
                        {indexedCount > 0 ? " · semantic" : " · filename"}
                      </span>
                    </div>
                    {results.map((file, i) => {
                      const color = FILE_TYPE_COLORS[file.type] ?? "#64748b";
                      const Icon = TYPE_ICONS[file.type] ?? File;
                      return (
                        <motion.button
                          key={file.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.025, duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                          onClick={() => selectFile(file)}
                          className={`search-result-row w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                            activeIndex === i ? "bg-black/[0.04]" : ""
                          }`}
                          onMouseEnter={() => setActiveIndex(i)}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: `${color}14`,
                              border: `1px solid ${color}30`,
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                            }}
                          >
                            <Icon size={14} style={{ color }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium truncate" style={{ color: "#1c1c1e" }}>
                              {file.name}
                            </p>
                            <p className="text-[11px] truncate font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {file.path}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] flex-shrink-0"
                            style={{ color, borderColor: `${color}40`, backgroundColor: `${color}10` }}
                          >
                            {file.type}
                          </Badge>
                        </motion.button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}

              {/* Empty state */}
              {query && !loading && results.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
                    No files found for &ldquo;{query}&rdquo;
                  </p>
                </div>
              )}

              {!query && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                    {indexedCount > 0
                      ? `${indexedCount} files indexed · type to search semantically`
                      : "Type a filename to search · generate embeddings for semantic search"}
                  </p>
                </div>
              )}

              <Separator style={{ background: "rgba(0,0,0,0.07)" }} />
              <div className="flex items-center gap-4 px-5 py-2.5">
                {[
                  { key: "↑↓", label: "navigate" },
                  { key: "↵", label: "open" },
                  { key: "esc", label: "close" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <kbd
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}
                    >
                      {key}
                    </kbd>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
