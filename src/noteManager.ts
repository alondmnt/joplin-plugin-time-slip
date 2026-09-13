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
   * The database write is unconditional: it is the only source every reader in
   * the plugin consults (scanNote, startTask, stopTask, exportNote), and
   * startTask re-reads it immediately after writing, so skipping it makes a
   * just-started task vanish from the panel.
   */
  async updateNote(content: string) {
    try {
      const noteIsOpen = await this.isNoteSelected();
      await this.joplin.data.put(['notes', this.noteId], null, { body: content });

      if (noteIsOpen) {
        await this.replaceEditorText(content);
      }
    } catch (error) {
      console.error('Failed to update note:', error);
      this.joplin.views.panels.postMessage(this.panel, {
        name: 'error',
        message: 'Failed to update note.'
      });
    }
  }

  /**
   * Push the new body into an open editor.
   *
   * Not a no-op, and not free. Joplin routes editor.setText through form-note
   * state rather than dispatching to the editor, so it schedules a save of
   * identical content and bumps updated_time. stopTask runs up to three write
   * cycles, so up to three of these.
   *
   * Kept anyway, because it is the only thing that puts the new body into that
   * form-note state. Writes to an open note still happen (start, stop, the sort
   * command), and if Joplin's rebuild ever defers to an unsaved buffer, its own
   * save would put the pre-write body back over a row we had just appended. A
   * redundant save is a cheaper failure than a lost log entry.
   */
  private async replaceEditorText(content: string) {
    try {
      await this.joplin.commands.execute('editor.setText', content);
    } catch (error) {
      console.debug('[TIME-SLIP] Editor update failed:', error);
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

  handleNoteChange = async (event: any) => {
    let currentNote = await this.joplin.workspace.selectedNote();
    if (currentNote && currentNote.id === this.noteId) {
      this.taskManager.debouncedScanAndUpdate();
    }
    currentNote = clearNoteReferences(currentNote);
  }

  handleNoteSelectionChange = async () => {
    await this.taskManager.handleNoteSelectionChange();
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
