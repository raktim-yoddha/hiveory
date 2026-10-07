/**
 * Live output chunks carry the offset they start at; the snapshot ends at
 * `written`. Returns the part of a chunk not shown yet (or '' for one already
 * in the snapshot) and the new end, exactly like the desktop's terminal registry.
 */
export const mergeChunk = (written: number, data: string, offset: number): { write: string; written: number } => {
  const end = offset + data.length
  if (end <= written) return { write: '', written }
  return { write: offset >= written ? data : data.slice(written - offset), written: end }
}
