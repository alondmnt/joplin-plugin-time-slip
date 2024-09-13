import joplin from 'api';
import { TaskManager } from './taskManager';
import { NoteManager } from './noteManager';

joplin.plugins.register({
  onStart: async function() {
    const panel = await joplin.views.panels.create('timeTrackerPanel');
    const noteId = '5a71f2e79e8541c7bdc12a46aeb88de1';

    await joplin.views.panels.setHtml(panel, `
      <div id="timeTracker">
        <div class="input-group">
          <input type="text" id="taskName" placeholder="Enter task name">
          <input type="text" id="projectName" placeholder="Enter project name">
          <button id="startButton">Start</button>
        </div>
        <div id="errorMessage"></div>
        <div id="runningTasks"></div>
      </div>
    `);

    await joplin.views.panels.addScript(panel, 'timeTracker.css');
    await joplin.views.panels.addScript(panel, 'timeTracker.js');

    const noteManager = new NoteManager(joplin, noteId, panel);
    const taskManager = new TaskManager(joplin, panel, noteId, noteManager);
    noteManager.setTaskManager(taskManager);
    await taskManager.initialize();

    await joplin.workspace.onSyncComplete(() => taskManager.scanNoteAndUpdateTasks());
    await joplin.workspace.onNoteChange(noteManager.handleNoteChange);
    await joplin.workspace.onNoteSelectionChange(noteManager.handleNoteSelectionChange);

    await joplin.views.panels.onMessage(panel, async (message) => {
      if (message.name === 'start') {
        await taskManager.startTask(message.taskName, message.projectName);
      } else if (message.name === 'stop') {
        await taskManager.stopTask(message.taskName, message.projectName);
      }
    });
  },
});