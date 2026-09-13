import { formatDuration, formatDate, formatTime, clearNoteReferences, parseLocalDate } from './utils';
import { NoteManager } from './noteManager';
import { getSummarySortOrder, getLogSortOrder, getEnforceSorting, getShowDurationColumn, getShowPercentageColumn, getShowEndTimeColumn, getOnlyOneActiveTask, getShowTotalInSummary, getShowTotalInActiveTask, getIncludeTimezone } from './settings';
import debounce = require('lodash.debounce');

// How long to wait after an edit before re-reading the log. It bounds how often
// a large note is parsed while you type, and how soon a correction lands once
// you leave it. Not a setting: the reason to lengthen it was that rewrites
// interrupted typing, and they no longer happen while the note is open.
const UPDATE_DELAY_MS = 4000;

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
  openTasks: { [key: string]: { startTime: number; project: string; startDateStr: string; startTimeStr: string } };
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
  private tasks: { [key: string]: { startTime: number; project: string; startDateStr: string; startTimeStr: string } } = {};
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
  private onlyOneActiveTask: boolean = false;
  private enforceSorting: boolean = true;
  private showDurationColumn: boolean = true;
  private showPercentageColumn: boolean = true;
  private showEndTimeColumn: boolean = true;
  private showTotalInSummary: boolean = true;
  private showTotalInActiveTask: boolean = false;
  // A deferred note rewrite is armed on debouncedScanAndUpdate; cleared by any writing scan.
  private rewritePending: boolean = false;
  // A rewrite the gate dropped because the log note was open. Nothing is armed
  // for it, so leaving the note is what lets it land; see handleNoteSelectionChange.
  private rewriteHeldBack: boolean = false;

  constructor(joplin: any, panel: string, noteId: string, noteManager: NoteManager) {
    this.joplin = joplin;
    this.panel = panel;
    this.noteId = noteId;
    this.noteManager = noteManager;
    this.initializeSortOrder();
    this.debouncedScanAndUpdate = debounce(this.rewriteUnlessEditing.bind(this), UPDATE_DELAY_MS);
    this.updateLogSortOrder();
    this.updateEnforceSorting();
    this.updateColumnVisibility();
    this.updateOnlyOneActiveTask();
  }

  private getTaskKey(taskName: string, project: string): string {
    return `${taskName}|${project}`;
  }

  private splitTaskKey(taskKey: string): {task: string, project: string} {
    let parts = taskKey.split('|');
    return {task: parts[0], project: parts[1]};
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

  /**
   * Scan the note, rewrite it if durations or sorting are stale, and refresh the panel.
   * Use for actions that expect the note to be corrected now: starting or stopping a
   * task, the sort command, sort settings. The rewrite is unconditional, including
   * while the note is open, because the user asked for it: the sort command would
   * otherwise do nothing in the usual case of sorting the note you are looking at.
   * Automatic triggers should use refreshTasksFromNote() instead, so that rewrites
   * honour the update delay and leave an open note alone.
   */
  async scanNoteAndUpdateTasks() {
    await this.scanAndUpdate(true);
  }

  /**
   * Scan the note and refresh the panel without rewriting the note. If a rewrite
   * turns out to be needed, it is scheduled through the update delay instead.
   * Use for triggers the user did not ask for: sync, panel reload, switching note
   * or date range. These must not rewrite the note while it is being edited.
   */
  async refreshTasksFromNote() {
    await this.scanAndUpdate(false);
  }

  /**
   * The automatic rewrite, and the only thing the debounce drives.
   *
   * Rewriting the note makes Joplin rebuild the editor, and a rebuilt editor
   * starts from a fresh state with no undo history. That is too much to charge
   * for correcting a derived field, so the rewrite is held back while the note
   * is open: the times it is derived from are already on disk, the panel is
   * computed from this same scan and stays accurate, and only the note's own
   * duration column lags until a later trigger finds the user elsewhere.
   *
   * Holding back arms nothing, so this cannot become a poll over a large log.
   * Editing re-arms it through handleNoteChange, and sync, a panel reload or
   * starting a task all arm a fresh one when they find the note stale.
   */
  private async rewriteUnlessEditing() {
    // The debounce has fired, so nothing is pending any more whatever this scan
    // goes on to do. Leaving the flag set would wedge it true with no timer
    // behind it, and no later trigger could arm a replacement.
    this.rewritePending = false;
    // Re-decided below from what this scan finds, so that undoing the edit that
    // made the note stale does not leave us scanning on every note click.
    this.rewriteHeldBack = false;
    const noteIsOpen = await this.noteManager.isNoteSelected();
    await this.scanAndUpdate(!noteIsOpen, false);
  }

  /**
   * @param writeNote correct the note now, rather than only refreshing the panel
   * @param mayArm may defer a needed rewrite to the debounce. False for scans
   *   the debounce itself drove: those have had their turn, and re-arming from
   *   inside one is what would turn a held-back rewrite into a poll.
   */
  private async scanAndUpdate(writeNote: boolean, mayArm: boolean = true) {
    if (writeNote) {
      // This scan settles any deferred rewrite, whether it writes or finds
      // nothing to write, so the next stale scan is free to arm a new one.
      this.rewritePending = false;
      this.rewriteHeldBack = false;
    }

    if (!this.noteId) {
      this.updateCompletedTasks([]);
      return;
    }

    try {
      const scanResult = await this.scanNote();
      if (scanResult) {
        await this.updateTasksAndNote(scanResult, writeNote, mayArm);
      }
    } catch (error) {
      console.error('scanAndUpdate:', error);
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
    const openTasks: { [key: string]: { startTime: number; project: string; startDateStr: string; startTimeStr: string } } = {};
    const completedTasks: { [key: string]: { taskName: string; project: string; duration: number; startTime: number; endTime: number } } = {};
    const tasksSet = new Set<string>();
    const projectsSet = new Set<string>();
    const sortableTasks: Array<{ index: number; startTime: number; line: string }> = [];
    const unknownTasks: Array<{ index: number, line: string }> = [];
    let durationChanged = false;
    let isSorted = true;
    let previousStartTime = this.logSortOrder === 'ascending' ? 0 : Number.MAX_SAFE_INTEGER;

    const startDate = this.currentStartDate ? parseLocalDate(this.currentStartDate) : null;
    const endDate = this.currentEndDate ? parseLocalDate(this.currentEndDate) : null;

    // parseLocalDate lands on local midnight, so the range already opens where
    // it should; the closing date has to cover the whole of its own day.
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
          openTasks[taskKey] = {
            startTime: startDateTime.getTime(),
            project,
            startDateStr: startDateStr,
            startTimeStr: startTimeStr,
          };
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

  private async updateTasksAndNote(scanResult: ScanResult, writeNote: boolean, mayArm: boolean = true) {
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
      if (writeNote) {
        const updatedContent = await this.getUpdatedNoteContent(sortableTasks, unknownTasks, lines, isSorted, durationChanged);
        if (updatedContent) {
          await this.noteManager.updateNote(updatedContent);
        }
      } else if (mayArm && !this.rewritePending) {
        // Defer the rewrite rather than interrupting an edit in progress. Arm it
        // only once: the note stays stale until the rewrite lands, so re-arming on
        // every read-only scan would let frequent triggers (panel reloads, syncs)
        // push it out indefinitely. Edits still re-arm it, via handleNoteChange.
        this.rewritePending = true;
        this.debouncedScanAndUpdate();

      } else if (!mayArm) {
        // The gate dropped this rewrite: the debounce fired while the user was
        // in the note. Nothing is armed, so record it, and let leaving the note
        // be what lets it land.
        this.rewriteHeldBack = true;
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
    // @todo: edge case exists where there may be more than 100 identical tags!
    const tags = await this.joplin.data.get(['search'], {
      query: this.logNoteTag,
      fields: 'id,title',
      type: 'tag',
    });
    const timeTags = tags.items;

    if (timeTags.length > 0) {
      this.logNotes = [];
      for (const timeTag of timeTags) {
        let hasMore = true;
        while (hasMore) {
          const notes = await this.joplin.data.get(
            ['tags', timeTag.id, 'notes'],
            {
              fields: ['id', 'title'],
            }
          );
          this.logNotes = this.logNotes.concat(notes.items);
          hasMore = notes.has_more;
        }
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
    // Store the data internally for getInitialData() to return
    this.uniqueTasks = uniqueTasks;
    this.uniqueProjects = uniqueProjects;
    
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateAutocompleteLists',
      tasks: uniqueTasks,
      projects: uniqueProjects
    });
  }

  private updateCompletedTasks(completedTasks: Array<{ taskName: string; project: string; duration: number; endTime: number }>) {
    this.completedTasks = completedTasks;
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
      if ( this.onlyOneActiveTask ) {
        await this.stopAllTasks();
      }
      const startTime = new Date();
      const includeTimezone = await getIncludeTimezone();
      this.tasks[taskKey] = {
        startTime: startTime.getTime(),
        project,
        startDateStr: formatDate(startTime),
        startTimeStr: formatTime(startTime, includeTimezone),
      };
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
      newEntry[this.fieldIndices.startDate] = this.tasks[taskKey].startDateStr;
      newEntry[this.fieldIndices.startTime] = this.tasks[taskKey].startTimeStr;
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
    const { startTime, startDateStr, startTimeStr } = this.tasks[taskKey];
    const endTime = new Date();
    const duration = endTime.getTime() - startTime;
    delete this.tasks[taskKey];
    this.updateRunningTasks();

    let note = await this.joplin.data.get(['notes', this.noteId], { fields: ['body'] });
    const lines = note.body.split('\n');
    note = clearNoteReferences(note);

    // Match against the exact strings written to the note at start time,
    // so that timezone changes between start and stop don't break the lookup
    const lineIndex = lines.findIndex(line => {
      const fields = line.split(',');
      return fields[this.fieldIndices.project] === project &&
             fields[this.fieldIndices.taskName] === taskName &&
             fields[this.fieldIndices.startDate] === startDateStr &&
             fields[this.fieldIndices.startTime] === startTimeStr &&
             !fields[this.fieldIndices.endDate] &&
             !fields[this.fieldIndices.endTime];
    });

    if (lineIndex !== -1) {
      const includeTimezone = await getIncludeTimezone();
      const fields = lines[lineIndex].split(',');
      fields[this.fieldIndices.endDate] = formatDate(endTime);
      fields[this.fieldIndices.endTime] = formatTime(endTime, includeTimezone);
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

  async stopAllTasks() {
    await Promise.all(Object.keys(this.tasks).map(async(key) => {
      let task = this.splitTaskKey(key);
      await this.stopTask(task.task, task.project);
    }));
  }

  async getInitialData() {
    // If we have a noteId, ensure we scan it first to get current, properly filtered data
    if (this.noteId) {
      await this.refreshTasksFromNote();
    }
    
    // Refresh sort order from settings to ensure it's current when panel is re-shown
    await this.initializeSortOrder();
    
    // Get the actual default note ID from settings, not the current noteId
    const defaultNoteIdFromSettings = await this.joplin.settings.value('timeslip.defaultNoteId');
    
    return {
      runningTasks: this.tasks,
      completedTasks: this.completedTasks,
      uniqueTasks: this.uniqueTasks,
      uniqueProjects: this.uniqueProjects,
      logNotes: await this.getLogNotes(),
      defaultNoteId: defaultNoteIdFromSettings,
      sortBy: this.sortBy,
      showDurationColumn: this.showDurationColumn,
      showPercentageColumn: this.showPercentageColumn,
      showEndTimeColumn: this.showEndTimeColumn,
      showTotalInSummary: this.showTotalInSummary,
      showTotalInActiveTask: this.showTotalInActiveTask
    };
  }

  /**
   * The user has moved to another note. Joplin note selection does not change
   * which note the plugin tracks, so this still refers to the log note.
   *
   * If the gate dropped a rewrite while they were in it, this is the first
   * moment it can land, so scan and let the debounce write it with the gate now
   * open. Ordinary browsing skips that scan: it must not parse the whole log on
   * every click.
   *
   * The flag is spent whether or not the scan succeeds. A scan that cannot run
   * (no note, a deleted one, an unparseable header) must not leave it set, or
   * every later note click retries a failing scan and posts an error. Losing
   * the flush costs nothing that is not recoverable: sync, start, stop and the
   * sort paths all still correct the note.
   *
   * The note list is refreshed either way, as it was before the flush existed.
   * A failed scan never reaches the refresh inside updateTasksAndNote, and the
   * note picker going stale for the session is worse than one extra lookup on
   * the rare navigation that flushes.
   */
  async handleNoteSelectionChange() {
    const flushHeldBack = this.rewriteHeldBack && !!this.noteId;
    this.rewriteHeldBack = false;

    if (flushHeldBack) {
      await this.refreshTasksFromNote();
    }
    await this.getLogNotes();
  }

  async setNoteId(noteId: string) {
    // Any rewrite held back belonged to the note we are leaving, and nothing
    // here can flush it. Dropping it stops the next note click scanning the
    // note we have arrived at on the old note's behalf.
    this.rewriteHeldBack = false;
    this.noteId = noteId;
    await this.refreshTasksFromNote();
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
    await this.refreshTasksFromNote();
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

  async updateOnlyOneActiveTask() {
    this.onlyOneActiveTask = await getOnlyOneActiveTask();
  }

  async updateColumnVisibility() {
    this.showDurationColumn = await getShowDurationColumn();
    this.showPercentageColumn = await getShowPercentageColumn();
    this.showEndTimeColumn = await getShowEndTimeColumn();
    this.showTotalInSummary = await getShowTotalInSummary();
    this.showTotalInActiveTask = await getShowTotalInActiveTask();
    
    // Send the column visibility settings to the frontend
    this.joplin.views.panels.postMessage(this.panel, {
      name: 'updateColumnVisibility',
      showDurationColumn: this.showDurationColumn,
      showPercentageColumn: this.showPercentageColumn,
      showEndTimeColumn: this.showEndTimeColumn,
      showTotalInSummary: this.showTotalInSummary,
      showTotalInActiveTask: this.showTotalInActiveTask
    });
  }
}
