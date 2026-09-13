import { TaskManager } from './taskManager';
import { clearNoteReferences } from './utils';

// A cursor position is only worth restoring to the editor that replaces the one
// we read it from. Beyond this the reload is not ours and the position is stale.
const PENDING_CURSOR_TIMEOUT_MS = 10000;

/** Where the caret was, and whether the editor was the focused element. */
interface CursorPosition {
  anchor: number;
  head: number;
  hasFocus: boolean;
}

export class NoteManager {
  private joplin: any;
  private noteId: string;
  private taskManager: TaskManager;
  private panel: string;
  // Set aside when the database write is about to rebuild the editor, and
  // collected by the content script once the replacement editor loads.
  private pendingCursor: {
    noteId: string, anchor: number, head: number, hasFocus: boolean, at: number
  } | null = null;

  constructor(joplin: any, noteId: string, panel: string) {
    this.joplin = joplin;
    this.noteId = noteId;
    this.panel = panel;
  }

  setTaskManager(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  setNoteId(noteId: string) {
    this.noteId = noteId;
  }

  /**
   * Write the corrected log back to the note.
   *
   * The database write is unconditional: it is the only source every reader in
   * the plugin consults (scanNote, startTask, stopTask, exportNote), and
   * startTask re-reads it immediately after writing, so skipping it makes a
   * just-started task vanish from the panel.
   *
   * The cursor is read before that write because Joplin rebuilds the editor in
   * response to it, after which editor commands fail (see #10). Where the
   * editor survives, it is updated in place with the cursor intact; where it is
   * rebuilt, the position is left pending for the content script to restore
   * when it reloads.
   */
  async updateNote(content: string) {
    let currentNote: any;
    try {
      currentNote = await this.joplin.workspace.selectedNote();
      const noteIsOpen = !!(currentNote && currentNote.id === this.noteId);

      const cursorPos = noteIsOpen ? await this.readCursorPosition() : null;
      if (cursorPos) {
        this.pendingCursor = { noteId: this.noteId, ...cursorPos, at: Date.now() };
      }

      await this.joplin.data.put(['notes', this.noteId], null, { body: content });

      if (noteIsOpen) {
        if (await this.updateEditorPreservingCursor(content, cursorPos)) {
          // Handled in place, so there is nothing to hand to a content script.
          // Leaving it set would let an unrelated reload consume the position.
          this.pendingCursor = null;

        } else {
          // Either the editor was rebuilt by the write, in which case it already
          // shows the new body and only the cursor is outstanding, or there is no
          // content script and it still shows the old body. Only the second needs
          // the text replacing, and the first makes this a silent no-op.
          await this.replaceEditorText(content);
        }
      }
    } catch (error) {
      console.error('Failed to update note:', error);
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'Failed to update note.' 
      });
    } finally {
      currentNote = clearNoteReferences(currentNote);
    }
  }

  /**
   * Read the cursor position while the editor is still reachable. Returns null
   * on editors without our content script, and on any editor that has already
   * been torn down.
   */
  private async readCursorPosition(): Promise<CursorPosition | null> {
    try {
      const pos = await this.joplin.commands.execute('editor.execCommand', {
        name: 'timeSlip__getCursorPosition'
      });
      if (pos && typeof pos.anchor === 'number') {
        return {
          anchor: pos.anchor,
          head: typeof pos.head === 'number' ? pos.head : pos.anchor,
          hasFocus: pos.hasFocus === true
        };
      }
    } catch (error) {
      console.warn('[TIME-SLIP] Could not read the cursor position:', error);
    }
    return null;
  }

  /**
   * Hand a stored cursor position to a content script that has just loaded, and
   * forget it. Returns null unless the rebuilt editor is showing the note the
   * position came from, so a stale position cannot be applied to another note or
   * long after the write that produced it.
   */
  async takePendingCursor(): Promise<CursorPosition | null> {
    const pending = this.pendingCursor;
    this.pendingCursor = null;

    if (!pending || Date.now() - pending.at > PENDING_CURSOR_TIMEOUT_MS) { return null; }

    let currentNote: any = await this.joplin.workspace.selectedNote();
    const stillOnThatNote = !!(currentNote && currentNote.id === pending.noteId);
    currentNote = clearNoteReferences(currentNote);

    return stillOnThatNote
      ? { anchor: pending.anchor, head: pending.head, hasFocus: pending.hasFocus }
      : null;
  }

  /**
   * Replace the open note's content in place through our CodeMirror 6 content
   * script, keeping the cursor. Returns false when that is not possible: a
   * CodeMirror 5 editor, or an editor the database write has already rebuilt.
   *
   * Failures are warned about rather than swallowed: when this stops working,
   * the symptom is a jumping cursor, which reads as a bug in the wrong place.
   */
  private async updateEditorPreservingCursor(
    content: string,
    cursorPos: CursorPosition | null
  ): Promise<boolean> {
    try {
      const result = await this.joplin.commands.execute('editor.execCommand', {
        name: 'timeSlip__updateContentWithCursor',
        args: [content, cursorPos]
      });

      if (result && result.success) {
        if (result.cursorPreserved === false) {
          console.warn('[TIME-SLIP] Content updated but the cursor could not be preserved');
        }
        return true;
      }
      console.warn('[TIME-SLIP] Cursor preservation unavailable, editor command returned:', result);

    } catch (error) {
      console.warn('[TIME-SLIP] Cursor preservation unavailable:', error);
    }

    return false;
  }

  /**
   * Last resort for an open note: replace the whole document without preserving
   * the cursor. Only reached when updateEditorPreservingCursor() has failed.
   */
  private async replaceEditorText(content: string) {
    try {
      await this.joplin.commands.execute('editor.setText', content);
    } catch (error) {
      console.debug('[TIME-SLIP] Editor update failed:', error);
    }
  }

  handleNoteChange = async (event: any) => {
    let currentNote = await this.joplin.workspace.selectedNote();
    if (currentNote && currentNote.id === this.noteId) {
      this.taskManager.debouncedScanAndUpdate();
    }
    currentNote = clearNoteReferences(currentNote);
  }

  handleNoteSelectionChange = async () => {
    await this.taskManager.getLogNotes();
  }

  async exportNote(): Promise<string> {
    try {
      const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
      const content = note.body;
      const lines = content.split('\n');
      
      if (lines.length < 2) {
        return 'The note is empty or contains only a header.';
      }

      const header = lines[0].split(',');
      const tableHeader = `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n`;
      
      let tableContent = tableHeader;
      
      for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split(',').map(field => field.trim());
        // Add empty fields if there are missing ones
        while (fields.length < header.length) {
          fields.push('');
        }
        tableContent += `| ${fields.join(' | ')} |\n`;
      }
      
      return tableContent;
    } catch (error) {
      console.error('Failed to export note:', error);
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'Failed to export note.' 
      });
      return '';
    }
  }
}

export function convertMarkdownTableToCSV(markdownTable: string): string | null {
  const lines = markdownTable.trim().split('\n');
  if (lines.length < 3) return null; // A valid table should have at least 3 lines

  // Remove the separator line (second line of the markdown table)
  lines.splice(1, 1);

  const csvLines = lines.map(line => {
    // Remove leading and trailing pipes, then split by pipes
    const cells = line.replace(/^\||\|$/g, '').split('|');
    // Trim each cell and wrap in quotes if it contains a comma
    return cells.map(cell => {
      const trimmed = cell.trim();
      return trimmed.includes(',') ? `"${trimmed}"` : trimmed;
    }).join(',');
  });

  return csvLines.join('\n');
}
