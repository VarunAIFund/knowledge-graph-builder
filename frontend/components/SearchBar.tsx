"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2, FileText, Image, Code, Film, Music, Folder, File, type LucideIcon } from "lucide-react";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";
import { cosineSimilarity } from "@/lib/client-embed";
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

  // ⌘K opens the palette
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

  // Focus input when palette opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setResults([]);
      setQuery("");
      onHighlight(new Set());
    }
  }, [open, onHighlight]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        onHighlight(new Set());
        return;
      }
      setLoading(true);
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
                .filter((x) => x.score > 0.35)
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);
              const found = scored.map((x) => x.file);
              setResults(found);
              onHighlight(new Set(found.map((f) => f.id)));
              return;
            }
          }
        }
        // Fallback: fuzzy filename match
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
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      selectFile(results[activeIndex]);
    }
  };

  return (
    <>
      {/* Trigger pill */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 h-10 rounded-full
          bg-white/[0.07] border border-white/[0.1] text-[13px] text-slate-400
          hover:bg-white/[0.12] hover:text-slate-200 hover:border-white/[0.2]
          transition-all duration-150 pressable z-40"
        style={{ backdropFilter: "blur(16px)", boxShadow: "0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)" }}
      >
        <Search size={13} />
        <span>Search files…</span>
        <kbd className="ml-1 text-[11px] bg-white/[0.08] text-slate-400 px-1.5 py-0.5 rounded font-mono">
          ⌘K
        </kbd>
      </button>

      {/* Command palette overlay */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/40"
              style={{ backdropFilter: "blur(4px)" }}
              onClick={() => setOpen(false)}
            />

            {/* Palette card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ type: "spring", duration: 0.25, bounce: 0.1 }}
              style={{ willChange: "transform, opacity" }}
              className="fixed top-[15vh] left-1/2 -translate-x-1/2 w-full max-w-2xl mx-4 z-50
                glass rounded-xl overflow-hidden shadow-2xl"
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-5 py-4">
                {loading ? (
                  <Loader2
                    size={16}
                    className="text-indigo-500 flex-shrink-0"
                    style={{ animation: "spin 0.8s linear infinite" }}
                  />
                ) : (
                  <Search size={16} className="text-slate-400 flex-shrink-0" />
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
                    className="pressable text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd className="text-[11px] bg-white/[0.08] text-slate-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                    esc
                  </kbd>
                )}
              </div>

              <Separator className="bg-white/[0.08]" />

              {/* Results */}
              {results.length > 0 && (
                <ScrollArea className="max-h-[420px]">
                  <div className="py-1.5">
                    <div className="px-4 py-2">
                      <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
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
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            delay: i * 0.03,
                            duration: 0.14,
                            ease: [0.23, 1, 0.32, 1],
                          }}
                          onClick={() => selectFile(file)}
                          className={`search-result-row w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                            activeIndex === i ? "bg-white/[0.07]" : ""
                          }`}
                          onMouseEnter={() => setActiveIndex(i)}
                        >
                          {/* File type icon */}
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: `${color}14`,
                              border: `1px solid ${color}28`,
                            }}
                          >
                            <Icon size={14} style={{ color }} />
                          </div>

                          {/* Name + path */}
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium text-slate-100 truncate">
                              {file.name}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate font-mono mt-0.5">
                              {file.path}
                            </p>
                          </div>

                          {/* Type badge */}
                          <Badge
                            variant="outline"
                            className="text-[10px] flex-shrink-0"
                            style={{
                              color,
                              borderColor: `${color}40`,
                              backgroundColor: `${color}10`,
                            }}
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
                  <p className="text-[14px] text-slate-400">No files found for &ldquo;{query}&rdquo;</p>
                </div>
              )}

              {/* Empty query state */}
              {!query && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px] text-slate-400">
                    {indexedCount > 0
                      ? `${indexedCount} files indexed · type to search semantically`
                      : "Type a filename to search · generate embeddings for semantic search"}
                  </p>
                </div>
              )}

              {/* Footer hints */}
              <Separator className="bg-white/[0.08]" />
              <div className="flex items-center gap-4 px-5 py-2.5">
                {[
                  { key: "↑↓", label: "navigate" },
                  { key: "↵", label: "open" },
                  { key: "esc", label: "close" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <kbd className="text-[10px] bg-white/[0.08] text-slate-500 px-1.5 py-0.5 rounded font-mono">
                      {key}
                    </kbd>
                    <span className="text-[11px] text-slate-400">{label}</span>
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
