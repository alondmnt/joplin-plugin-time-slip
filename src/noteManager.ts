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
}