"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2 } from "lucide-react";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS } from "@/lib/utils";
import { cosineSimilarity } from "@/lib/client-embed";

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
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘+K focuses the search bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setResults([]);
      onHighlight(new Set());
    }
  }, [open, onHighlight]);

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
          // Semantic search: embed the query, rank by cosine similarity
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
        const found = files
          .filter((f) => f.name.toLowerCase().includes(lower))
          .slice(0, 10);
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
    setOpen(true);
    search(e.target.value);
  };

  const clear = () => {
    setQuery("");
    setOpen(false);
    setResults([]);
    onHighlight(new Set());
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(640px, calc(100vw - 48px))",
        zIndex: 60,
      }}
    >
      {/* Results dropdown */}
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            className="glass"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{ marginBottom: 8, maxHeight: 360, overflowY: "auto" }}
          >
            <div
              className="font-orbitron px-4 py-3"
              style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}
            >
              {results.length} SEMANTIC MATCH{results.length !== 1 ? "ES" : ""}
            </div>
            {results.map((file) => (
              <button
                key={file.id}
                onClick={() => { onSelectFile(file); clear(); }}
                className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all"
                style={{ borderBottom: "1px solid var(--border)", background: "transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,212,255,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: FILE_TYPE_COLORS[file.type],
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${FILE_TYPE_COLORS[file.type]}`,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono-space truncate" style={{ fontSize: 13, color: "var(--text)" }}>
                    {file.name}
                  </div>
                  <div className="truncate" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {file.path}
                  </div>
                </div>
                <span
                  className="type-badge"
                  style={{ color: FILE_TYPE_COLORS[file.type], borderColor: FILE_TYPE_COLORS[file.type], flexShrink: 0 }}
                >
                  {file.type}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div
        className="glass-bright flex items-center gap-3 px-5"
        style={{
          height: 54,
          borderRadius: 4,
          boxShadow: "0 0 40px rgba(0,212,255,0.08), 0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {loading ? (
          <Loader2 size={16} style={{ color: "var(--cyan)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
        ) : (
          <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        )}

        <input
          ref={inputRef}
          className="search-input flex-1"
          placeholder="Search your Desktop files…"
          value={query}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") clear(); }}
        />

        {query && (
          <button onClick={clear} style={{ color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}>
            <X size={14} />
          </button>
        )}
      </div>

      <div
        className="font-orbitron text-center mt-2"
        style={{ fontSize: 8, letterSpacing: "0.15em", color: "var(--text-dim)" }}
      >
        {files.filter((f) => f.embedding).length > 0
          ? `⬡ SEMANTIC SEARCH · ${files.filter((f) => f.embedding).length} FILES INDEXED · ⌘K`
          : "⬡ FILENAME SEARCH · GENERATE EMBEDDINGS FOR SEMANTIC SEARCH · ⌘K"}
      </div>
    </div>
  );
}
