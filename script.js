(() => {
  "use strict";

  const Core = window.DaybookCore;

  const STORAGE_KEY = "daybook.items.v2";
  const LEGACY_KEY = "daybook.items.v1";
  const THEME_KEY = "daybook.theme";
  const UNDO_MS = 7000;

  const THEMES = [
    { id: "system", label: "Auto" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };
  const DEFAULT_FILTERS = { query: "", priority: "all", category: "all", sort: "newest" };

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  /* ------------------------------------------------------------------------
     DOM references
     ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const dom = {
    form: $("task-form"),
    input: $("task-input"),
    priority: $("task-priority"),
    due: $("task-due"),
    category: $("task-category"),
    categoryList: $("category-list"),
    error: $("task-error"),
    search: $("search"),
    filterPriority: $("filter-priority"),
    filterCategory: $("filter-category"),
    sort: $("sort"),
    resetFilters: $("reset-filters"),
    pendingList: $("pending-list"),
    doneList: $("done-list"),
    pendingCount: $("pending-count"),
    doneCount: $("done-count"),
    pendingEmpty: $("pending-empty"),
    doneEmpty: $("done-empty"),
    progress: $("progress"),
    progressFill: $("progress-fill"),
    progressLabel: $("progress-label"),
    statPending: $("stat-pending"),
    statOverdue: $("stat-overdue"),
    statOverdueBox: $("stat-overdue-box"),
    statToday: $("stat-today"),
    statPercent: $("stat-percent"),
    status: $("status"),
    toast: $("toast"),
    toastText: $("toast-text"),
    toastUndo: $("toast-undo"),
    themeBtn: $("theme-btn"),
    helpBtn: $("help-btn"),
    help: $("help"),
    exportBtn: $("export-btn"),
    importBtn: $("import-btn"),
    importFile: $("import-file"),
    clearBtn: $("clear-btn"),
  };

  /* ------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------ */
  const state = {
    items: [],
    filters: { ...DEFAULT_FILTERS },
    editingId: null,
    focusEditField: false,
    flashId: null,
    focusAfterRender: null,
    undoSnapshot: null,
  };

  /* ------------------------------------------------------------------------
     Storage
     ------------------------------------------------------------------------ */
  function readKey(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? Core.sanitizeList(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  // Reads the current format first, then upgrades data saved by version 1.
  function loadItems() {
    return readKey(STORAGE_KEY) ?? readKey(LEGACY_KEY) ?? [];
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    } catch {
      /* Storage can be unavailable (private mode, quota). The app keeps working in memory. */
    }
  }

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  function createId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function announce(message) {
    dom.status.textContent = "";
    requestAnimationFrame(() => {
      dom.status.textContent = message;
    });
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key in node && key !== "list") node[key] = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function timeTag(label, timestamp) {
    return el("time", {
      dateTime: new Date(timestamp).toISOString(),
      text: `${label} ${dateFormat.format(timestamp)}`,
    });
  }

  function button(label, action, variant = "") {
    return el("button", {
      type: "button",
      className: `btn ${variant}`.trim(),
      text: label,
      dataset: { action },
    });
  }

  function cloneItems(items) {
    return items.map((item) => ({ ...item }));
  }

  function filtersActive() {
    const f = state.filters;
    return Boolean(Core.normalise(f.query)) || f.priority !== "all" || f.category !== "all";
  }

  /* ------------------------------------------------------------------------
     Undo toast
     ------------------------------------------------------------------------ */
  let toastTimer = 0;

  function hideToast() {
    clearTimeout(toastTimer);
    dom.toast.hidden = true;
    state.undoSnapshot = null;
  }

  function showToast(message, snapshot = null) {
    clearTimeout(toastTimer);
    state.undoSnapshot = snapshot;
    dom.toastText.textContent = message;
    dom.toastUndo.hidden = !snapshot;
    dom.toast.hidden = false;
    toastTimer = setTimeout(hideToast, UNDO_MS);
  }

  function undo() {
    if (!state.undoSnapshot) return;
    state.items = state.undoSnapshot;
    state.editingId = null;
    hideToast();
    saveItems();
    render();
    announce("Change undone.");
  }

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */
  function makePrioritySelect(value) {
    const select = el(
      "select",
      { className: "edit__select", name: "priority", "aria-label": "Priority" },
      Object.entries(PRIORITY_LABEL).map(([id, text]) => el("option", { value: id, text }))
    );
    select.value = value;
    return select;
  }

  function buildViewItem(item) {
    const due = Core.dueInfo(item.due, item.done, Date.now());

    const chips = el("div", { className: "item__chips" }, [
      el("span", {
        className: `chip chip--${item.priority}`,
        text: `${PRIORITY_LABEL[item.priority]} priority`,
      }),
      item.category ? el("span", { className: "chip", text: item.category }) : null,
      due.label ? el("span", { className: `chip chip--${due.status}`, text: due.label }) : null,
    ]);

    const meta = el("p", { className: "item__meta" }, [
      timeTag("Added", item.createdAt),
      item.done && item.completedAt ? timeTag("Completed", item.completedAt) : null,
    ]);

    const actions = el("div", { className: "item__actions" }, [
      item.done
        ? button("Mark Pending", "toggle")
        : button("Mark Complete", "toggle", "btn--complete"),
      button("Edit", "edit"),
      button("Delete", "delete", "btn--danger"),
    ]);

    return [el("p", { className: "item__text", text: item.text }), chips, meta, actions];
  }

  function buildEditItem(item) {
    const text = el("input", {
      className: "edit__input",
      type: "text",
      name: "text",
      value: item.text,
      maxLength: Core.MAX_TEXT,
      autocomplete: "off",
      "aria-label": "Edit task text",
    });

    const due = el("input", {
      className: "edit__input",
      type: "date",
      name: "due",
      value: item.due ?? "",
      "aria-label": "Due date",
    });

    const category = el("input", {
      className: "edit__input",
      type: "text",
      name: "category",
      value: item.category,
      maxLength: Core.MAX_CATEGORY,
      placeholder: "Category",
      list: "category-list",
      autocomplete: "off",
      "aria-label": "Category",
    });

    const error = el("p", { className: "edit__error", role: "alert", hidden: true });

    const form = el("form", { className: "edit", noValidate: true, dataset: { edit: "" } }, [
      text,
      el("div", { className: "edit__row" }, [makePrioritySelect(item.priority), due, category]),
      error,
      el("div", { className: "item__actions" }, [
        el("button", { type: "submit", className: "btn btn--primary", text: "Save" }),
        button("Cancel", "cancel"),
      ]),
    ]);

    return [form];
  }

  function buildItem(item) {
    const isEditing = state.editingId === item.id;
    return el(
      "li",
      {
        className: `item${item.done ? " item--done" : ""}`,
        dataset: { id: item.id },
      },
      isEditing ? buildEditItem(item) : buildViewItem(item)
    );
  }

  function paint(list, items) {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.append(buildItem(item)));
    list.replaceChildren(fragment);
  }

  function syncCategories() {
    const cats = Core.categories(state.items);
    const current = state.filters.category;
    if (current !== "all" && !cats.some((c) => c.toLowerCase() === current.toLowerCase())) {
      state.filters.category = "all";
    }
    dom.filterCategory.replaceChildren(
      el("option", { value: "all", text: "All" }),
      ...cats.map((c) => el("option", { value: c, text: c }))
    );
    dom.filterCategory.value = state.filters.category;
    dom.categoryList.replaceChildren(...cats.map((c) => el("option", { value: c })));
  }

  function setEmpty(node, hasAny, defaults) {
    const filtered = filtersActive() && hasAny;
    node.querySelector(".empty__title").textContent = filtered ? "No matching tasks" : defaults[0];
    node.querySelector(".empty__hint").textContent = filtered
      ? "Try a different search or clear the filters."
      : defaults[1];
  }

  function render() {
    const now = Date.now();
    const pendingAll = state.items.filter((item) => !item.done);
    const doneAll = state.items.filter((item) => item.done);

    const pending = Core.sortPending(
      pendingAll.filter((item) => Core.matches(item, state.filters)),
      state.filters.sort
    );
    const done = Core.sortDone(doneAll.filter((item) => Core.matches(item, state.filters)));

    syncCategories();
    paint(dom.pendingList, pending);
    paint(dom.doneList, done);

    dom.pendingEmpty.hidden = pending.length > 0;
    dom.doneEmpty.hidden = done.length > 0;
    setEmpty(dom.pendingEmpty, pendingAll.length > 0, ["Nothing pending", "Add a task above to get started."]);
    setEmpty(dom.doneEmpty, doneAll.length > 0, ["Nothing completed yet", "Finished tasks will show up here."]);

    const filtered = filtersActive();
    dom.pendingCount.textContent = filtered
      ? `${pending.length} of ${pendingAll.length} pending`
      : `${pending.length} pending`;
    dom.doneCount.textContent = filtered
      ? `${done.length} of ${doneAll.length} completed`
      : `${done.length} completed`;
    dom.resetFilters.hidden = !filtered;

    const summary = Core.stats(state.items, now);
    dom.statPending.textContent = String(summary.pending);
    dom.statOverdue.textContent = String(summary.overdue);
    dom.statOverdueBox.classList.toggle("is-active", summary.overdue > 0);
    dom.statToday.textContent = String(summary.doneToday);
    dom.statPercent.textContent = `${summary.percent}%`;

    dom.progressFill.style.width = `${summary.percent}%`;
    dom.progress.setAttribute("aria-valuenow", String(summary.percent));
    dom.progressLabel.textContent =
      summary.total === 0 ? "No tasks yet" : `${summary.done} of ${summary.total} done`;

    afterRender();
  }

  function afterRender() {
    if (state.editingId && state.focusEditField) {
      const field = document.querySelector(".edit__input");
      if (field) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      }
      state.focusEditField = false;
    }

    if (state.flashId) {
      const node = document.querySelector(`[data-id="${CSS.escape(state.flashId)}"]`);
      if (node) {
        node.classList.add("item--flash");
        if (state.focusAfterRender === "item") {
          node.querySelector("button")?.focus();
        }
      }
      state.flashId = null;
    }

    if (state.focusAfterRender && typeof state.focusAfterRender === "object") {
      const { list, index } = state.focusAfterRender;
      const siblings = list.querySelectorAll(".item");
      const target = siblings[Math.min(index, siblings.length - 1)];
      (target?.querySelector("button") ?? dom.input).focus();
    }

    state.focusAfterRender = null;
  }

  /* ------------------------------------------------------------------------
     Filters
     ------------------------------------------------------------------------ */
  function syncFilterControls() {
    dom.search.value = state.filters.query;
    dom.filterPriority.value = state.filters.priority;
    dom.filterCategory.value = state.filters.category;
    dom.sort.value = state.filters.sort;
  }

  function resetFilters() {
    state.filters = { ...DEFAULT_FILTERS, sort: state.filters.sort };
    syncFilterControls();
  }

  function applyFilters() {
    state.editingId = null;
    render();
  }

  /* ------------------------------------------------------------------------
     Actions
     ------------------------------------------------------------------------ */
  function addItem(fields) {
    hideToast();
    const item = Core.createItem(fields, Date.now(), createId());
    state.items.push(item);

    // Never hide the task the person just added behind an active filter.
    if (!Core.matches(item, state.filters)) resetFilters();

    state.flashId = item.id;
    saveItems();
    render();
    announce("Task added to pending.");
  }

  function toggleItem(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;

    hideToast();
    item.done = !item.done;
    item.completedAt = item.done ? Date.now() : null;
    state.flashId = item.id;
    state.focusAfterRender = "item";
    saveItems();
    render();
    announce(item.done ? "Task marked complete." : "Task moved back to pending.");
  }

  function deleteItem(id, listElement) {
    const index = state.items.findIndex((entry) => entry.id === id);
    if (index === -1) return;

    const snapshot = cloneItems(state.items);
    const position = [...listElement.children].findIndex((node) => node.dataset.id === id);
    state.items.splice(index, 1);
    if (state.editingId === id) state.editingId = null;
    state.focusAfterRender = { list: listElement, index: position };
    saveItems();
    render();
    showToast("Task deleted.", snapshot);
    announce("Task deleted. Undo is available for a few seconds.");
  }

  function clearCompleted() {
    const count = state.items.filter((item) => item.done).length;
    if (count === 0) {
      showToast("There are no completed tasks to clear.");
      announce("There are no completed tasks to clear.");
      return;
    }
    const snapshot = cloneItems(state.items);
    state.items = state.items.filter((item) => !item.done);
    state.editingId = null;
    saveItems();
    render();
    const message = `Cleared ${count} completed ${count === 1 ? "task" : "tasks"}.`;
    showToast(message, snapshot);
    announce(`${message} Undo is available for a few seconds.`);
  }

  function startEdit(id) {
    hideToast();
    state.editingId = id;
    state.focusEditField = true;
    render();
  }

  function cancelEdit() {
    const id = state.editingId;
    state.editingId = null;
    state.focusAfterRender = "item";
    state.flashId = id;
    render();
  }

  function saveEdit(id, fields, fieldElements) {
    const text = Core.normalise(fields.text);
    const category = Core.normalise(fields.category);
    const message = Core.validateText(text) || Core.validateCategory(category);

    if (message) {
      fieldElements.error.textContent = message;
      fieldElements.error.hidden = false;
      fieldElements.text.setAttribute("aria-invalid", "true");
      fieldElements.text.focus();
      return;
    }

    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;

    item.text = text;
    item.category = category;
    item.priority = Core.PRIORITIES.includes(fields.priority) ? fields.priority : item.priority;
    item.due = Core.parseDue(fields.due) !== null ? fields.due : null;
    state.editingId = null;
    state.flashId = id;
    state.focusAfterRender = "item";
    saveItems();
    render();
    announce("Task updated.");
  }

  /* ------------------------------------------------------------------------
     Import / export
     ------------------------------------------------------------------------ */
  function exportItems() {
    const payload = {
      app: "daybook",
      version: 2,
      exportedAt: new Date().toISOString(),
      items: state.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `daybook-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Tasks exported.");
  }

  async function importItems(file) {
    if (!file) return;
    let text = "";
    try {
      text = await file.text();
    } catch {
      showToast("That file could not be read.");
      return;
    }

    const result = Core.parseImport(text);
    if (result.error) {
      showToast(result.error);
      announce(result.error);
      return;
    }

    const snapshot = cloneItems(state.items);
    const merged = Core.mergeItems(state.items, result.items);
    if (merged.added === 0) {
      showToast("Those tasks are already in your list.");
      return;
    }

    state.items = merged.items;
    saveItems();
    render();
    const message = `Imported ${merged.added} ${merged.added === 1 ? "task" : "tasks"}.`;
    showToast(message, snapshot);
    announce(message);
  }

  /* ------------------------------------------------------------------------
     Theme
     ------------------------------------------------------------------------ */
  function currentTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.some((t) => t.id === saved) ? saved : "system";
    } catch {
      return "system";
    }
  }

  function applyTheme(id) {
    const root = document.documentElement;
    if (id === "system") delete root.dataset.theme;
    else root.dataset.theme = id;
    const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
    dom.themeBtn.textContent = `Theme: ${theme.label}`;
  }

  function cycleTheme() {
    const index = THEMES.findIndex((t) => t.id === currentTheme());
    const next = THEMES[(index + 1) % THEMES.length];
    try {
      localStorage.setItem(THEME_KEY, next.id);
    } catch {
      /* Theme still applies for this visit. */
    }
    applyTheme(next.id);
    announce(`Theme set to ${next.label.toLowerCase()}.`);
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */
  function showComposerError(message) {
    dom.error.textContent = message;
    dom.error.hidden = !message;
    if (message) dom.input.setAttribute("aria-invalid", "true");
    else dom.input.removeAttribute("aria-invalid");
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = Core.normalise(dom.input.value);
    const category = Core.normalise(dom.category.value);
    const message = Core.validateText(text) || Core.validateCategory(category);

    if (message) {
      showComposerError(message);
      dom.input.focus();
      return;
    }

    showComposerError("");
    addItem({
      text,
      priority: dom.priority.value,
      due: dom.due.value,
      category,
    });
    dom.form.reset();
    dom.input.focus();
  });

  dom.input.addEventListener("input", () => {
    if (!dom.error.hidden) showComposerError("");
  });

  dom.category.addEventListener("input", () => {
    if (!dom.error.hidden) showComposerError("");
  });

  function handleListClick(event) {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;

    const listElement = event.currentTarget;
    const id = trigger.closest(".item")?.dataset.id;
    if (!id) return;

    switch (trigger.dataset.action) {
      case "toggle":
        toggleItem(id);
        break;
      case "edit":
        startEdit(id);
        break;
      case "delete":
        deleteItem(id, listElement);
        break;
      case "cancel":
        cancelEdit();
        break;
    }
  }

  function handleListSubmit(event) {
    if (!event.target.matches("[data-edit]")) return;
    event.preventDefault();

    const form = event.target;
    const id = form.closest(".item")?.dataset.id;
    if (!id) return;

    const fields = {
      text: form.elements.text.value,
      priority: form.elements.priority.value,
      due: form.elements.due.value,
      category: form.elements.category.value,
    };
    saveEdit(id, fields, {
      text: form.elements.text,
      error: form.querySelector(".edit__error"),
    });
  }

  function handleListKeydown(event) {
    if (event.key === "Escape" && event.target.matches(".edit__input, .edit__select")) {
      event.preventDefault();
      cancelEdit();
    }
  }

  function handleEditInput(event) {
    if (!event.target.matches(".edit__input")) return;
    const form = event.target.closest(".edit");
    const error = form.querySelector(".edit__error");
    if (!error.hidden) {
      error.hidden = true;
      form.elements.text.removeAttribute("aria-invalid");
    }
  }

  [dom.pendingList, dom.doneList].forEach((list) => {
    list.addEventListener("click", handleListClick);
    list.addEventListener("submit", handleListSubmit);
    list.addEventListener("keydown", handleListKeydown);
    list.addEventListener("input", handleEditInput);
  });

  // Search, filters and sorting
  dom.search.addEventListener("input", () => {
    state.filters.query = dom.search.value;
    applyFilters();
  });

  dom.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.search.value) {
      event.preventDefault();
      dom.search.value = "";
      state.filters.query = "";
      applyFilters();
    }
  });

  dom.filterPriority.addEventListener("change", () => {
    state.filters.priority = dom.filterPriority.value;
    applyFilters();
  });

  dom.filterCategory.addEventListener("change", () => {
    state.filters.category = dom.filterCategory.value;
    applyFilters();
  });

  dom.sort.addEventListener("change", () => {
    state.filters.sort = dom.sort.value;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    resetFilters();
    applyFilters();
    dom.search.focus();
  });

  // Data tools, toast, theme and help
  dom.exportBtn.addEventListener("click", exportItems);
  dom.importBtn.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", () => {
    importItems(dom.importFile.files[0]);
    dom.importFile.value = "";
  });
  dom.clearBtn.addEventListener("click", clearCompleted);
  dom.toastUndo.addEventListener("click", undo);
  dom.themeBtn.addEventListener("click", cycleTheme);
  dom.helpBtn.addEventListener("click", () => dom.help.showModal());

  // Keyboard shortcuts (ignored while typing or when a dialog is open).
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, dialog")) return;

    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      dom.input.focus();
    } else if (event.key === "/") {
      event.preventDefault();
      dom.search.focus();
    } else if (event.key === "?") {
      event.preventDefault();
      dom.help.showModal();
    }
  });

  // Keep multiple open tabs in sync.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state.items = loadItems();
    state.editingId = null;
    hideToast();
    render();
  });

  // Refresh due-date labels when the tab becomes visible again (for example the next morning).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.editingId) render();
  });

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */
  applyTheme(currentTheme());
  state.items = loadItems();
  render();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* Offline support is a bonus; the app works without it. */
    });
  }
})();
