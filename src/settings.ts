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
      label: 'Log note tag',
      description: 'Tag for notes that contain time tracking logs. Default: time-slip',
    },
    'timeslip.defaultNoteId': {
      value: '',
      type: SettingItemType.String,
      section: 'timeslip',
      public: true,
      label: 'Default log note ID',
    },
    'timeslip.defaultDateRange': {
      value: 7,
      type: SettingItemType.Int,
      section: 'timeslip',
      public: true,
      label: 'Default date range (days)',
      description: 'The default number of days to show in the completed tasks list. Default: 7',
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
