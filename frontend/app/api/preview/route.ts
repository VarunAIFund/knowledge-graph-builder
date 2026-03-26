import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { resolve, join } from "path";
import { lookup } from "mime-types";

const DESKTOP = join(process.env.HOME ?? "/Users", "Desktop");
const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "no path" }, { status: 400 });

  const resolved = resolve(filePath);

  // Security: only serve from Desktop
  if (!resolved.startsWith(DESKTOP)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const mimeType = lookup(resolved) || "application/octet-stream";

  // Only serve image and PDF files
  if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
    return NextResponse.json({ error: "not previewable" }, { status: 415 });
  }

  try {
    const data = await readFile(resolved);
    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
