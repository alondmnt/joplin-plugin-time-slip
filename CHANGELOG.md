# [v1.03](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v1.03)
*Released on 2025-04-14T12:52:19Z*

- added: dismissPluginPanels on mobile

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v1.0.2...v1.03

---

# [v1.0.2](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v1.0.2)
*Released on 2024-11-12T05:32:49Z*

- fixed: CSS border-color

---

# [v1.0.1](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v1.0.1)
*Released on 2024-11-02T00:50:13Z*

- fixed: sorted autocomplete (regression)

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v1.0.0...v1.0.1

---

# [v1.0.0](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v1.0.0)
*Released on 2024-10-25T13:43:02Z*

- added: commands for exporting to markdown and importing from markdown (see screen capture)
    - Note -> Insert Time Slip markdown log
    - Note -> Insert Time Slip markdown summary
    - Tools -> Convert selected table to CSV
- fixed: Enter key press when no autocomplete item is selected
- improved: organise commands in Note / Tools menus
- improved: debounce using lodash

![time-slip-markdown](https://github.com/user-attachments/assets/57977c90-0db3-4775-afc8-8765f5f3e849)

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.4.1...v1.0.0

---

# [v0.4.1](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.4.1)
*Released on 2024-10-18T00:33:09Z*

- fixed: handle case where log note tag is not first page of tags (by @ncatanchin) (#1)
- fixed: handle more than 100 logs

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.4.0...v0.4.1

---

# [v0.4.0](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.4.0)
*Released on 2024-10-13T12:37:24Z*

- added: setting `Order of time logs` (ascending / descending by start time)
- added: setting `Auto-sort time logs`
- added: command `Sort Time Slip log` (under the `Note` menu)
- added: command `Copy Time Slip summary` (under the `Note` menu)
- fixed: get selected note before calling debounce to handle note switching properly
- fixed: ensure the log note list is unique
- improved: sort note only when unsorted
- improved: panel date/time format matches log
- improved: copy summary table with separate date/time cols
- improved: settings descriptions
- refactored: scan note and update tasks

![time-slip-sort](https://github.com/user-attachments/assets/8c3aed47-7116-4711-a3cf-bcd5b380e4b2)

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.3.2...v0.4.0

---

# [v0.3.2](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.3.2)
*Released on 2024-10-07T10:42:04Z*

- added: Escape keypress handling in text boxes
- improved: show all 5 summary columns when panel is wide enough
- improved: rewrite autocomplete lists

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.3.1...v0.3.2

---

# [v0.3.1](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.3.1)
*Released on 2024-10-04T15:47:18Z*

- fixed: handle multiple identical time-slip tags

---

# [v0.3.0](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.3.0)
*Released on 2024-10-04T11:34:35Z*

- added: sort completed tasks by duration, end time or name
- fixed: memory leak
- improved: sorted autocomplete
- improved: debounce updates on note change

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.2.4...v0.3.0

---

# [v0.2.4](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.2.4)
*Released on 2024-09-28T13:33:00Z*

- added: open note button
- improved: filter tasks by start time only
    - example: if a task started on Monday and ended on Tuesday, it will be counted towards Monday's sum of hours, but not Tuesday's, to avoid the appearance of being counted twice
- fixed: single message sent from panel when starting a completed task
- improved: style

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.2.3...v0.2.4

---

# [v0.2.3](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.2.3)
*Released on 2024-09-21T09:31:36Z*

- added: section divider
- improved: hide aggregation slider when no tasks
- improved: init note selection message

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.2.1...v0.2.3

---

# [v0.2.1](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.2.1)
*Released on 2024-09-20T02:12:20Z*

- added: toggle panel command in the View menu

---

# [v0.2.0](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.2.0)
*Released on 2024-09-19T13:37:06Z*

- added: summary aggregation by task, project or note
- added: summary filtering by free text
- added: when edits are made to the selected time note, duration is recalculated automatically
- added: more flexible CSV format based on column names
    - example: one could import Toggl exports by pasting the CSV into a note (after removing quotation marks from the CSV)
- added: tooltips
- fixed: correct number of days in date range (one less)
- improved: UI responsiveness 

![time-slip](https://github.com/user-attachments/assets/817eca53-bb36-4170-aec4-53ccb7d1f4dd)

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-time-slip/compare/v0.1.0...v0.2.0

---

# [v0.1.0](https://github.com/alondmnt/joplin-plugin-time-slip/releases/tag/v0.1.0)
*Released on 2024-09-16T13:28:49Z*

- manage multiple concurrent timers, saved into multiple logs
- sync completed and running tasks across devices
- display summaries by date ranges
- logs are saved in Joplin notes in a simple-to-export CSV format

![time-slip](https://github.com/user-attachments/assets/269cad0e-58af-4abd-994d-35449d8c0b66)

---
