const taskNameInput = document.getElementById('taskName');
const projectNameInput = document.getElementById('projectName');
const startButton = document.getElementById('startButton');
const runningTasksDiv = document.getElementById('runningTasks');
const errorMessageDiv = document.createElement('div');
errorMessageDiv.id = 'errorMessage';
document.getElementById('timeTracker').appendChild(errorMessageDiv);

let tasks = {};
let completedTasks = [];

startButton.addEventListener('click', function() {
  const taskName = taskNameInput.value.trim();
  const projectName = projectNameInput.value.trim();
  if (taskName && projectName) {
    webviewApi.postMessage({
      name: 'start',
      taskName: taskName,
      projectName: projectName
    });
    taskNameInput.value = '';
    projectNameInput.value = '';
  } else {
    console.log('Task name or project name is empty, not sending message');
  }
});

runningTasksDiv.addEventListener('click', function(event) {
  if (event.target.classList.contains('stopButton')) {
    const taskName = event.target.getAttribute('data-task');
    const projectName = event.target.getAttribute('data-project');
    webviewApi.postMessage({
      name: 'stop',
      taskName: taskName,
      projectName: projectName
    });
    delete tasks[`${taskName}|${projectName}`];
    updateRunningTasksDisplay();
  }
});

webviewApi.onMessage(function(event) {
  const message = event.message;
  if (message.name === 'updateRunningTasks') {
    tasks = message.tasks || {};
    updateRunningTasksDisplay();
    errorMessageDiv.textContent = ''; // Clear any previous error messages
  } else if (message.name === 'updateCompletedTasks') {
    completedTasks = message.tasks || [];
    updateCompletedTasksDisplay();
  } else if (message.name === 'error') {
    errorMessageDiv.textContent = message.message;
    errorMessageDiv.style.color = 'red';
  }
});

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  const pad = (num) => num.toString().padStart(2, '0');
  
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
}

function formatStartTime(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function updateRunningTasksDisplay() {
  const now = Date.now();
  let tasksHtml = '';
  
  try {
    tasksHtml = Object.entries(tasks).map(([key, { startTime, project }]) => {
      const [taskName, projectName] = key.split('|');
      const durationSeconds = Math.floor((now - startTime) / 1000);
      const formattedDuration = formatDuration(durationSeconds);
      const formattedStartTime = formatStartTime(startTime);
      return `<div class="running-task">
        <strong>${taskName}</strong> (${projectName})<br>
        Start: ${formattedStartTime}<br>
        Duration: ${formattedDuration}
        <button class="stopButton" data-task="${taskName}" data-project="${projectName}">Stop</button>
      </div>`;
    }).join('');
  } catch (error) {
    console.error('Error while generating tasks HTML:', error);
    tasksHtml = 'Error displaying tasks';
  }
  
  runningTasksDiv.innerHTML = tasksHtml || 'No tasks running';
}

function updateCompletedTasksDisplay() {
  let completedTasksDiv = document.getElementById('completedTasks');
  if (!completedTasksDiv) {
    completedTasksDiv = document.createElement('div');
    completedTasksDiv.id = 'completedTasks';
    document.getElementById('timeTracker').appendChild(completedTasksDiv);
  }

  let tasksHtml = ''; // Removed the heading

  if (completedTasks.length > 0) {
    tasksHtml += '<table><tr><th>Task</th><th>Project</th><th>Duration</th><th>Action</th></tr>';
    completedTasks.forEach(({ taskName, project, duration }) => {
      const formattedDuration = formatDuration(Math.floor(duration / 1000));
      tasksHtml += `<tr>
        <td>${taskName}</td>
        <td>${project}</td>
        <td>${formattedDuration}</td>
        <td><button class="startButton" data-task="${taskName}" data-project="${project}">Start</button></td>
      </tr>`;
    });
    tasksHtml += '</table>';
  } else {
    tasksHtml += '<p>No completed tasks</p>';
  }
  
  completedTasksDiv.innerHTML = tasksHtml;

  // Add event listeners to the new start buttons
  const startButtons = completedTasksDiv.querySelectorAll('.startButton');
  startButtons.forEach(button => {
    button.addEventListener('click', function() {
      const taskName = this.getAttribute('data-task');
      const projectName = this.getAttribute('data-project');
      webviewApi.postMessage({
        name: 'start',
        taskName: taskName,
        projectName: projectName
      });
    });
  });
}

// Initial update
updateRunningTasksDisplay();
updateCompletedTasksDisplay();

// Periodic update
setInterval(() => {
  updateRunningTasksDisplay();
  updateCompletedTasksDisplay();
}, 1000);