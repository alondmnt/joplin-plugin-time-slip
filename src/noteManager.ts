import { TaskManager } from './taskManager';
import { clearNoteReferences } from './utils';

export class NoteManager {
  private joplin: any;
  private noteId: string;
  private taskManager: TaskManager;
  private panel: string;

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
   * When the note is open, the write goes through the editor rather than the
   * database. Writing to the database first makes Joplin rebuild the editor,
   * after which every editor command fails and the cursor and focus are lost
   * (see #10), so the order here is load-bearing rather than incidental.
   * Joplin persists the editor buffer itself, exactly as it does for a typed
   * edit, so no database write is needed in that case.
   */
  async updateNote(content: string) {
    let currentNote: any;
    try {
      currentNote = await this.joplin.workspace.selectedNote();
      const noteIsOpen = !!(currentNote && currentNote.id === this.noteId);

      if (noteIsOpen && await this.updateEditorPreservingCursor(content)) {
        return;
      }

      await this.joplin.data.put(['notes', this.noteId], null, { body: content });

      if (noteIsOpen) {
        // The editor still shows the old body and could not be updated in
        // place, so replace it wholesale and accept losing the cursor.
        await this.replaceEditorText(content);
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
   * Replace the open note's content through our CodeMirror 6 content script,
   * keeping the cursor where the user left it. Returns false when that is not
   * possible (a CodeMirror 5 editor, or the commands are unreachable), leaving
   * the caller to fall back to a database write.
   *
   * Failures are warned about rather than swallowed: when this stops working,
   * the symptom is a jumping cursor, which reads as a bug in the wrong place.
   */
  private async updateEditorPreservingCursor(content: string): Promise<boolean> {
    try {
      const cursorPos = await this.joplin.commands.execute('editor.execCommand', {
        name: 'timeSlip__getCursorPosition'
      });

      const result = await this.joplin.commands.execute('editor.execCommand', {
        name: 'timeSlip__updateContentWithCursor',
        args: [content, cursorPos]
      });

      if (result && result.success) {
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
