import { formatDuration, formatDate, formatTime, clearNoteReferences } from './utils';
import { NoteManager } from './noteManager';
import { getSortOrder } from './settings';

interface FieldIndices {
  project: number;
  taskName: number;
  startDate: number;
  startTime: number;
  endDate: number;
  endTime: number;
  duration: number;
}

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
  private fieldIndices: FieldIndices | null = null;
  private defaultHeader = "Project,Task,Start date,Start time,End date,End time,Duration";
  private sortBy: 'duration' | 'endTime' | 'name' = 'duration';

  constructor(joplin: any, panel: string, noteId: string, noteManager: NoteManager) {
    this.joplin = joplin;
    this.panel = panel;
    this.noteId = noteId;
    this.noteManager = noteManager;
    this.initializeSortOrder();
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

  private inferFieldIndices(header: string): FieldIndices | null {
    const fields = header.toLowerCase().split(',').map(field => field.trim());
    const indices: Partial<FieldIndices> = {};

    indices.project = fields.indexOf('project');
    indices.taskName = fields.indexOf('task');
    indices.startDate = fields.indexOf('start date');
    indices.startTime = fields.indexOf('start time');
    indices.endDate = fields.indexOf('end date');
    indices.endTime = fields.indexOf('end time');
    indices.duration = fields.indexOf('duration');

    // Check if all required fields are present
    if (Object.values(indices).some(index => index === -1)) {
      console.error('Missing required fields in the header');
      return null;
    }

    return indices as FieldIndices;
  }

  private async ensureNoteHasHeader(): Promise<boolean> {
    if (!this.noteId) return false;

    let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    if (!note.body.trim()) {
      // Note is empty, add the default header
      await this.noteManager.updateNote(this.defaultHeader + '\n');
      note = clearNoteReferences(note);
      return true;
    }
    note = clearNoteReferences(note);
    return false;
  }

  async scanNoteAndUpdateTasks() {
    if (!this.noteId) {
      console.log('No note selected. Skipping scan.');
      this.updateCompletedTasks([]);
      return;
    }

    const headerAdded = await this.ensureNoteHasHeader();

    let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    note = clearNoteReferences(note);

    // Infer field indices from the header
    this.fieldIndices = this.inferFieldIndices(lines[0]);
    if (!this.fieldIndices) {
      console.error('Invalid header format');
      return;
    }

    const openTasks: { [key: string]: { startTime: number; project: string } } = {};
    const completedTasks: { [key: string]: { taskName: string; project: string; duration: number; startTime: number; endTime: number } } = {};
    const tasksSet = new Set<string>();
    const projectsSet = new Set<string>();
    let noteUpdated = false;

    const startDate = this.currentStartDate ? new Date(this.currentStartDate) : null;
    const endDate = this.currentEndDate ? new Date(this.currentEndDate) : null;

    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    // Skip the header line
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(',').map(field => field.trim());
      const project = fields[this.fieldIndices.project];
      const taskName = fields[this.fieldIndices.taskName];
      const startDateStr = fields[this.fieldIndices.startDate];
      const startTimeStr = fields[this.fieldIndices.startTime];
      const endDateStr = fields[this.fieldIndices.endDate];
      const endTimeStr = fields[this.fieldIndices.endTime];
      const duration = fields[this.fieldIndices.duration];
      
      if (taskName) tasksSet.add(taskName);
      if (project) projectsSet.add(project);

      if (startTimeStr && endTimeStr) {
        const startDateTime = new Date(`${startDateStr} ${startTimeStr}`);
        const endDateTime = new Date(`${endDateStr} ${endTimeStr}`);
        const calculatedDurationMs = endDateTime.getTime() - startDateTime.getTime();
        const calculatedDuration = formatDuration(calculatedDurationMs);
        
        if (calculatedDuration !== duration) {
          // Update the line with the correct duration
          fields[this.fieldIndices.duration] = calculatedDuration;
          lines[i] = fields.join(',');
          noteUpdated = true;
        }

        // Check if the task falls within the date range
        if (this.isTaskInDateRange(startDateTime, startDate, endDate)) {
          const taskKey = this.getTaskKey(taskName, project);
          if (taskKey in completedTasks) {
            completedTasks[taskKey].duration += calculatedDurationMs;
            completedTasks[taskKey].startTime = Math.min(completedTasks[taskKey].startTime, startDateTime.getTime());
            completedTasks[taskKey].endTime = Math.max(completedTasks[taskKey].endTime, endDateTime.getTime());
          } else {
            completedTasks[taskKey] = {
              taskName,
              project,
              duration: calculatedDurationMs,
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

    // Update the note if any durations were corrected
    if (noteUpdated) {
      const updatedBody = lines.join('\n');
      await this.noteManager.updateNote(updatedBody);
    }

    // Update tasks
    this.tasks = openTasks;
    this.updateRunningTasks();

    // Update completed tasks
    this.updateCompletedTasks(Object.values(completedTasks));

    // Update autocomplete lists
    this.uniqueTasks = Array.from(tasksSet).sort((a, b) => a.localeCompare(b));
    this.uniqueProjects = Array.from(projectsSet).sort((a, b) => a.localeCompare(b));
    this.updateAutocompleteLists();

    // Scan for log notes
    await this.getLogNotes();
  }

  private isTaskInDateRange(taskStart: Date, rangeStart: Date | null, rangeEnd: Date | null): boolean {
    if (!rangeStart && !rangeEnd) return true;
    if (rangeStart && rangeEnd) {
      return (rangeStart <= taskStart && taskStart <= rangeEnd);
    }
    if (rangeStart) return taskStart >= rangeStart;
    if (rangeEnd) return taskStart <= rangeEnd;
    return false; // This line should never be reached
  }

  async getLogNotes() {
    const tags = await this.joplin.data.get(['tags'], {
      fields: ['id', 'title'],
    });
    const timeTags = tags.items.filter(tag => tag.title === this.logNoteTag);

    if (timeTags.length > 0) {
      this.logNotes = [];
      for (const timeTag of timeTags) {
        const notes = await this.joplin.data.get(
          ['tags', timeTag.id, 'notes'],
          {
            fields: ['id', 'title'],
          }
        );
        this.logNotes = this.logNotes.concat(notes.items);
      }
      this.updateLogNotes();

    } else {
      console.error(`No ${this.logNoteTag} tag found`);
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

  private updateCompletedTasks(completedTasks: Array<{ taskName: string; project: string; duration: number; endTime: number }>) {
    this.joplin.views.panels.postMessage(this.panel, { 
      name: 'updateCompletedTasks', 
      tasks: completedTasks
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

    await this.ensureNoteHasHeader();

    if (!this.fieldIndices) {
      await this.scanNoteAndUpdateTasks();
    }

    if (!this.fieldIndices) {
      console.error('Field indices not initialized');
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

      let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
      let updatedBody = note.body.trim();
      note = clearNoteReferences(note);

      if (!updatedBody.trim()) {
        // Create header if note is empty
        const header = ['Project', 'Task', 'Start date', 'Start time', 'End date', 'End time', 'Duration'];
        updatedBody = header.join(',');
      }

      const newEntry = new Array(7).fill(''); // Create an array with 7 empty strings
      newEntry[this.fieldIndices.project] = project;
      newEntry[this.fieldIndices.taskName] = taskName;
      newEntry[this.fieldIndices.startDate] = formatDate(startTime);
      newEntry[this.fieldIndices.startTime] = formatTime(startTime);

      updatedBody += '\n' + newEntry.join(',') + '\n';

      await this.noteManager.updateNote(updatedBody);
      await this.scanNoteAndUpdateTasks();
    }
  }

  async stopTask(taskName: string, project: string) {
    if (!this.noteId) {
      console.error('No note selected. Cannot stop task.');
      return;
    }

    if (!this.fieldIndices) {
      console.error('Field indices not initialized');
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

    let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    note = clearNoteReferences(note);
    const startDate = formatDate(new Date(startTime));
    const startTimeFormatted = formatTime(new Date(startTime));
    
    // Find the last matching open task entry
    const lineIndex = lines.findIndex(line => {
      const fields = line.split(',');
      return fields[this.fieldIndices.project] === project &&
             fields[this.fieldIndices.taskName] === taskName && 
             fields[this.fieldIndices.startDate] === startDate &&
             fields[this.fieldIndices.startTime] === startTimeFormatted &&
             !fields[this.fieldIndices.endDate] && // Ensure end date is empty
             !fields[this.fieldIndices.endTime]; // Ensure end time is empty
    });

    if (lineIndex !== -1) {
      const fields = lines[lineIndex].split(',');
      fields[this.fieldIndices.endDate] = formatDate(endTime);
      fields[this.fieldIndices.endTime] = formatTime(endTime);
      fields[this.fieldIndices.duration] = formatDuration(duration);
      lines[lineIndex] = fields.join(',');
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
      logNotes: await this.getLogNotes(),
      defaultNoteId: this.noteId,
      sortBy: this.sortBy
    };
  }

  async setNoteId(noteId: string) {
    this.noteId = noteId;
    await this.scanNoteAndUpdateTasks();
  }

  async setLogNoteTag(tag: string) {
    this.logNoteTag = tag;
    this.noteId = '';
    this.tasks = {};
    this.completedTasks = [];
    this.updateRunningTasks();
    this.updateCompletedTasks([]);
    await this.getLogNotes();
  }

  private updateLogNotes() {
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateLogNotes',
      notes: this.logNotes
    });
  }

  async setDateRange(startDate: string | null, endDate: string | null) {
    this.currentStartDate = startDate;
    this.currentEndDate = endDate;
    await this.scanNoteAndUpdateTasks();
  }

  async clearTasks() {
    this.tasks = {};
    this.completedTasks = [];
    this.updateRunningTasks();
    this.updateCompletedTasks([]);
  }

  private async initializeSortOrder() {
    this.sortBy = await getSortOrder();
  }

  async updateSortOrder(sortOrder: 'duration' | 'endTime' | 'name') {
    this.sortBy = sortOrder;
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateSortOrder',
      sortBy: this.sortBy
    });
  }
}