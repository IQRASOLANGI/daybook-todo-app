# Daybook

A fast, keyboard-friendly to-do list with priorities, due dates, categories, search and undo. Built with plain HTML, CSS and JavaScript. No frameworks, no build step, and it works offline.

**Live demo:** [iqrasolangi.github.io/daybook-todo-app](https://iqrasolangi.github.io/daybook-todo-app/)
**Unit tests:** [run them in your browser](https://iqrasolangi.github.io/daybook-todo-app/tests.html)

![Daybook screenshot](screenshot.png)

## Features

**Tasks**
- Add tasks with a priority (High, Medium, Low), an optional due date and a category
- Mark tasks complete and move them back, edit every field inline, delete from either list
- Due-date labels that update with the day: "Due today", "Due in 3 days", "Overdue by 2 days"

**Finding things**
- Live search across task text and categories
- Filter by priority or category, and sort pending tasks by newest, due date or priority
- Summary of pending, overdue, completed today and overall progress

**Safe by design**
- Undo for delete, clear completed and import, available for a few seconds after the action
- Export tasks to a JSON file and import them back, with duplicates skipped
- Input validation with inline, screen-reader-friendly error messages

**Polish**
- Installable and fully offline through a service worker and web app manifest
- Light, dark and automatic themes, remembered between visits
- Keyboard shortcuts: `N` new task, `/` search, `?` shortcut list, `Esc` cancel
- Responsive layout, visible focus states, reduced-motion support and live-region announcements
- Data persists in `localStorage` and stays in sync across open tabs

## Tech stack

- HTML5 with semantic markup
- CSS3 (custom properties, Grid, Flexbox, light and dark themes)
- JavaScript (ES6+, no frameworks or build tools)
- Web Storage API, Service Worker and Web App Manifest
- GitHub Pages for hosting

## Run it locally

1. Clone the repository:

   ```bash
   git clone https://github.com/IQRASOLANGI/daybook-todo-app.git
   cd daybook-todo-app
   ```

2. Open `index.html` in any modern browser.

To serve it locally instead (needed to try the offline and install features):

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Tests

Open `tests.html` in a browser, or use the [hosted version](https://iqrasolangi.github.io/daybook-todo-app/tests.html). It runs 39 unit tests against the pure logic in `core.js` and shows a pass or fail result for each one.

The same logic also runs in Node: `require("./core.js")` returns the same functions.

## Project structure

```
index.html            Page structure and semantic markup
styles.css            Design tokens, layout, components, light and dark themes
core.js               Pure logic: validation, dates, sorting, filtering, import and export
script.js             State, storage, rendering and event handling
tests.html            Unit tests for core.js
sw.js                 Service worker for offline support
manifest.webmanifest  Install metadata
icon.svg              App icon
screenshot.png        Preview image used in this README
```

## Engineering notes

- **Separation of concerns.** All logic that does not touch the page lives in `core.js`, which has no DOM access. That is what makes it unit testable. `script.js` only handles state, rendering and events.
- **Data migration.** Tasks saved by version 1 (no priority, category or due date) load cleanly. `sanitizeItem` fills in defaults, and the data is saved in the new format on the next change.
- **Defensive loading.** Stored and imported data is validated item by item. Corrupted entries and duplicate ids are dropped instead of breaking the page.
- **Undo.** Destructive actions take a snapshot of the list first. Undo restores the snapshot, so it works the same for delete, clear completed and import.
- **Security.** All user text is inserted with `textContent`, never `innerHTML`, so input cannot inject markup.
- **Event handling.** One set of delegated listeners serves both lists, so no inline `onclick` attributes are used.
- **Accessibility.** Semantic landmarks, labelled controls, a skip link, focus moved sensibly after every action, and status messages announced through an `aria-live` region.
- **Offline.** The service worker caches the app shell and refreshes it in the background on each visit. Fonts load from Google Fonts with system-font fallbacks, so the app still looks right offline.

## Ideas for next

- Drag-and-drop reordering
- Recurring tasks
- Sync across devices with a small backend

## Author

Built by Iqra Solangi. [GitHub](https://github.com/IQRASOLANGI) · [LinkedIn](https://www.linkedin.com/in/iqra-solangi-a65945334)
