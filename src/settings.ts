import joplin from 'api';
import { SettingItemType } from 'api/types'

export async function registerSettings() {
  await joplin.settings.registerSection('timeslip', {
    label: 'Time Slip',
    iconName: 'fas fa-stopwatch',
  });

  await joplin.settings.registerSettings({
    'timeslip.logNoteTag': {
      value: 'time-slip',
      type: SettingItemType.String,
      section: 'timeslip',
      public: true,
      label: 'Time log tag',
      description: 'Tag for notes that contain time tracking logs. Default: time-slip',
    },
    'timeslip.defaultNoteId': {
      value: '',
      type: SettingItemType.String,
      section: 'timeslip',
      public: true,
      label: 'Default time log note ID',
    },
    'timeslip.defaultDateRange': {
      value: 7,
      minimum: 1,
      maximum: 365,
      step: 1,
      type: SettingItemType.Int,
      section: 'timeslip',
      public: true,
      label: 'Default date range (days)',
      description: 'The default last number of days of completed tasks to display. Default: 7',
    },
    'timeslip.aggregationLevel': {
      value: 1,
      type: SettingItemType.Int,
      section: 'timeslip',
      public: true,
      isEnum: true,
      label: 'Aggregation level',
      description: 'For summarising completed tasks',
      options: {
        1: 'Task',
        2: 'Project',
        3: 'Note',
      },
    },
    'timeslip.summarySortOrder': {
      value: 'duration',
      type: SettingItemType.String,
      section: 'timeslip',
      public: true,
      isEnum: true,
      label: 'Sort completed tasks by',
      options: {
        'duration': 'Duration',
        'endTime': 'End Time',
        'name': 'Name',
      },
    },
    'timeslip.logSortOrder': {
      value: 'ascending',
      type: SettingItemType.String,
      section: 'timeslip',
      public: true,
      isEnum: true,
      label: 'Order of time logs',
      description: 'Sort order for tasks in the time log based on start time',
      options: {
        'ascending': 'Ascending',
        'descending': 'Descending',
      },
    },
    'timeslip.enforceLogSort': {
      value: false,
      type: SettingItemType.Bool,
      section: 'timeslip',
      public: true,
      label: 'Auto-sort time logs',
      description: 'Automatically sort tasks in time log notes based on start time',
    },
    'timeslip.showDurationColumn': {
      value: true,
      type: SettingItemType.Bool,
      section: 'timeslip',
      public: true,
      label: 'Show duration column',
      description: 'Display the duration column in the completed tasks table',
    },
    'timeslip.showPercentageColumn': {
      value: true,
      type: SettingItemType.Bool,
      section: 'timeslip',
      public: true,
      label: 'Show percentage column',
      description: 'Display the percentage column in the completed tasks table',
    },
    'timeslip.showEndTimeColumn': {
      value: true,
      type: SettingItemType.Bool,
      section: 'timeslip',
      public: true,
      label: 'Show end time column',
      description: 'Display the end time column in the completed tasks table',
    },
  });
}

export async function getLogNoteTag(): Promise<string> {
  return await joplin.settings.value('timeslip.logNoteTag');
}

export async function getDefaultNoteId(): Promise<string> {
  return await joplin.settings.value('timeslip.defaultNoteId');
}

export async function setDefaultNoteId(noteId: string): Promise<void> {
  await joplin.settings.setValue('timeslip.defaultNoteId', noteId);
}

export async function getDefaultDateRange(): Promise<number> {
  return await joplin.settings.value('timeslip.defaultDateRange');
}

export async function getAggregationLevel(): Promise<number> {
  return await joplin.settings.value('timeslip.aggregationLevel');
}

export async function setAggregationLevel(level: number): Promise<void> {
  await joplin.settings.setValue('timeslip.aggregationLevel', level);
}

export async function getSummarySortOrder(): Promise<'duration' | 'endTime' | 'name'> {
  return await joplin.settings.value('timeslip.summarySortOrder') as 'duration' | 'endTime' | 'name';
}

export async function setSummarySortOrder(sortOrder: 'duration' | 'endTime' | 'name'): Promise<void> {
  await joplin.settings.setValue('timeslip.summarySortOrder', sortOrder);
}

export async function getLogSortOrder(): Promise<'ascending' | 'descending'> {
  return await joplin.settings.value('timeslip.logSortOrder') as 'ascending' | 'descending';
}

export async function setLogSortOrder(sortOrder: 'ascending' | 'descending'): Promise<void> {
  await joplin.settings.setValue('timeslip.logSortOrder', sortOrder);
}

export async function getEnforceSorting(): Promise<boolean> {
  return await joplin.settings.value('timeslip.enforceLogSort');
}

export async function setEnforceSorting(enforce: boolean): Promise<void> {
  await joplin.settings.setValue('timeslip.enforceLogSort', enforce);
}

let currentStartDate: string | null = null;
let currentEndDate: string | null = null;

export async function getCurrentDateRange(): Promise<{ startDate: string | null; endDate: string | null }> {
  if (currentStartDate && currentEndDate) {
    return { startDate: currentStartDate, endDate: currentEndDate };
  } else {
    const defaultRange = await getDefaultDateRange();
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - defaultRange + 1);
    return {
      startDate: startDate.toLocaleDateString('en-CA'),
      endDate: endDate.toLocaleDateString('en-CA')
    };
  }
}

export function setCurrentDateRange(startDate: string | null, endDate: string | null): void {
  currentStartDate = startDate;
  currentEndDate = endDate;
}

export async function getShowDurationColumn(): Promise<boolean> {
  return await joplin.settings.value('timeslip.showDurationColumn');
}

export async function getShowPercentageColumn(): Promise<boolean> {
  return await joplin.settings.value('timeslip.showPercentageColumn');
}

export async function getShowEndTimeColumn(): Promise<boolean> {
  return await joplin.settings.value('timeslip.showEndTimeColumn');
}
