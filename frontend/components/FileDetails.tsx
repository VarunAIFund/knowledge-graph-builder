"use client";
import { motion } from "framer-motion";
import { X, ExternalLink, Clock, HardDrive, Tag, FileText, Image, Code, Film, Music, Folder, File, type LucideIcon } from "lucide-react";
import { formatDate } from "date-fns";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS, formatBytes } from "@/lib/utils";

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
  file: FileNode;
  onClose: () => void;
}

export default function FileDetails({ file, onClose }: Props) {
  const color = FILE_TYPE_COLORS[file.type] ?? "#64748B";
  const Icon = TYPE_ICONS[file.type] ?? File;
  const modDate = file.modified ? new Date(parseFloat(file.modified) * 1000) : null;

  const openFile = () => {
    // Open file via API (server-side open command)
    fetch(`/api/open?path=${encodeURIComponent(file.path)}`, { method: "POST" });
  };

  return (
    <motion.div
      className="glass"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      style={{
        position: "fixed",
        right: 16,
        top: 72,
        bottom: 16,
        width: 320,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        zIndex: 50,
        overflowY: "auto",
        borderColor: `${color}33`,
      }}
    >
      {/* Close */}
      <div className="flex items-center justify-between">
        <span
          className="type-badge"
          style={{ color, borderColor: color }}
        >
          {file.type}
        </span>
        <button
          onClick={onClose}
          style={{ color: "var(--text-muted)", lineHeight: 1 }}
          className="hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Icon + Name */}
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <div
          className="relative"
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: `2px solid ${color}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
          }}
        >
          <div className="pulse-ring" style={{ borderColor: color }} />
          <Icon size={28} color={color} />
        </div>
        <div>
          <p
            className="font-mono-space text-sm leading-tight"
            style={{
              color: "var(--text)",
              wordBreak: "break-all",
              maxHeight: 64,
              overflow: "hidden",
            }}
          >
            {file.name}
          </p>
          {file.ext && (
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-space-mono)" }}>
              .{file.ext.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${color}44, transparent)` }} />

      {/* Metadata */}
      <div className="flex flex-col gap-3">
        {file.size > 0 && (
          <MetaRow icon={<HardDrive size={13} />} label="Size" value={formatBytes(file.size)} />
        )}
        {modDate && (
          <MetaRow
            icon={<Clock size={13} />}
            label="Modified"
            value={formatDate(modDate, "MMM d, yyyy · HH:mm")}
          />
        )}
        <MetaRow
          icon={<Tag size={13} />}
          label="Type"
          value={file.type.charAt(0).toUpperCase() + file.type.slice(1)}
          valueColor={color}
        />
      </div>

      {/* Preview / AI description */}
      {file.preview && (
        <>
          <div style={{ height: 1, background: "var(--border)" }} />
          <div>
            <p
              className="font-orbitron"
              style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 8 }}
            >
              AI DESCRIPTION
            </p>
            <p
              style={{
                fontSize: 12,
                color: "var(--text)",
                lineHeight: 1.6,
                fontFamily: "var(--font-outfit)",
              }}
            >
              {file.preview}
            </p>
          </div>
        </>
      )}

      {/* Embedding status */}
      <div style={{ height: 1, background: "var(--border)" }} />
      <div className="flex items-center gap-2">
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: file.embedding ? "var(--green)" : "var(--text-dim)",
            boxShadow: file.embedding ? "0 0 8px var(--green)" : "none",
          }}
        />
        <span
          className="font-orbitron"
          style={{ fontSize: 9, letterSpacing: "0.1em", color: file.embedding ? "var(--green)" : "var(--text-muted)" }}
        >
          {file.embedding ? "EMBEDDED · INDEXED" : "NOT YET EMBEDDED"}
        </span>
      </div>

      {/* Path */}
      <div
        className="font-mono-space"
        style={{
          fontSize: 10,
          color: "var(--text-dim)",
          wordBreak: "break-all",
          lineHeight: 1.5,
          marginTop: "auto",
          paddingTop: 8,
        }}
      >
        {file.path}
      </div>

      {/* Open button */}
      <button
        onClick={openFile}
        className="btn-neon w-full justify-center"
        style={{ borderColor: color, color, background: `${color}10` }}
      >
        <ExternalLink size={12} />
        Open in Finder
      </button>
    </motion.div>
  );
}

function MetaRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {icon}
        <span className="font-orbitron" style={{ fontSize: 9, letterSpacing: "0.1em" }}>
          {label.toUpperCase()}
        </span>
      </div>
      <span
        className="font-mono-space"
        style={{ fontSize: 11, color: valueColor ?? "var(--text)", textAlign: "right" }}
      >
        {value}
      </span>
    </div>
  );
}
