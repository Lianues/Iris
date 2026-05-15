/**
 * Shared pure transforms for line-based edit tools.
 *
 * These helpers intentionally mirror insert_code/delete_code handler behavior so
 * diff previews and actual execution validate and transform text consistently.
 */

export interface InsertCodeTransformResult {
  newContent: string;
  insertedLines: number;
}

export interface DeleteCodeTransformResult {
  newContent: string;
  deletedLines: number;
}

export function applyInsertCodeTransform(
  originalContent: string,
  line: number,
  contentToInsert: string,
): InsertCodeTransformResult {
  const lines = originalContent.split('\n');
  const totalLines = lines.length;

  if (line < 1 || line > totalLines + 1) {
    throw new Error(`行号 ${line} 超出范围（1~${totalLines + 1}）`);
  }

  const insertLines = contentToInsert.split('\n');
  const idx = line - 1;
  const newLines = [
    ...lines.slice(0, idx),
    ...insertLines,
    ...lines.slice(idx),
  ];

  return {
    newContent: newLines.join('\n'),
    insertedLines: insertLines.length,
  };
}

export function applyDeleteCodeTransform(
  originalContent: string,
  startLine: number,
  endLine: number,
): DeleteCodeTransformResult {
  const lines = originalContent.split('\n');
  const totalLines = lines.length;

  if (startLine < 1 || startLine > totalLines) {
    throw new Error(`start_line ${startLine} 超出范围（1~${totalLines}）`);
  }
  if (endLine < startLine || endLine > totalLines) {
    throw new Error(`end_line ${endLine} 超出范围（${startLine}~${totalLines}）`);
  }

  const newLines = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)];
  return {
    newContent: newLines.join('\n'),
    deletedLines: endLine - startLine + 1,
  };
}
