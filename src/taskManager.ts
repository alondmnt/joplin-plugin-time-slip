import { formatLocalTime, formatDuration } from './utils';
import { NoteManager } from './noteManager';

export class TaskManager {
  private tasks: { [key: string]: { startTime: number; project: string } } = {};
  private joplin: any;
  private panel: string;
  private noteId: string;
  private noteManager: NoteManager;

  constructor(joplin: any, panel: string, noteId: string, noteManager: NoteManager) {
    this.joplin = joplin;
    this.panel = panel;
    this.noteId = noteId;
    this.noteManager = noteManager;
  }

  private getTaskKey(taskName: string, project: string): string {
    return `${taskName}|${project}`;
  }

  async initialize() {
    await this.scanNoteAndUpdateTasks();
  }

  updateRunningTasks() {
    this.joplin.views.panels.postMessage(this.panel, { name: 'updateRunningTasks', tasks: this.tasks });
  }

  async scanNoteAndUpdateTasks() {
    const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    const openTasks: { [key: string]: { startTime: number; project: string } } = {};

    for (const line of lines) {
      const [taskName, project, startTime, endTime] = line.split(',');
      if (startTime && !endTime) {
        const taskKey = this.getTaskKey(taskName, project);
        openTasks[taskKey] = { startTime: new Date(startTime).getTime(), project };
      }
    }

    this.tasks = openTasks;
    this.updateRunningTasks();
  }

  async startTask(taskName: string, project: string) {
    const taskKey = this.getTaskKey(taskName, project);
    if (this.tasks[taskKey]) {
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: `Task "${taskName}" for project "${project}" is already running.` 
      });
    } else {
      const startTime = Date.now();
      this.tasks[taskKey] = { startTime, project };
      this.updateRunningTasks();

      const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
      let updatedBody = note.body;

      if (!updatedBody.trim()) {
        updatedBody = "Task Name,Project,Start Time,End Time,Duration\n";
      }

      const startEntry = `${taskName},${project},${formatLocalTime(new Date(startTime))},\n`;
      updatedBody += startEntry;

      await this.noteManager.updateNote(updatedBody);
      await this.scanNoteAndUpdateTasks();
    }
  }

  async stopTask(taskName: string, project: string) {
    const taskKey = this.getTaskKey(taskName, project);
    if (!this.tasks[taskKey]) {
      console.error(`Task "${taskName}" for project "${project}" not found`);
      return;
    }
    const { startTime } = this.tasks[taskKey];
    const endTime = Date.now();
    const duration = endTime - startTime;
    delete this.tasks[taskKey];
    this.updateRunningTasks();

    const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    const taskStartTime = formatLocalTime(new Date(startTime));
    const lineIndex = lines.findIndex(line => {
      const parts = line.split(',');
      return parts[0] === taskName && 
             parts[1] === project && 
             parts[2].startsWith(taskStartTime.slice(0, 10)) && 
             parts.length === 4; // Ensure there's no end time
    });

    if (lineIndex !== -1) {
      const updatedLine = `${lines[lineIndex]}${formatLocalTime(new Date(endTime))},${formatDuration(duration)}`;
      lines[lineIndex] = updatedLine;
      const updatedBody = lines.join('\n');
      await this.noteManager.updateNote(updatedBody);
    } else {
      console.error(`Could not find the open start entry for task: ${taskName}, project: ${project}`);
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: `Could not find the open start entry for task: ${taskName}, project: ${project}` 
      });
    }

    await this.scanNoteAndUpdateTasks();
  }
}