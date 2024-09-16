import joplin from 'api';
import { TaskManager } from './taskManager';
import { NoteManager } from './noteManager';
import { registerSettings } from './settings';

joplin.plugins.register({
  onStart: async function() {
    await registerSettings();
    const logNoteTag = await joplin.settings.value('timeslip.logNoteTag');

    const panel = await joplin.views.panels.create('timeTrackerPanel');

    await joplin.views.panels.setHtml(panel, `
      <div id="timeTracker">
        <div class="input-group">
          <input type="text" id="taskName" placeholder="Task name">
          <input type="text" id="projectName" placeholder="Project name">
          <button id="startButton">Start</button>
        </div>
        <select id="noteSelector">
          <option value="">Tag a note with "${logNoteTag}"</option>
        </select>
        <div id="errorMessage"></div>
        <div id="runningTasks"></div>
      </div>
    `);

    await joplin.views.panels.addScript(panel, 'timeTracker.css');
    await joplin.views.panels.addScript(panel, 'timeTracker.js');

    let noteId = '';
    const noteManager = new NoteManager(joplin, noteId, panel);
    const taskManager = new TaskManager(joplin, panel, noteId, noteManager);
    noteManager.setTaskManager(taskManager);
    await taskManager.setLogNoteTag(logNoteTag);

    await joplin.workspace.onSyncComplete(taskManager.scanNoteAndUpdateTasks);
    await joplin.workspace.onNoteChange(noteManager.handleNoteChange);
    await joplin.workspace.onNoteSelectionChange(noteManager.handleNoteSelectionChange);

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
        await taskManager.setDateRange(message.startDate, message.endDate);
        await taskManager.scanNoteAndUpdateTasks();

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
        await joplin.views.panels.postMessage(panel, {
          name: 'initialData',
          ...initialData
        });
      }

      if (message.name === 'applyDateFilter') {
        if (noteId) {
          await taskManager.setDateRange(message.startDate, message.endDate);
          await taskManager.scanNoteAndUpdateTasks();

        } else {
          await joplin.views.panels.postMessage(panel, { 
            name: 'error', 
            message: 'Please select a note first.' 
          });
        }
      }
    });
  },
});