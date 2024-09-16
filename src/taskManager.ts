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
  private completedTasks: { taskName: string; project: string; duration: number; endTime: number }[] = [];
  private logNotes: { id: string; title: string }[] = [];
  private currentStartDate: string | null = null;
  private currentEndDate: string | null = null;
  private logNoteTag: string = 'time-slip';

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
        tasks: this.tasks // This should contain all running tasks, regardless of the date filter
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
    const completedTasks: { [key: string]: { taskName: string; project: string; duration: number; startTime: number; endTime: number } } = {};
    const tasksSet = new Set<string>();
    const projectsSet = new Set<string>();

    const startDate = this.currentStartDate ? new Date(this.currentStartDate) : null;
    const endDate = this.currentEndDate ? new Date(this.currentEndDate) : null;

    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    // Skip the header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const [project, taskName, startDateStr, startTimeStr, endDateStr, endTimeStr, duration] = line.split(',');
      
      if (taskName) tasksSet.add(taskName);
      if (project) projectsSet.add(project);

      if (startTimeStr && endTimeStr) {
        const startDateTime = new Date(`${startDateStr} ${startTimeStr}`);
        const endDateTime = new Date(`${endDateStr} ${endTimeStr}`);
        const durationMs = this.parseDuration(duration);

        // Check if the task falls within the date range
        if (this.isTaskInDateRange(startDateTime, endDateTime, startDate, endDate)) {
          const taskKey = this.getTaskKey(taskName, project);
          if (taskKey in completedTasks) {
            completedTasks[taskKey].duration += durationMs;
            completedTasks[taskKey].startTime = Math.min(completedTasks[taskKey].startTime, startDateTime.getTime());
            completedTasks[taskKey].endTime = Math.max(completedTasks[taskKey].endTime, endDateTime.getTime());
          } else {
            completedTasks[taskKey] = {
              taskName,
              project,
              duration: durationMs,
              startTime: startDateTime.getTime(),
              endTime: endDateTime.getTime()
            };
          }
        }
      } else if (startTimeStr) {
        // Handle running tasks
        const taskKey = this.getTaskKey(taskName, project);
        const startDateTime = new Date(`${startDateStr} ${startTimeStr}`);
        openTasks[taskKey] = { startTime: startDateTime.getTime(), project };
      }
    }

    // Update tasks
    this.tasks = openTasks;
    this.updateRunningTasks();

    // Update completed tasks
    this.updateCompletedTasks(Object.values(completedTasks));

    // Update autocomplete lists
    this.uniqueTasks = Array.from(tasksSet);
    this.uniqueProjects = Array.from(projectsSet);
    this.updateAutocompleteLists();

    // Scan for log notes
    await this.getLogNotes();
  }

  private isTaskInDateRange(taskStart: Date, taskEnd: Date, rangeStart: Date | null, rangeEnd: Date | null): boolean {
    if (!rangeStart && !rangeEnd) return true;
    if (rangeStart && rangeEnd) {
      return (taskStart <= rangeEnd && taskEnd >= rangeStart);
    }
    if (rangeStart) return taskEnd >= rangeStart;
    if (rangeEnd) return taskStart <= rangeEnd;
    return false; // This line should never be reached
  }

  async getLogNotes() {
    const tags = await this.joplin.data.get(['tags'], {
      fields: ['id', 'title'],
    });
    const timeTag = tags.items.find(tag => tag.title === this.logNoteTag);
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
      console.log(`No ${this.logNoteTag} tag found`);
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

  private updateCompletedTasks(completedTasks: Array<{ taskName: string; project: string; duration: number; endTime: number }>) {
    this.completedTasks = completedTasks.sort((a, b) => b.endTime - a.endTime);

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
    const startDate = formatDate(new Date(startTime));
    const startTimeFormatted = formatTime(new Date(startTime));
    
    // Find the last matching open task entry
    const lineIndex = lines.findIndex(line => {
      const parts = line.split(',');
      return parts[0] === project &&
             parts[1] === taskName && 
             parts[2] === startDate &&
             parts[3] === startTimeFormatted &&
             parts.length === 4; // This ensures we're only matching open tasks
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

    // Rescan the entire note without date filtering
    const currentStartDate = this.currentStartDate;
    const currentEndDate = this.currentEndDate;
    this.currentStartDate = null;
    this.currentEndDate = null;
    await this.scanNoteAndUpdateTasks();
    // Restore the date filter
    this.currentStartDate = currentStartDate;
    this.currentEndDate = currentEndDate;
    // Apply the filter again by rescanning with the restored date range
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

  async filterCompletedTasks(startDate: string, endDate: string): Promise<Array<{ taskName: string; project: string; duration: number; endTime: number }>> {
    this.currentStartDate = startDate;
    this.currentEndDate = endDate;
    await this.scanNoteAndUpdateTasks();
    return this.completedTasks;
  }

  async setDateRange(startDate: string | null, endDate: string | null) {
    this.currentStartDate = startDate;
    this.currentEndDate = endDate;
    await this.scanNoteAndUpdateTasks();
  }

  setLogNoteTag(tag: string) {
    this.logNoteTag = tag;
    this.getLogNotes();
  }
}