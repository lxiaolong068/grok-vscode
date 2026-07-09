export interface FileChip {
  id: string;
  path: string;
  relPath: string;
  selectionStart?: number;
  selectionEnd?: number;
  hidden: boolean;
}

export function makeImplicitChip(absPath: string, relPath: string): FileChip {
  return {
    id: `implicit:${absPath}`,
    path: absPath,
    relPath,
    hidden: false,
  };
}

let explicitChipCounter = 0;

export function makeExplicitChip(
  absPath: string,
  relPath: string,
  selectionStart?: number,
  selectionEnd?: number,
): FileChip {
  explicitChipCounter += 1;
  return {
    id: `explicit:${absPath}:${selectionStart ?? 0}-${selectionEnd ?? 0}:${explicitChipCounter}`,
    path: absPath,
    relPath,
    selectionStart,
    selectionEnd,
    hidden: false,
  };
}

export function removeChip(chips: FileChip[], id: string): FileChip[] {
  return chips.filter((c) => c.id !== id);
}

export function toggleChip(chips: FileChip[], id: string): FileChip[] {
  return chips.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c));
}

export function clearImplicitChips(chips: FileChip[]): FileChip[] {
  return chips.filter((c) => !isImplicitChip(c));
}

/** An implicit chip is the active-editor file auto-added for ambient context
 *  (vs. a file the user explicitly attached). The id prefix is the source of
 *  truth — set by makeImplicitChip / makeExplicitChip. */
export function isImplicitChip(chip: FileChip): boolean {
  return chip.id.startsWith("implicit:");
}
