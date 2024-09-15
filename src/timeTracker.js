const taskNameInput = document.getElementById('taskName');
const projectNameInput = document.getElementById('projectName');
const startButton = document.getElementById('startButton');
const runningTasksDiv = document.getElementById('runningTasks');
const errorMessageDiv = document.createElement('div');
errorMessageDiv.id = 'errorMessage';
document.getElementById('timeTracker').appendChild(errorMessageDiv);

let tasks = {};
let completedTasks = [];
let uniqueTasks = [];
let uniqueProjects = [];

function requestInitialData() {
  webviewApi.postMessage({
    name: 'requestInitialData'
  });
}

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

  } else if (message.name === 'updateAutocompleteLists') {
    uniqueTasks = message.tasks || [];
    uniqueProjects = message.projects || [];
    setupAutocomplete(taskNameInput, uniqueTasks);
    setupAutocomplete(projectNameInput, uniqueProjects);

  } else if (message.name === 'error') {
    errorMessageDiv.textContent = message.message;
    errorMessageDiv.style.color = 'red';

  } else if (message.name === 'initialData') {
    // Handle initial data
    tasks = message.runningTasks || {};
    completedTasks = message.completedTasks || [];
    uniqueTasks = message.uniqueTasks || [];
    uniqueProjects = message.uniqueProjects || [];
    updateRunningTasksDisplay();
    updateCompletedTasksDisplay();
    setupAutocomplete(taskNameInput, uniqueTasks);
    setupAutocomplete(projectNameInput, uniqueProjects);
    updateNoteSelector(message.logNotes);

  } else if (message.name === 'updateLogNotes') {
    updateNoteSelector(message.notes);
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
        <div class="running-task-header">
          <div class="running-task-title-container">
            <span class="running-task-title">${taskName}</span>
            <span class="running-task-project">${projectName}</span>
          </div>
          <button class="stopButton" data-task="${taskName}" data-project="${projectName}">Stop</button>
        </div>
        <div class="running-task-info">
          <span class="running-task-start-time">${formattedStartTime}</span>
          <span class="running-task-duration">${formattedDuration}</span>
        </div>
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
  // updateCompletedTasksDisplay();
}, 1000);

function setupAutocomplete(input, items) {
  let autocompleteList = null;
  let selectedIndex = -1;

  input.addEventListener('input', updateAutocomplete);
  input.addEventListener('keydown', handleKeydown);

  function createAutocompleteList() {
    if (!autocompleteList) {
      autocompleteList = document.createElement('ul');
      autocompleteList.className = 'autocomplete-list';
      autocompleteList.style.display = 'none';
      input.parentNode.insertBefore(autocompleteList, input.nextSibling);
    }
  }

  function updateAutocomplete() {
    const value = input.value.toLowerCase();
    if (!value) {
      if (autocompleteList) {
        autocompleteList.style.display = 'none';
      }
      return;
    }

    createAutocompleteList();
    const matches = items.filter(item => item.toLowerCase().includes(value));
    
    autocompleteList.innerHTML = '';
    matches.forEach(match => {
      const li = document.createElement('li');
      li.textContent = match;
      li.addEventListener('click', function() {
        input.value = this.textContent;
        autocompleteList.style.display = 'none';
      });
      autocompleteList.appendChild(li);
    });

    autocompleteList.style.display = matches.length > 0 ? 'block' : 'none';
    selectedIndex = -1;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      if (autocompleteList) {
        autocompleteList.style.display = 'none';
      }
      return;
    }

    if (!autocompleteList || autocompleteList.style.display === 'none') {
      if (e.key === 'Enter') {
        e.preventDefault();
        moveToNextOrSubmit();
      }
      return;
    }

    const items = autocompleteList.getElementsByTagName('li');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        updateSelectedItem();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = selectedIndex === -1 ? items.length - 1 : (selectedIndex - 1 + items.length) % items.length;
        updateSelectedItem();
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex !== -1) {
          input.value = items[selectedIndex].textContent;
        }
        autocompleteList.style.display = 'none';
        moveToNextOrSubmit();
        break;
      case 'Tab':
        if (selectedIndex !== -1) {
          input.value = items[selectedIndex].textContent;
        }
        autocompleteList.style.display = 'none';
        break;
    }
  }

  function moveToNextOrSubmit() {
    if (input === taskNameInput) {
      projectNameInput.focus();
    } else if (input === projectNameInput) {
      startButton.click();
    }
  }

  function updateSelectedItem() {
    const items = autocompleteList.getElementsByTagName('li');
    for (let i = 0; i < items.length; i++) {
      if (i === selectedIndex) {
        items[i].classList.add('selected');
        items[i].scrollIntoView({ block: 'nearest' });
      } else {
        items[i].classList.remove('selected');
      }
    }
  }

  document.addEventListener('click', function(e) {
    if (e.target !== input && autocompleteList) {
      autocompleteList.style.display = 'none';
    }
  });
}

const noteSelector = document.getElementById('noteSelector');

noteSelector.addEventListener('change', function() {
  const selectedNoteId = this.value;
  if (selectedNoteId) {
    webviewApi.postMessage({
      name: 'changeNote',
      noteId: selectedNoteId
    });
  }
});

function updateNoteSelector(logNotes) {
  const previousNoteId = noteSelector.value;
  const updateValue = (logNotes.length > 0 && previousNoteId === '');
  noteSelector.innerHTML = '<option value="">Tag a note with "time-log"</option>';
  logNotes.forEach(note => {
    const option = document.createElement('option');
    option.value = note.id;
    option.textContent = note.title;
    noteSelector.appendChild(option);
  });
  if (logNotes.length > 0) {
    if (updateValue) {
      noteSelector.value = logNotes[0].id;
      // Trigger the change event to initialize the note
      noteSelector.dispatchEvent(new Event('change'));

    } else {
      noteSelector.value = previousNoteId;
    }
  }
}

// Wait for 1 second before requesting initial data
setTimeout(requestInitialData, 1000);