"use client";
import { motion } from "framer-motion";
import {
  X, ExternalLink, Clock, HardDrive, Tag,
  FileText, Image, Code, Film, Music, Folder, File,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import type { FileNode } from "@/types";
import { FILE_TYPE_COLORS, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LiquidButton } from "@/components/ui/liquid-glass-button";

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
  const color = FILE_TYPE_COLORS[file.type] ?? "#64748b";
  const Icon = TYPE_ICONS[file.type] ?? File;
  const modDate = file.modified ? new Date(parseFloat(file.modified) * 1000) : null;

  const openFile = () => {
    fetch(`/api/open?path=${encodeURIComponent(file.path)}`, { method: "POST" });
  };

  return (
    <motion.div
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0.1 }}
      style={{ willChange: "transform, opacity" }}
      className="glass fixed right-4 top-[72px] bottom-4 w-[320px] rounded-2xl z-50 flex flex-col overflow-hidden"
    >
      <ScrollArea className="flex-1">
        <div className="p-5 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <Badge
              variant="outline"
              className="text-[11px] font-medium"
              style={{
                color,
                borderColor: `${color}50`,
                backgroundColor: `${color}12`,
              }}
            >
              {file.type}
            </Badge>
            <button
              onClick={onClose}
              className="pressable w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.06)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* File identity */}
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: `${color}14`,
                border: `1px solid ${color}28`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.8)`,
              }}
            >
              <Icon size={24} style={{ color }} />
            </div>
            <div className="space-y-1 w-full">
              <p className="text-[15px] font-semibold leading-tight break-words px-2" style={{ color: "var(--text)" }}>
                {file.name}
              </p>
              {file.ext && (
                <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  .{file.ext}
                </p>
              )}
            </div>
          </div>

          <Separator style={{ background: "rgba(0,0,0,0.07)" }} />

          {/* Metadata */}
          <div className="flex flex-col gap-3">
            {file.size > 0 && (
              <MetaRow
                icon={<HardDrive size={13} />}
                label="Size"
                value={formatBytes(file.size)}
              />
            )}
            {modDate && (
              <MetaRow
                icon={<Clock size={13} />}
                label="Modified"
                value={format(modDate, "MMM d, yyyy · HH:mm")}
              />
            )}
            <MetaRow
              icon={<Tag size={13} />}
              label="Type"
              value={file.type.charAt(0).toUpperCase() + file.type.slice(1)}
              valueColor={color}
            />
          </div>

          {/* AI Summary */}
          {file.preview && (
            <>
              <Separator style={{ background: "rgba(0,0,0,0.07)" }} />
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Summary
                </p>
                <div
                  className="rounded-xl p-3"
                  style={{
                    background: "rgba(0,0,0,0.03)",
                    border: "1px solid rgba(0,0,0,0.06)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                  }}
                >
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
                    {file.preview}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Index status */}
          <div className="flex items-center gap-2 pt-1">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: file.embedding ? "var(--green)" : "var(--text-dim)",
                boxShadow: file.embedding ? "0 0 5px rgba(52,199,89,0.5)" : "none",
              }}
            />
            <span className="text-[12px]" style={{ color: file.embedding ? "var(--green)" : "var(--text-muted)" }}>
              {file.embedding ? "Indexed · semantic search ready" : "Not indexed"}
            </span>
          </div>

          {/* Path */}
          <p className="font-mono text-[10px] break-all leading-relaxed" style={{ color: "var(--text-dim)" }}>
            {file.path}
          </p>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div
        className="p-4"
        style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}
      >
        <LiquidButton
          size="default"
          className="w-full"
          onClick={openFile}
        >
          <ExternalLink size={13} />
          Open in Finder
        </LiquidButton>
      </div>
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
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0" style={{ color: "var(--text-muted)" }}>
        {icon}
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <span
        className="text-[13px] text-right shrink-0"
        style={{ color: valueColor ?? "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}
