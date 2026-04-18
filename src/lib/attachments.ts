/**
 * Attachment helpers — FE 측 타입 정의 + Tauri 저장/삭제 래퍼 + prompt 렌더러.
 *
 * 저장 흐름:
 *   1. 파일(File or Uint8Array) → base64 인코딩
 *   2. `save_attachment(projectPath, name, base64)` 호출
 *   3. 반환된 `{ absPath, relPath, size }` 를 UI state 에 보관
 *
 * 전송 흐름 (useSendActions 쪽):
 *   - prompt 끝에 `appendAttachmentsToPrompt(prompt, attachments)` 로 경로 섹션 append
 *   - Codex 엔진일 땐 PR C 에서 추가로 `--image` argv 전달 (미구현)
 */
import { invoke } from "@tauri-apps/api/core";

export interface Attachment {
  id: string;
  /** Absolute path on disk. Used for Codex `--image` / delete command. */
  absPath: string;
  /** Path relative to project root. Shown in prompt + UI. */
  relPath: string;
  /** Original filename (pre-sanitize). UI label only. */
  name: string;
  size: number;
  mimeType: string;
  isImage: boolean;
  /** Object URL for image preview. Must be revoked when attachment is removed. */
  previewUrl?: string;
}

export interface SavedAttachmentResponse {
  absPath: string;
  relPath: string;
  size: number;
}

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB

// ─── Helpers ────────────────────────────────────────────────────────────────

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** `data:image/png;base64,AAAA...` 에서 payload 만 추출. plain base64 면 그대로 리턴. */
function extractBase64Payload(s: string): string {
  const m = s.match(/^data:[^;]+;base64,(.+)$/);
  return m ? m[1] : s;
}

async function fileToBase64(bytes: Uint8Array): Promise<string> {
  // 20MB 파일을 한 번에 string concat 하면 느릴 수 있지만
  // btoa/FileReader 사용하면 수십ms 수준. 실용적 타협.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

// ─── Save / Delete ──────────────────────────────────────────────────────────

/** Save a file to `<project>/.tunaflow/attachments/` via Rust command.
 *  Throws if projectPath missing, file oversized, or disk write fails. */
export async function saveAttachment(
  projectPath: string,
  name: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<Attachment> {
  if (bytes.byteLength > MAX_ATTACHMENT_SIZE) {
    throw new Error(`파일 크기가 너무 큽니다 (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, 최대 20MB)`);
  }
  const base64 = await fileToBase64(bytes);
  const saved = await invoke<SavedAttachmentResponse>("save_attachment", {
    projectPath,
    name,
    dataBase64: extractBase64Payload(base64),
  });
  const isImage = isImageMime(mimeType);
  return {
    id: crypto.randomUUID(),
    absPath: saved.absPath,
    relPath: saved.relPath,
    name,
    size: saved.size,
    mimeType,
    isImage,
    previewUrl: isImage ? URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mimeType })) : undefined,
  };
}

export async function deleteAttachment(att: Attachment): Promise<void> {
  if (att.previewUrl) {
    try { URL.revokeObjectURL(att.previewUrl); } catch { /* ignore */ }
  }
  try {
    await invoke("delete_attachment", { absPath: att.absPath });
  } catch (e) {
    console.warn("[attachments] delete failed:", e);
    // 로컬 state 에서는 제거해도 되도록 에러 삼킴
  }
}

/** Append attachment paths to user prompt. Used right before send. */
export function appendAttachmentsToPrompt(prompt: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return prompt;
  const lines = attachments.map((a) => {
    const sizeLabel = a.size > 1024 * 1024
      ? `${(a.size / 1024 / 1024).toFixed(1)}MB`
      : `${(a.size / 1024).toFixed(0)}KB`;
    return `- ${a.relPath} (${a.name}, ${sizeLabel})`;
  });
  return [
    prompt.trim(),
    "",
    "[첨부 파일]",
    ...lines,
    "",
    "위 파일의 내용을 확인하려면 Read 툴로 해당 경로를 읽으세요. 이미지는 vision 분석 가능합니다.",
  ].join("\n");
}

/** Sum of all attachment sizes in bytes. */
export function totalAttachmentSize(attachments: Attachment[]): number {
  return attachments.reduce((sum, a) => sum + a.size, 0);
}
