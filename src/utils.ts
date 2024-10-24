export function formatLocalTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA'); // This format gives YYYY-MM-DD
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
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