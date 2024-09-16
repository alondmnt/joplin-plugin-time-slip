import joplin from 'api';
import { SettingItemType } from 'api/types';

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
      label: 'Log Note Tag',
      description: 'Tag for notes that contain time slips. Default: time-slip.',
    }
  });
}