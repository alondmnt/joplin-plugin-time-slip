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
let lastStartDate = '';
let lastEndDate = '';

let removeTaskAutocomplete = null;
let removeProjectAutocomplete = null;

let runningTasksInterval;

const aggregationSlider = document.getElementById('aggregationSlider');
let currentAggregationLevel = 1;

// Add this variable at the top of the file
let selectedNoteName = '';

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

function startUpdatingRunningTasks() {
  if (!runningTasksInterval) {
    runningTasksInterval = setInterval(updateRunningTasksDisplay, 1000);
  }
}

function stopUpdatingRunningTasks() {
  if (runningTasksInterval) {
    clearInterval(runningTasksInterval);
    runningTasksInterval = null;
  }
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
  noteSelector.innerHTML = (logNotes.length > 0) ? '' : `<option value="">Tag a note with a time-slip tag</option>`;
  logNotes.forEach(note => {
    const option = document.createElement('option');
    option.value = note.id;
    option.textContent = note.title;
    noteSelector.appendChild(option);
  });
  if (logNotes.length > 0) {
    if (previousNoteId && logNotes.some(note => note.id === previousNoteId)) {
      noteSelector.value = previousNoteId;
    } else {
      noteSelector.value = logNotes[0].id;
      // Trigger the change event to initialize the note
      noteSelector.dispatchEvent(new Event('change'));
    }
  } else {
    noteSelector.dispatchEvent(new Event('change'));
  }
}

// Update the noteSelector event listener
noteSelector.addEventListener('change', function() {
  const selectedNoteId = this.value;
  selectedNoteName = this.options[this.selectedIndex].text;
  webviewApi.postMessage({
    name: 'changeNote',
    noteId: selectedNoteId,
    startDate: lastStartDate,
    endDate: lastEndDate
  });
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
    updateAutocompleteLists();
    
    // If there's a default note ID, select it and set the selectedNoteName
    if (message.defaultNoteId && noteSelector.querySelector(`option[value="${message.defaultNoteId}"]`)) {
      noteSelector.value = message.defaultNoteId;
      selectedNoteName = noteSelector.options[noteSelector.selectedIndex].text;
      noteSelector.dispatchEvent(new Event('change'));
    }

  } else if (message.name === 'updateLogNotes') {
    updateNoteSelector(message.notes);

  } else if (message.name === 'defaultDateRange') {
    const defaultDateRange = message.value;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - defaultDateRange + 1);

    const endDateInput = document.getElementById('endDate');
    const startDateInput = document.getElementById('startDate');

    lastEndDate = endDate.toLocaleDateString('en-CA');
    lastStartDate = startDate.toLocaleDateString('en-CA');

    endDateInput.value = lastEndDate;
    startDateInput.value = lastStartDate;

    // Trigger initial filter
    applyDateFilter(startDateInput, endDateInput);
  }
});

// Update the updateCompletedTasksDisplay function
function updateCompletedTasksDisplay() {
  const completedTasksDiv = document.getElementById('completedTasks');

  let tasksHtml = '';

  if (completedTasks.length > 0) {
    const aggregatedTasks = aggregateTasks(completedTasks, currentAggregationLevel);
    
    tasksHtml += '<table>';
    
    // Table header based on aggregation level
    if (currentAggregationLevel === 1) {
      tasksHtml += '<tr><th>Task</th><th>Project</th><th>Duration</th><th>Action</th></tr>';
    } else if (currentAggregationLevel === 2) {
      tasksHtml += '<tr><th>Project</th><th>Duration</th></tr>';
    } else {
      tasksHtml += '<tr><th>Note</th><th>Duration</th></tr>';
    }

    aggregatedTasks.forEach(({ name, duration, originalTask, originalProject }) => {
      const formattedDuration = formatDuration(Math.floor(duration / 1000));
      
      if (currentAggregationLevel === 1) {
        tasksHtml += `<tr>
          <td>${originalTask}</td>
          <td>${originalProject}</td>
          <td>${formattedDuration}</td>
          <td><button class="startButton" data-task="${originalTask}" data-project="${originalProject}">Start</button></td>
        </tr>`;
      } else if (currentAggregationLevel === 2) {
        tasksHtml += `<tr>
          <td>${name}</td>
          <td>${formattedDuration}</td>
        </tr>`;
      } else {
        tasksHtml += `<tr>
          <td>${selectedNoteName || 'No note selected'}</td>
          <td>${formattedDuration}</td>
        </tr>`;
      }
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
}

function aggregateTasks(tasks, level) {
  if (level === 1) {
    return tasks.map(task => ({
      name: task.taskName,
      duration: task.duration,
      originalTask: task.taskName,
      originalProject: task.project
    }));
  }

  const aggregated = tasks.reduce((acc, task) => {
    const key = level === 2 ? task.project : 'Total';
    if (!acc[key]) {
      acc[key] = { name: key, duration: 0, tasks: [] };
    }
    acc[key].duration += task.duration;
    acc[key].tasks.push(task);
    return acc;
  }, {});

  return Object.values(aggregated).map(item => ({
    name: item.name,
    duration: item.duration,
    originalTask: item.tasks[0].taskName,
    originalProject: item.tasks[0].project
  }));
}

aggregationSlider.addEventListener('input', function() {
  currentAggregationLevel = parseInt(this.value);
  updateCompletedTasksDisplay();
});

// Initialize date inputs and add event listeners
function initializeDateInputs() {
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');

  startDateInput.addEventListener('change', () => applyDateFilter(startDateInput, endDateInput));
  endDateInput.addEventListener('change', () => applyDateFilter(startDateInput, endDateInput));

  // Use the defaultDateRange setting
  webviewApi.postMessage({
    name: 'getDefaultDateRange'
  });
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

function updateAutocompleteLists() {
  if (removeTaskAutocomplete) removeTaskAutocomplete();
  if (removeProjectAutocomplete) removeProjectAutocomplete();

  removeTaskAutocomplete = setupAutocomplete(taskNameInput, uniqueTasks);
  removeProjectAutocomplete = setupAutocomplete(projectNameInput, uniqueProjects);
}

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

function formatDateTime(date) {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

initializeDateInputs();
// Wait for 1 second before requesting initial data
setTimeout(requestInitialData, 1000);