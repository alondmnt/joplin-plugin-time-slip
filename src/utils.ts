export function formatLocalTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA'); // This format gives YYYY-MM-DD
}

export function getTimezoneOffset(date: Date): string {
  const mins = -date.getTimezoneOffset(); // getTimezoneOffset returns negative for ahead of UTC
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

export function formatTime(date: Date, includeTimezone: boolean = false): string {
  const time = date.toLocaleTimeString('en-US', { hour12: false });
  return includeTimezone ? `${time}${getTimezoneOffset(date)}` : time;
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  const pad = (num: number) => num.toString().padStart(2, '0');
  
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
}

/**
 * Parse a YYYY-MM-DD date string as midnight in the user's own timezone.
 *
 * Do not use new Date(dateStr) for this. A date-only string is an ISO form, and
 * the language parses those as UTC. Anywhere west of Greenwich that instant is
 * still the previous local day, so a filter for the 1st selected the 31st (#3).
 * Task timestamps are parsed from "YYYY-MM-DD HH:MM:SS", which is not an ISO
 * form and so is read as local, and the two have to be in the same frame to be
 * compared at all.
 *
 * Returns null for anything that is not a real YYYY-MM-DD date, which callers
 * read as "no bound". The shape alone is not enough: Date rolls impossible days
 * over silently, so 2025-13-01 would come back as 2026-01-01 and 2025-02-31 as
 * 2025-03-03, quietly filtering a range nobody asked for. Reading the parts back
 * off the result is what rejects those.
 *
 * The dates come from a date input and from the settings, so a null only arises
 * from corrupted stored state.
 */
export function parseLocalDate(dateStr: string): Date | null {
  const parts = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(dateStr);
  if (!parts) { return null; }

  const [, year, month, day] = parts.map(Number);
  const date = new Date(year, month - 1, day);

  const rolledOver = date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day;

  return rolledOver ? null : date;
}

export function clearNoteReferences(note: any): null {
  if (!note) { return null; }

  // Remove references to the note
  note.body = null;
  note.title = null;
  note.id = null;
  note.parent_id = null;
  note.updated_time = null;
  note.created_time = null;
  note = null;

  return null;
}