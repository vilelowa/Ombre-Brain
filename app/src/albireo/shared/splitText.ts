const splitPattern = /(?:\r?\n){2,}|\s*\[SPLIT\]\s*/;

export function splitAssistantText(content: string): string[] {
  const segments = content
    .split(splitPattern)
    .map((segment) => segment.replace(/^-{3,}$/gm, '').trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [content.trim()].filter(Boolean);
}

export function normalizeAssistantText(content: string): string {
  return content.replace(/\s*\[SPLIT\]\s*/g, '\n\n');
}
