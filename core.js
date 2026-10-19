/* ==========================================================================
   Daybook core: pure functions with no DOM access, so they can be unit tested.
   Loaded by index.html (window.DaybookCore) and tests.html.
   ========================================================================== */
(function (root) {
  "use strict";

  const MAX_TEXT = 140;
  const MAX_CATEGORY = 20;
  const PRIORITIES = ["high", "medium", "low"];
  const WEIGHT = { high: 0, medium: 1, low: 2 };
  const DAY = 86400000;

  /* ---- Text ------------------------------------------------------------- */
  function normalise(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }

  function validateText(text) {
    if (!text) return "Enter a task before adding it.";
    if (text.length > MAX_TEXT) return `Keep it under ${MAX_TEXT} characters.`;
    return "";
  }

  function validateCategory(category) {
    if (category.length > MAX_CATEGORY) return `Keep categories under ${MAX_CATEGORY} characters.`;
    return "";
  }

  /* ---- Dates ------------------------------------------------------------ */
  function startOfDay(timestamp) {
    const d = new Date(timestamp);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // "YYYY-MM-DD" -> local midnight timestamp, or null when invalid.
  function parseDue(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    const valid =
      date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    return valid ? date.getTime() : null;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  // Describes a due date relative to today: { status, label }.
  function dueInfo(due, done, now) {
    const time = parseDue(due);
    if (time === null) return { status: "none", label: "" };

    const short = new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    if (done) return { status: "done", label: `Due ${short}` };

    const days = Math.round((time - startOfDay(now)) / DAY);
    if (days < 0) return { status: "overdue", label: `Overdue by ${plural(-days, "day")}` };
    if (days === 0) return { status: "today", label: "Due today" };
    if (days === 1) return { status: "soon", label: "Due tomorrow" };
    if (days <= 6) return { status: "soon", label: `Due in ${plural(days, "day")}` };
    return { status: "later", label: `Due ${short}` };
  }

  /* ---- Items ------------------------------------------------------------ */
  function createItem(fields, now, id) {
    return {
      id,
      text: normalise(fields.text),
      done: false,
      createdAt: now,
      completedAt: null,
      priority: PRIORITIES.includes(fields.priority) ? fields.priority : "medium",
      category: normalise(fields.category).slice(0, MAX_CATEGORY),
      due: parseDue(fields.due) !== null ? fields.due : null,
    };
  }

  // Accepts items from any version of the app (or an import file) and returns a
  // clean item, or null when the data is unusable. Missing fields get defaults,
  // which is how version 1 data (no priority, category or due date) is migrated.
  function sanitizeItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.text !== "string" || typeof raw.done !== "boolean") return null;
    if (!Number.isFinite(raw.createdAt)) return null;
    if (raw.completedAt !== null && !Number.isFinite(raw.completedAt)) return null;

    const text = normalise(raw.text).slice(0, MAX_TEXT);
    if (!text) return null;

    return {
      id: raw.id,
      text,
      done: raw.done,
      createdAt: raw.createdAt,
      completedAt: raw.done ? raw.completedAt ?? raw.createdAt : null,
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : "medium",
      category: normalise(raw.category).slice(0, MAX_CATEGORY),
      due: parseDue(raw.due) !== null ? raw.due : null,
    };
  }

  function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const items = [];
    for (const raw of list) {
      const item = sanitizeItem(raw);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    return items;
  }

  /* ---- Filtering and sorting ------------------------------------------- */
  function matches(item, filters) {
    const query = normalise(filters.query).toLowerCase();
    if (query && !`${item.text} ${item.category}`.toLowerCase().includes(query)) return false;
    if (filters.priority && filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (
      filters.category &&
      filters.category !== "all" &&
      item.category.toLowerCase() !== filters.category.toLowerCase()
    ) {
      return false;
    }
    return true;
  }

  function compareDue(a, b) {
    const x = parseDue(a.due);
    const y = parseDue(b.due);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  }

  function sortPending(items, mode) {
    const list = items.slice();
    const newest = (a, b) => b.createdAt - a.createdAt;
    if (mode === "due") return list.sort((a, b) => compareDue(a, b) || newest(a, b));
    if (mode === "priority") {
      return list.sort((a, b) => WEIGHT[a.priority] - WEIGHT[b.priority] || compareDue(a, b) || newest(a, b));
    }
    return list.sort(newest);
  }

  function sortDone(items) {
    return items.slice().sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  }

  // Unique categories (case-insensitive), alphabetised, keeping first spelling.
  function categories(items) {
    const map = new Map();
    for (const item of items) {
      const key = item.category.toLowerCase();
      if (key && !map.has(key)) map.set(key, item.category);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }

  function stats(items, now) {
    const today = startOfDay(now);
    let done = 0;
    let overdue = 0;
    let doneToday = 0;
    for (const item of items) {
      if (item.done) {
        done += 1;
        if (item.completedAt !== null && startOfDay(item.completedAt) === today) doneToday += 1;
      } else if (dueInfo(item.due, false, now).status === "overdue") {
        overdue += 1;
      }
    }
    const total = items.length;
    return {
      total,
      done,
      pending: total - done,
      overdue,
      doneToday,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    };
  }

  /* ---- Import / export -------------------------------------------------- */
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { items: [], error: "That file is not valid JSON." };
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
    if (!list) return { items: [], error: "No tasks found in that file." };
    const items = sanitizeList(list);
    if (items.length === 0) return { items: [], error: "No valid tasks found in that file." };
    return { items, error: "" };
  }

  // Adds incoming items whose ids are not already present.
  function mergeItems(existing, incoming) {
    const ids = new Set(existing.map((item) => item.id));
    const fresh = incoming.filter((item) => !ids.has(item.id));
    return { items: existing.concat(fresh), added: fresh.length };
  }

  const api = {
    MAX_TEXT,
    MAX_CATEGORY,
    PRIORITIES,
    normalise,
    validateText,
    validateCategory,
    startOfDay,
    parseDue,
    dueInfo,
    createItem,
    sanitizeItem,
    sanitizeList,
    matches,
    sortPending,
    sortDone,
    categories,
    stats,
    parseImport,
    mergeItems,
  };

  root.DaybookCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
