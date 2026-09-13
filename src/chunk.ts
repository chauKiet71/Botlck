export interface TextChunk {
  index: number;
  content: string;
  locator: string;
}

function cleanText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

export function chunkDocument(input: string, maxChars: number, overlapChars: number): TextChunk[] {
  const text = cleanText(input);
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maxChars);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      const candidate = Math.max(paragraphBreak, sentenceBreak);
      if (candidate > cursor + Math.floor(maxChars * 0.55)) {
        end = candidate + (candidate === sentenceBreak ? 1 : 0);
      }
    }

    const content = text.slice(cursor, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        locator: `chunk:${chunks.length + 1}`,
      });
    }

    if (end >= text.length) break;
    const nextCursor = Math.max(cursor + 1, end - overlapChars);
    cursor = nextCursor;
  }

  return chunks;
}
