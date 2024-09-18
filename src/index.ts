import joplin from 'api';
import { TaskManager } from './taskManager';
import { NoteManager } from './noteManager';
import { registerSettings, getLogNoteTag, getDefaultNoteId, setDefaultNoteId, getCurrentDateRange, setCurrentDateRange } from './settings';

joplin.plugins.register({
  onStart: async function() {
    await registerSettings();
    const logNoteTag = await getLogNoteTag();
    const defaultNoteId = await getDefaultNoteId();

    const panel = await joplin.views.panels.create('timeSlipPanel');

    await joplin.views.panels.setHtml(panel, `
      <div id="timeTracker">
        <div class="input-group">
          <input type="text" id="taskName" placeholder="Task name">
          <input type="text" id="projectName" placeholder="Project name">
          <button id="startButton">Start</button>
        </div>
        <select id="noteSelector">
          <option value="">Tag a note with a time-slip tag</option>
        </select>
        <div id="errorMessage"></div>
        <div id="runningTasks"></div>
        <div class="date-range">
          <input type="date" id="startDate" title="Start date for filtering completed tasks">
          <input type="date" id="endDate" title="End date for filtering completed tasks">
        </div>
        <div id="completedTasks"></div>
        <div class="aggregation-level">
          <input type="range" id="aggregationSlider" min="1" max="3" value="1" step="1" title="Aggregation level for completed tasks">
          <div class="slider-labels">
            <span>Task</span>
            <span>Project</span>
            <span>Note</span>
          </div>
        </div>
      </div>
    `);

    await joplin.views.panels.addScript(panel, 'timeTracker.css');
    await joplin.views.panels.addScript(panel, 'timeTracker.js');

    let noteId = defaultNoteId;
    const noteManager = new NoteManager(joplin, noteId, panel);
    const taskManager = new TaskManager(joplin, panel, noteId, noteManager);
    noteManager.setTaskManager(taskManager);
    await taskManager.setLogNoteTag(logNoteTag);

    if (noteId) {
      await noteManager.setNoteId(noteId);
      await taskManager.setNoteId(noteId);
    }

    await joplin.workspace.onSyncComplete(async () => await taskManager.scanNoteAndUpdateTasks());
    await joplin.workspace.onNoteChange(noteManager.handleNoteChange);
    await joplin.workspace.onNoteSelectionChange(noteManager.handleNoteSelectionChange);

    await joplin.commands.register({
      name: 'timeslip.togglePanel',
      label: 'Toggle Time Slip Panel',
      iconName: 'fas fa-stopwatch',
      execute: async () => {
        const isVisible = await joplin.views.panels.visible(panel);
        if (isVisible) {
          await joplin.views.panels.hide(panel);
        } else {
          await joplin.views.panels.show(panel);
        }
      }
    });

    await joplin.settings.onChange(async (event) => {
      if (event.keys.includes('timeslip.logNoteTag')) {
        const newLogNoteTag = await joplin.settings.value('timeslip.logNoteTag');
        await taskManager.setLogNoteTag(newLogNoteTag);
        noteId = ''; // Reset the selected note
      }
    });

    await joplin.views.panels.onMessage(panel, async (message) => {
      if (message.name === 'changeNote') {
        noteId = message.noteId;
        await noteManager.setNoteId(noteId);
        await taskManager.setNoteId(noteId);
        if (noteId) {
          await taskManager.setDateRange(message.startDate, message.endDate);
          setCurrentDateRange(message.startDate, message.endDate);
          await taskManager.scanNoteAndUpdateTasks();
          // Save the selected note ID as the default
          await setDefaultNoteId(noteId);
        } else {
          // Clear tasks when no note is selected
          await taskManager.clearTasks();
          await setDefaultNoteId('');
        }

      } else if (message.name === 'start') {
        if (noteId) {
          await taskManager.startTask(message.taskName, message.projectName);
        } else {
          await joplin.views.panels.postMessage(panel, { 
            name: 'error', 
            message: 'Please select a note first.' 
          });
        }

      } else if (message.name === 'stop') {
        if (noteId) {
          await taskManager.stopTask(message.taskName, message.projectName);
        } else {
          console.error('No note selected. Cannot stop task.');
        }

      } else if (message.name === 'requestInitialData') {
        const initialData = await taskManager.getInitialData();
        const currentDateRange = await getCurrentDateRange();
        await joplin.views.panels.postMessage(panel, {
          name: 'initialData',
          ...initialData,
          currentDateRange
        });

      } else if (message.name === 'applyDateFilter') {
        if (noteId) {
          await taskManager.setDateRange(message.startDate, message.endDate);
          setCurrentDateRange(message.startDate, message.endDate);
          await taskManager.scanNoteAndUpdateTasks();
        } else {
          await joplin.views.panels.postMessage(panel, { 
            name: 'error', 
            message: 'Please select a note first.' 
          });
        }

      } else if (message.name === 'getDefaultDateRange') {
        const currentDateRange = await getCurrentDateRange();
        await joplin.views.panels.postMessage(panel, {
          name: 'defaultDateRange',
          ...currentDateRange
        });
      }
    });
  },
});