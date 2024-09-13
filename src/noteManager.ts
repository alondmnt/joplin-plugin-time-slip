import { TaskManager } from './taskManager';

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

  async updateNote(content: string) {
    try {
      await this.joplin.data.put(['notes', this.noteId], null, { body: content });
      console.log('Note updated successfully');

      const currentNote = await this.joplin.workspace.selectedNote();
      if (currentNote && currentNote.id === this.noteId) {
        await this.joplin.commands.execute('editor.setText', content);
      }
    } catch (error) {
      console.error('Failed to update note:', error);
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'Failed to update note.' 
      });
    }
  }

  handleNoteChange = async (event: any) => {
    const currentNote = await this.joplin.workspace.selectedNote();
    if (currentNote && currentNote.id === this.noteId) {
      await this.taskManager.scanNoteAndUpdateTasks();
    }
  }

  handleNoteSelectionChange = async () => {
    const currentNote = await this.joplin.workspace.selectedNote();
    if (currentNote && currentNote.id === this.noteId) {
      await this.taskManager.scanNoteAndUpdateTasks();
    }
  }
}