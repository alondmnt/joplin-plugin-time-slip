import { formatDuration, formatDate, formatTime, clearNoteReferences, debounce } from './utils';
import { NoteManager } from './noteManager';
import { getSummarySortOrder, getLogSortOrder, getEnforceSorting } from './settings';

interface FieldIndices {
  project: number;
  taskName: number;
  startDate: number;
  startTime: number;
  endDate: number;
  endTime: number;
  duration: number;
}

interface ScanResult {
  openTasks: { [key: string]: { startTime: number; project: string } };
  completedTasks: { [key: string]: { taskName: string; project: string; duration: number; startTime: number; endTime: number } };
  tasksSet: Set<string>;
  projectsSet: Set<string>;
  sortableTasks: Array<{ index: number; startTime: number; line: string }>;
  unknownTasks: Array<{ index: number, line: string }>;
  durationChanged: boolean;
  isSorted: boolean;
  lines: string[];
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
  public debouncedScanAndUpdate: ReturnType<typeof debounce>;
  private logSortOrder: 'ascending' | 'descending' = 'ascending';
  private enforceSorting: boolean = true;

  constructor(joplin: any, panel: string, noteId: string, noteManager: NoteManager) {
    this.joplin = joplin;
    this.panel = panel;
    this.noteId = noteId;
    this.noteManager = noteManager;
    this.initializeSortOrder();
    this.debouncedScanAndUpdate = debounce(this.scanNoteAndUpdateTasks.bind(this), 4000);
    this.updateLogSortOrder();
    this.updateEnforceSorting();
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

  private ensureNoteHasHeader(body: string): string {
    if (body === null || body === undefined) { return; }

    if (body.trim() === '') {
      // Note is empty, add the default header
      body = this.defaultHeader + '\n';
    }

    return body;
  }

  async scanNoteAndUpdateTasks() {
    if (!this.noteId) {
      this.updateCompletedTasks([]);
      return;
    }

    try {
      const scanResult = await this.scanNote();
      if (scanResult) {
        await this.updateTasksAndNote(scanResult);
      }
    } catch (error) {
      console.error('scanNoteAndUpdateTasks:', error);
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'An error occurred while scanning or updating the note. Note ID: ' + this.noteId
      });
    }
  }

  private async scanNote() {
    let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    
    if (!note || note.body === undefined || note.body === null) {
      this.handleNoteError(note);
      return null;
    }

    const lines = this.ensureNoteHasHeader(note.body).split('\n');
    note = clearNoteReferences(note);
    this.fieldIndices = this.inferFieldIndices(lines[0]);
    
    if (!this.fieldIndices) {
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'Invalid header format' 
      });
      return null;
    }

    const scanResult = this.processNoteLines(lines);
    return scanResult;
  }

  private processNoteLines(lines: string[]): ScanResult {
    const openTasks: { [key: string]: { startTime: number; project: string } } = {};
    const completedTasks: { [key: string]: { taskName: string; project: string; duration: number; startTime: number; endTime: number } } = {};
    const tasksSet = new Set<string>();
    const projectsSet = new Set<string>();
    const sortableTasks: Array<{ index: number; startTime: number; line: string }> = [];
    const unknownTasks: Array<{ index: number, line: string }> = [];
    let durationChanged = false;
    let isSorted = true;
    let previousStartTime = this.logSortOrder === 'ascending' ? 0 : Number.MAX_SAFE_INTEGER;

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

      if (startTimeStr) {
        const startDateTime = new Date(`${startDateStr} ${startTimeStr}`);
        const currentStartTime = startDateTime.getTime();
        
        // Check if the lines are sorted according to the log sort order
        if (this.enforceSorting &&
            ((this.logSortOrder === 'ascending' && currentStartTime < previousStartTime) ||
             (this.logSortOrder === 'descending' && currentStartTime > previousStartTime))) {
          isSorted = false;
        }
        previousStartTime = currentStartTime;

        if (endTimeStr) {
          // Completed task
          const endDateTime = new Date(`${endDateStr} ${endTimeStr}`);
          const calculatedDurationMs = endDateTime.getTime() - startDateTime.getTime();
          const calculatedDuration = formatDuration(calculatedDurationMs);
          
          if (calculatedDuration !== duration) {
            // Update the line with the correct duration
            fields[this.fieldIndices.duration] = calculatedDuration;
            lines[i] = fields.join(',');
            durationChanged = true;
          }

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

        } else {
          // Open task
          const taskKey = this.getTaskKey(taskName, project);
          openTasks[taskKey] = { startTime: startDateTime.getTime(), project };
        }

        // Push to sortableTasks after processing the entire line
        sortableTasks.push({ index: i, startTime: currentStartTime, line: lines[i] });

      } else {
        unknownTasks.push( { index: i, line: lines[i], } );
      }
    }

    return {
      openTasks,
      completedTasks,
      tasksSet,
      projectsSet,
      sortableTasks,
      unknownTasks,
      durationChanged,
      isSorted,
      lines
    };
  }

  private async updateTasksAndNote(scanResult: ScanResult) {
    const {
      openTasks,
      completedTasks,
      tasksSet,
      projectsSet,
      sortableTasks,
      unknownTasks,
      durationChanged,
      isSorted,
      lines
    } = scanResult;

    // Update note content if necessary
    if (!isSorted || durationChanged) {
      const updatedContent = await this.getUpdatedNoteContent(sortableTasks, unknownTasks, lines, isSorted, durationChanged);
      if (updatedContent) {
        await this.noteManager.updateNote(updatedContent);
      }
    }

    // Update tasks and UI
    this.tasks = openTasks;
    this.updateRunningTasks();
    this.updateCompletedTasks(Object.values(completedTasks));
    this.updateAutocompleteLists(Array.from(tasksSet), Array.from(projectsSet));
    await this.getLogNotes();
  }

  private async getUpdatedNoteContent(
    sortableTasks: Array<{ index: number; startTime: number; line: string }>, 
    unknownTasks: Array<{ index: number, line: string }>, 
    lines: string[], 
    isSorted: boolean, 
    durationChanged: boolean
  ): Promise<string | null> {
    if (!isSorted) {
      sortableTasks.sort((a, b) => {
        const comparison = a.startTime - b.startTime;
        return this.logSortOrder === 'ascending' ? comparison : -comparison;
      });

      // Reconstruct the sorted note content
      const header = lines[0];
      const sortedLines = sortableTasks.map(task => task.line);
      
      // Create an array to hold all lines
      const allLines = [header];

      // Combine sorted tasks and unknown tasks, preserving original indices for unknown tasks
      let sortedIndex = 0;
      let unknownIndex = 0;

      for (let i = 1; i < lines.length; i++) {
        if (unknownIndex < unknownTasks.length && unknownTasks[unknownIndex].index === i) {
          allLines.push(unknownTasks[unknownIndex].line);
          unknownIndex++;

        } else if (sortedIndex < sortedLines.length) {
          allLines.push(sortedLines[sortedIndex]);
          sortedIndex++;
        }
      }

      // Add any remaining sorted tasks (if any)
      allLines.push(...sortedLines.slice(sortedIndex));

      return allLines.join('\n');

    } else if (durationChanged) {
      return lines.join('\n');
    }

    return null; // No changes needed
  }

  private handleNoteError(note) {
    if (!note) {
      console.error('Note not found or is null');
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'The selected note could not be found. Note ID: ' + this.noteId
      });
    } else {
      console.error('Note body is undefined or null');
      this.joplin.views.panels.postMessage(this.panel, { 
        name: 'error', 
        message: 'The selected note has no content. Note ID: ' + this.noteId
      });
    }
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

  private updateAutocompleteLists(uniqueTasks: string[], uniqueProjects: string[]) {
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateAutocompleteLists',
      tasks: uniqueTasks,
      projects: uniqueProjects
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

      if (!updatedBody) {
        updatedBody = this.defaultHeader;
      }

      const maxIndex = Math.max(...Object.values(this.fieldIndices));
      const newEntry = new Array(maxIndex + 1).fill('');
      newEntry[this.fieldIndices.project] = project;
      newEntry[this.fieldIndices.taskName] = taskName;
      newEntry[this.fieldIndices.startDate] = formatDate(startTime);
      newEntry[this.fieldIndices.startTime] = formatTime(startTime);
      if (this.logSortOrder === 'ascending') {
        updatedBody += '\n' + newEntry.join(',');

      } else {
        updatedBody = updatedBody.split('\n');
        updatedBody.splice(1, 0, newEntry.join(','));
        updatedBody = updatedBody.join('\n');
      }

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
    this.sortBy = await getSummarySortOrder();
  }

  async updateSummarySortOrder(sortOrder: 'duration' | 'endTime' | 'name') {
    this.sortBy = sortOrder;
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateSortOrder',
      sortBy: this.sortBy
    });
  }

  async updateLogSortOrder() {
    this.logSortOrder = await getLogSortOrder();
  }

  async updateEnforceSorting(enforce: boolean | null = null) {
    if (enforce !== null) {
      this.enforceSorting = enforce;
    } else {
      this.enforceSorting = await getEnforceSorting();
    }
  }
}