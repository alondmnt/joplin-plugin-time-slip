const taskNameInput = document.getElementById('taskName');
const projectNameInput = document.getElementById('projectName');
const startButton = document.getElementById('startButton');
const runningTasksDiv = document.getElementById('runningTasks');
const errorMessageDiv = document.createElement('div');
errorMessageDiv.id = 'errorMessage';
document.getElementById('timeTracker').appendChild(errorMessageDiv);
const noteSelector = document.getElementById('noteSelector');

let tasks = {};
let completedTasks = [];
let uniqueTasks = [];
let uniqueProjects = [];
let isUpdatingRunningTasks = false;
let isUpdatingDateFilter = false;
let lastStartDate = '';
let lastEndDate = '';

let removeTaskAutocomplete = null;
let removeProjectAutocomplete = null;

function requestInitialData() {
  webviewApi.postMessage({
    name: 'requestInitialData'
  });
}

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

function updateRunningTasksLoop() {
  if (isUpdatingRunningTasks) {
    updateRunningTasksDisplay();
    requestAnimationFrame(updateRunningTasksLoop);
  }
}

function startUpdatingRunningTasks() {
  if (!isUpdatingRunningTasks) {
    isUpdatingRunningTasks = true;
    updateRunningTasksLoop();
  }
}

function stopUpdatingRunningTasks() {
  isUpdatingRunningTasks = false;
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

  if (Object.keys(tasks).length > 0) {
    startUpdatingRunningTasks();
  } else {
    stopUpdatingRunningTasks();
  }
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
      // Re-setup autocomplete for task and project inputs
      updateAutocompleteLists();
    } else {
      noteSelector.value = previousNoteId;
    }
  }
}

webviewApi.onMessage(function(event) {
  const message = event.message;
  if (message.name === 'updateRunningTasks') {
    tasks = message.tasks || {};
    updateRunningTasksDisplay();
    errorMessageDiv.textContent = ''; // Clear any previous error messages

  } else if (message.name === 'updateCompletedTasks') {
    completedTasks = message.tasks || [];
    updateCompletedTasksDisplay();
    isUpdatingDateFilter = false;

  } else if (message.name === 'updateAutocompleteLists') {
    console.log('Received new autocomplete lists', message.tasks, message.projects);
    uniqueTasks = message.tasks || [];
    uniqueProjects = message.projects || [];
    updateAutocompleteLists();
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
    updateAutocompleteLists();
    updateNoteSelector(message.logNotes);

  } else if (message.name === 'updateLogNotes') {
    updateNoteSelector(message.notes);
  }
});

function updateCompletedTasksDisplay() {
  const timeTrackerDiv = document.getElementById('timeTracker');
  const completedTasksDiv = document.getElementById('completedTasks') || document.createElement('div');
  completedTasksDiv.id = 'completedTasks';
  timeTrackerDiv.appendChild(completedTasksDiv);

  // Add date range inputs
  let dateRangeHtml = `
    <div class="date-range">
      <input type="date" id="startDate">
      <input type="date" id="endDate">
    </div>
  `;

  let tasksHtml = dateRangeHtml;

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

  // Use event delegation for start buttons
  completedTasksDiv.addEventListener('click', function(event) {
    if (event.target.classList.contains('startButton')) {
      const taskName = event.target.getAttribute('data-task');
      const projectName = event.target.getAttribute('data-project');
      webviewApi.postMessage({
        name: 'start',
        taskName: taskName,
        projectName: projectName
      });
    }
  });

  // Add event listeners for date inputs
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  
  startDateInput.addEventListener('change', () => applyDateFilter(startDateInput, endDateInput));
  endDateInput.addEventListener('change', () => applyDateFilter(startDateInput, endDateInput));

  // Set the date inputs to their last known values
  if (lastStartDate) startDateInput.value = lastStartDate;
  if (lastEndDate) endDateInput.value = lastEndDate;

  // Initialize date inputs if they haven't been set before
  if (!lastStartDate || !lastEndDate) {
    initializeDateInputs();
  }
}

function applyDateFilter(startDateInput, endDateInput) {
  const startDate = startDateInput.value || null;
  const endDate = endDateInput.value || null;
  
  if (startDate !== lastStartDate || endDate !== lastEndDate) {
    lastStartDate = startDate;
    lastEndDate = endDate;
    
    webviewApi.postMessage({
      name: 'applyDateFilter',
      startDate: startDate,
      endDate: endDate
    });
  }
}

// Initialize date inputs with default values
function initializeDateInputs() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7); // A week ago

  const endDateInput = document.getElementById('endDate');
  const startDateInput = document.getElementById('startDate');

  lastEndDate = endDate.toLocaleDateString('en-CA'); // This format gives YYYY-MM-DD in local time
  lastStartDate = startDate.toLocaleDateString('en-CA');

  endDateInput.value = lastEndDate;
  startDateInput.value = lastStartDate;

  // Trigger initial filter
  applyDateFilter(startDateInput, endDateInput);
}

// Initial update
updateRunningTasksDisplay();
updateCompletedTasksDisplay();

function updateAutocompleteLists() {
  if (removeTaskAutocomplete) removeTaskAutocomplete();
  if (removeProjectAutocomplete) removeProjectAutocomplete();

  removeTaskAutocomplete = setupAutocomplete(taskNameInput, uniqueTasks);
  removeProjectAutocomplete = setupAutocomplete(projectNameInput, uniqueProjects);
}

// Use this function instead of calling setupAutocomplete directly
updateAutocompleteLists();

function setupAutocomplete(input, items) {
  let autocompleteList = null;
  let selectedIndex = -1;

  // Store event listeners so we can remove them later
  const listeners = {
    input: null,
    keydown: null,
    documentClick: null
  };

  function removeListeners() {
    if (listeners.input) input.removeEventListener('input', listeners.input);
    if (listeners.keydown) input.removeEventListener('keydown', listeners.keydown);
    if (listeners.documentClick) document.removeEventListener('click', listeners.documentClick);
  }

  // Remove any existing listeners before setting up new ones
  removeListeners();

  // Set up new listeners
  listeners.input = updateAutocomplete;
  listeners.keydown = handleKeydown;
  listeners.documentClick = documentClickHandler;

  input.addEventListener('input', listeners.input);
  input.addEventListener('keydown', listeners.keydown);
  document.addEventListener('click', listeners.documentClick);

  function createAutocompleteList() {
    if (autocompleteList) {
      autocompleteList.remove();
    }
    autocompleteList = document.createElement('ul');
    autocompleteList.className = 'autocomplete-list';
    autocompleteList.style.display = 'none';
    input.parentNode.insertBefore(autocompleteList, input.nextSibling);
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
    // Use the current items array, not a closure variable
    const currentItems = input === taskNameInput ? uniqueTasks : uniqueProjects;
    const matches = currentItems.filter(item => item.toLowerCase().includes(value));
    
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

  function documentClickHandler(e) {
    if (e.target !== input && autocompleteList) {
      autocompleteList.style.display = 'none';
    }
  }

  // Return a function that can be used to clean up this autocomplete instance
  return removeListeners;
}

noteSelector.addEventListener('change', function() {
  const selectedNoteId = this.value;
  if (selectedNoteId) {
    webviewApi.postMessage({
      name: 'changeNote',
      noteId: selectedNoteId,
      startDate: lastStartDate,
      endDate: lastEndDate
    });
  }
});

function formatDateTime(date) {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

// Wait for 1 second before requesting initial data
setTimeout(requestInitialData, 1000);