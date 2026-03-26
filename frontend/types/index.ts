export type FileType = "image" | "text" | "code" | "pdf" | "video" | "audio" | "folder" | "other";

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: FileType;
  size: number;
  modified: string;
  ext: string;
  embedding?: number[];
  preview?: string;
  community?: number;   // Neo4j label propagation community ID
  degree?: number;      // number of SIMILAR_TO edges
  indexed?: boolean;
  // force-graph properties
  val?: number;
  x?: number;
  y?: number;
  z?: number;
  color?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  value: number; // cosine similarity 0–1
}

export interface GraphData {
  nodes: FileNode[];
  links: GraphLink[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  favicon?: string;
}

export interface EmbedResponse {
  embedding: number[];
  preview?: string;
  error?: string;
}
