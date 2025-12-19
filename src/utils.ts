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