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

  async updateNote(content: string) {
    let currentNote: any;
    try {
      await this.joplin.data.put(['notes', this.noteId], null, { body: content });

      currentNote = await this.joplin.workspace.selectedNote();
      if (currentNote && currentNote.id === this.noteId) {
        await this.joplin.commands.execute('editor.setText', content);
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
        if (fields.length === header.length) {
          tableContent += `| ${fields.join(' | ')} |\n`;
        }
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
