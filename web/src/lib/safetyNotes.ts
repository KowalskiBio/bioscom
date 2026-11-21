function uniqueSafetyNotes(parts: string[]): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const note = part.trim();
    if (note === "") continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
  }

  return notes;
}

/** Parse new editor input without splitting meaningful multi-word notes. */
export function parseSafetyNoteInput(input: string): string[] {
  return uniqueSafetyNotes(input.split(","));
}

/** Parse stored values, including legacy notes that used only spaces. */
export function parseStoredSafetyNotes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parts = value.includes(",") ? value.split(",") : value.split(/\s+/);
  return uniqueSafetyNotes(parts);
}

export function safetyNotesForInput(value: unknown): string {
  return parseStoredSafetyNotes(value).join(", ");
}
