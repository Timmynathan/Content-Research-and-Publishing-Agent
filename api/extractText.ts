import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "./_lib/auth.js";
import { HttpError } from "./_lib/errors.js";
import { callClaudeForJsonWithFile } from "./_lib/anthropic.js";

// Text extraction for the "supporting material" upload on the new-request
// form. Claude reads PDFs and images natively (its document/vision
// input), so this needs no OCR or PDF-parsing library of its own.
// DOC/DOCX aren't a media type Claude's API accepts as a document block —
// rejected here with a clear message rather than silently mishandled.
const SUPPORTED_MEDIA_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

// Base64 payload ceiling — comfortably under typical serverless request
// body limits while covering any real "supporting notes" PDF or photo.
// A raw file this size becomes ~13.3MB once base64-encoded.
const MAX_BASE64_LENGTH = 10 * 1024 * 1024 * 1.37;

interface ExtractTextInput {
  extracted_text: string;
}

const EXTRACT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    extracted_text: {
      type: "string",
      description: "All readable text from the file, transcribed as plain text. Empty string if none.",
    },
  },
  required: ["extracted_text"],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await requireStaff(req.headers.authorization);

    const { filename, mediaType, dataBase64 } = req.body ?? {};

    if (typeof mediaType !== "string" || !SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      throw new HttpError(
        400,
        "Unsupported file type — PDF or image (PNG/JPEG/WebP/GIF) only. For a Word document, export or print it to PDF first.",
      );
    }
    if (typeof dataBase64 !== "string" || !dataBase64) {
      throw new HttpError(400, "No file data received.");
    }
    if (dataBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpError(400, "File is too large — please keep uploads under 10MB.");
    }

    const result = await callClaudeForJsonWithFile<ExtractTextInput>({
      system:
        "You transcribe the readable text content of an uploaded file exactly as it appears, without summarizing, commenting on, or adding to it.",
      prompt: `Extract all readable text from this file${typeof filename === "string" && filename ? ` (${filename})` : ""}. Return it as plain text, preserving paragraph breaks. If the file has no readable text, return an empty string.`,
      fileBase64: dataBase64,
      mediaType: mediaType as "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      toolName: "record_extracted_text",
      toolDescription: "Record the transcribed text from the file.",
      inputSchema: EXTRACT_TOOL_SCHEMA,
      maxTokens: 8192,
    });

    res.status(200).json({ text: result.extracted_text ?? "" });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
