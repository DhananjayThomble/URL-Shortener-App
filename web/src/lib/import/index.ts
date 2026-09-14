import { genericCsv } from "./sources/generic-csv";
import type { ImportSource } from "./types";

/**
 * The registry of import sources, in the order they appear in the picker.
 *
 * PR1 ships only the generic CSV source. Bitly / YOURLS / Kutt / Dub each add
 * their entry here in their own PR, reusing the same parse → prepare → bulk
 * pipeline, so a new source never touches the submit code or the UI.
 */
export const IMPORT_SOURCES: ImportSource[] = [genericCsv];

export function getImportSource(id: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((s) => s.id === id);
}

export * from "./types";
export { prepareRows, chunk, BATCH_SIZE, COMMENT_MAX } from "./to-links";
export { parseCsv, parseCsvRecords, pick, normalizeHeader } from "./csv";
