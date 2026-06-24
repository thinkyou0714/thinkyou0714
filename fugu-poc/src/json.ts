/**
 * Loose JSON extraction for structured-output parsing — tolerates ```json code
 * fences and leading/trailing prose around the JSON value. Zero dependencies.
 */

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to bracket extraction
  }

  const start = candidate.search(/[{[]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1));
  }
  throw new SyntaxError("No JSON value found in text.");
}
