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
  // Cursor preservation either works or it does not, and it does not recover
  // mid-session. Warn on the first failure only: updateNote runs on every
  // correction, and Joplin keeps plugin console output in its own log.
  private cursorWarningIssued: boolean = false;
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

      // Always overwrite: startTask and stopTask each run two cycles in quick
      // succession, and the second may land inside a rebuild and read nothing.
      // Leaving the previous position set would restore an edit-old cursor.
      const cursorPos = noteIsOpen ? await this.readCursorPosition() : null;
      this.pendingCursor = cursorPos
        ? { noteId: this.noteId, ...cursorPos, at: Date.now() }
        : null;

      await this.joplin.data.put(['notes', this.noteId], null, { body: content });

      if (noteIsOpen) {
        if (await this.updateEditorPreservingCursor(content, cursorPos)) {
          // Handled in place, so there is nothing to hand to a content script.
          // Leaving it set would let an unrelated reload consume the position.
          this.pendingCursor = null;

        } else if (!cursorPos) {
          // No content script, so nothing will restore the editor for us and it
          // still shows the old body. Where a position was captured the script
          // is alive, the rebuilt editor already has the new body from the
          // database, and replacing the text here would only race the restore.
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
   * Is the log note the one currently selected in the editor?
   *
   * Returns false on any error. Every caller reads false as "go ahead and
   * write", so a failure here degrades to the unconditional rewrites we had
   * before, rather than silently suppressing corrections for the session.
   */
  async isNoteSelected(): Promise<boolean> {
    let currentNote: any;
    try {
      currentNote = await this.joplin.workspace.selectedNote();
      return !!(currentNote && currentNote.id === this.noteId);
    } catch (error) {
      console.debug('[TIME-SLIP] Could not read the selected note:', error);
      return false;
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
      this.warnOnce('cursor position unavailable, the editor will jump on corrections');

    } catch (error) {
      this.warnOnce('cursor position unreadable, the editor will jump on corrections', error);
    }
    return null;
  }

  /**
   * Report a cursor-preservation problem once per session. Every caller here is
   * on the per-correction path, so an unconditional warning would grow Joplin's
   * log without telling the reader anything the first one did not.
   */
  private warnOnce(message: string, detail?: any) {
    if (this.cursorWarningIssued) { return; }
    this.cursorWarningIssued = true;
    console.warn(`[TIME-SLIP] ${message} (reported once per session)`, detail ?? '');
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
          this.warnOnce('content updated but the cursor could not be preserved');
        }
        return true;
      }
    } catch (error) {
      // Expected wherever the database write has already rebuilt the editor,
      // which is every correction on Joplin 3.7. Not a failure: the position
      // was captured beforehand and the content script restores it on reload.
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
