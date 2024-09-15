import { formatLocalTime, formatDuration, formatDate, formatTime, debounce } from './utils';
import { NoteManager } from './noteManager';

export class TaskManager {
  private tasks: { [key: string]: { startTime: number; project: string } } = {};
  private joplin: any;
  private panel: string;
  private noteId: string;
  private noteManager: NoteManager;
  private uniqueTasks: string[] = [];
  private uniqueProjects: string[] = [];
  private completedTasks: { taskName: string; project: string; duration: number }[] = [];
  private logNotes: { id: string; title: string }[] = [];

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
    this.joplin.views.panels.postMessage(
      this.panel,
      {
        name: 'updateRunningTasks',
        tasks: this.tasks
      });
  }

  async scanNoteAndUpdateTasks() {
    if (!this.noteId) {
      console.log('No note selected. Skipping scan.');
      return;
    }

    const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    const openTasks: { [key: string]: { startTime: number; project: string } } = {};
    const completedTasks: { [key: string]: number } = {};
    const tasksSet = new Set<string>();
    const projectsSet = new Set<string>();

    // Skip the header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const [project, taskName, startDate, startTime, endDate, endTime, duration] = line.split(',');
      
      if (taskName) tasksSet.add(taskName);
      if (project) projectsSet.add(project);

      if (startTime && !endTime) {
        const taskKey = this.getTaskKey(taskName, project);
        const startDateTime = new Date(`${startDate} ${startTime}`);
        openTasks[taskKey] = { startTime: startDateTime.getTime(), project };
      } else if (duration) {
        const taskKey = this.getTaskKey(taskName, project);
        const durationMs = this.parseDuration(duration);
        completedTasks[taskKey] = (completedTasks[taskKey] || 0) + durationMs;
      }
    }

  // Only update if there are changes
  if (JSON.stringify(this.tasks) !== JSON.stringify(openTasks)) {
    this.tasks = openTasks;
    this.updateRunningTasks();
  }

  if (JSON.stringify(this.completedTasks) !== JSON.stringify(completedTasks)) {
    this.updateCompletedTasks(completedTasks);
  }

  // Only update if there are changes
  if (JSON.stringify(this.uniqueTasks) !== JSON.stringify(Array.from(tasksSet)) ||
      JSON.stringify(this.uniqueProjects) !== JSON.stringify(Array.from(projectsSet))) {
    this.uniqueTasks = Array.from(tasksSet);
    this.uniqueProjects = Array.from(projectsSet);
    this.updateAutocompleteLists();
  }

    // Scan for log notes
    await this.getLogNotes();
  }

  async getLogNotes() {
    const tags = await this.joplin.data.get(['tags'], {
      fields: ['id', 'title'],
    });
    const timeTag = tags.items.find(tag => tag.title === 'time-log');
    if (timeTag) {
      const notes = await this.joplin.data.get(
        ['tags', timeTag.id, 'notes'],
        {
          fields: ['id', 'title'],
        }
      );
      this.logNotes = notes.items;
      this.updateLogNotes();

    } else {
      console.log('No time-log tag found');
      this.logNotes = [];
      this.updateLogNotes();
    }
    return this.logNotes;
  }

  private updateAutocompleteLists() {
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateAutocompleteLists',
      tasks: this.uniqueTasks,
      projects: this.uniqueProjects
    });
  }

  private parseDuration(duration: string): number {
    const [hours, minutes, seconds] = duration.split(':').map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  private updateCompletedTasks(completedTasks: { [key: string]: number }) {
    this.completedTasks = Object.entries(completedTasks)
      .sort(([, a], [, b]) => b - a)
      .map(([key, duration]) => {
        const [taskName, project] = key.split('|');
        return { taskName, project, duration };
      });

    this.joplin.views.panels.postMessage(this.panel, { 
      name: 'updateCompletedTasks', 
      tasks: this.completedTasks 
    });
  }

  async startTask(taskName: string, project: string) {
    if (!this.noteId) {
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'Please select a note first.' 
      });
      return;
    }

    const taskKey = this.getTaskKey(taskName, project);
    if (this.tasks[taskKey]) {
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: `Task "${taskName}" for project "${project}" is already running.` 
      });
    } else {
      const startTime = new Date();
      this.tasks[taskKey] = { startTime: startTime.getTime(), project };
      this.updateRunningTasks();

      const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
      let updatedBody = note.body;

      if (!updatedBody.trim()) {
        updatedBody = "Project,Task,Start date,Start time,End date,End time,Duration\n";
      }

      const startEntry = `${project},${taskName},${formatDate(startTime)},${formatTime(startTime)}\n`;
      updatedBody += startEntry;

      await this.noteManager.updateNote(updatedBody);
      await this.scanNoteAndUpdateTasks();
    }
  }

  async stopTask(taskName: string, project: string) {
    if (!this.noteId) {
      console.error('No note selected. Cannot stop task.');
      return;
    }

    const taskKey = this.getTaskKey(taskName, project);
    if (!this.tasks[taskKey]) {
      console.error(`Task "${taskName}" for project "${project}" not found`);
      return;
    }
    const { startTime } = this.tasks[taskKey];
    const endTime = new Date();
    const duration = endTime.getTime() - startTime;
    delete this.tasks[taskKey];
    this.updateRunningTasks();

    const note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    const taskStartTime = formatLocalTime(new Date(startTime));
    const lineIndex = lines.findIndex(line => {
      const parts = line.split(',');
      return parts[0] === project &&
             parts[1] === taskName && 
             parts[2] === formatDate(new Date(startTime)) &&
             parts[3] === formatTime(new Date(startTime)) &&
             parts.length === 4; // Changed from 7 to 4
    });

    if (lineIndex !== -1) {
      const updatedLine = `${lines[lineIndex]},${formatDate(endTime)},${formatTime(endTime)},${formatDuration(duration)}`;
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

  async getInitialData() {
    return {
      runningTasks: this.tasks,
      completedTasks: this.completedTasks,
      uniqueTasks: this.uniqueTasks,
      uniqueProjects: this.uniqueProjects,
      logNotes: await this.getLogNotes()
    };
  }

  async setNoteId(noteId: string) {
    this.noteId = noteId;
    await this.scanNoteAndUpdateTasks();
  }

  private updateLogNotes() {
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateLogNotes',
      notes: this.logNotes
    });
  }
}