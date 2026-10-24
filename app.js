/* ==========================================================
   Parchment Notes — app logic (vanilla JS, no build step)
   ========================================================== */
(() => {
  "use strict";

  const NOTES_KEY = "parchment-notes.v1";
  const SETTINGS_KEY = "parchment-notes.settings.v1";

  // Ink palette: text colour + matching wax for the seal
  const INKS = {
    iron:      { name: "Iron gall",  c: "#1d1a2b", wax: "#8e1b1b", hi: "#c23b2e", lo: "#4a0808" },
    sepia:     { name: "Sepia",      c: "#5a3514", wax: "#7a4a12", hi: "#b47a2c", lo: "#3a2005" },
    oxblood:   { name: "Oxblood",    c: "#6b1010", wax: "#6b1010", hi: "#a42a22", lo: "#300404" },
    royal:     { name: "Royal blue", c: "#1d3577", wax: "#1d3577", hi: "#4a68b8", lo: "#0b1638" },
    verdigris: { name: "Verdigris",  c: "#1f5646", wax: "#24604c", hi: "#4f9a7e", lo: "#0b2a20" },
    violet:    { name: "Aubergine",  c: "#43204f", wax: "#4e2260", hi: "#8550a0", lo: "#22082e" },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    list: $("noteList"), listEmpty: $("listEmpty"), search: $("search"),
    newBtn: $("newBtn"), emptyNewBtn: $("emptyNewBtn"), backBtn: $("backBtn"),
    inks: $("inks"), fontSelect: $("fontSelect"), readableBtn: $("readableBtn"),
    quillBtn: $("quillBtn"), undoBtn: $("undoBtn"), clearDrawBtn: $("clearDrawBtn"),
    deleteBtn: $("deleteBtn"), saveState: $("saveState"),
    page: $("page"), title: $("titleInput"), body: $("bodyInput"), dateLine: $("dateLine"),
    canvas: $("sketch"), pageSeal: $("pageSeal"), emptyDesk: $("emptyDesk"), deskScroll: $("deskScroll"),
    dialog: $("confirmDialog"), confirmTitle: $("confirmTitle"), confirmText: $("confirmText"), confirmOk: $("confirmOk"),
    toast: $("toast"),
  };
  const ctx = els.canvas.getContext("2d");

  // ---------- State ----------
  let notes = loadNotes();
  let settings = Object.assign({ font: "fell", readable: false, lastId: null }, loadJSON(SETTINGS_KEY, {}));
  let currentId = null;
  let query = "";
  let drawing = false;
  let saveTimer = null;

  // ---------- Storage ----------
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function loadNotes() {
    const data = loadJSON(NOTES_KEY, null);
    if (Array.isArray(data)) return data.filter((n) => n && typeof n.id === "string");
    return [welcomeNote()];
  }
  function persist() {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      setSaveState("Ink dried ✓");
      return true;
    } catch (e) {
      setSaveState("Not saved!");
      toast("Could not save — the archive (localStorage) is full or blocked.");
      return false;
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }
  function scheduleSave() {
    setSaveState("Ink wet…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; persist(); }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function welcomeNote() {
    const now = Date.now();
    return {
      id: uid(), created: now, updated: now, ink: "sepia", strokes: [],
      title: "A Letter of Welcome",
      body:
        "Good reader,\n\n" +
        "This humble scriptorium keeps thy notes upon aged parchment. Pen a new missive with the wax button, " +
        "and seek old ones with the search above the scrolls.\n\n" +
        "Choose thine ink from the coloured wells, change thy hand with the script menu, or press “Readable” " +
        "when the flourishes grow tiresome.\n\n" +
        "Take up the Quill to sketch freely upon the page. Everything is kept safe in this browser alone.\n\n" +
        "Yours in ink,\nThe Archivist",
    };
  }

  // ---------- Helpers ----------
  const current = () => notes.find((n) => n.id === currentId) || null;
  const isMobile = () => window.matchMedia("(max-width: 760px)").matches;

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function fancyDate(ts) {
    const d = new Date(ts);
    const month = d.toLocaleString("en-GB", { month: "long" });
    return `the ${ordinal(d.getDate())} of ${month}, in the year ${d.getFullYear()}`;
  }
  function shortDate(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return "today, " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  function initialOf(note) {
    const m = (note.title || note.body || "").match(/[A-Za-z0-9]/);
    return m ? m[0].toUpperCase() : "✒";
  }
  function inkOf(note) { return INKS[note && note.ink] || INKS.iron; }

  function setSaveState(text) { els.saveState.textContent = text; }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function confirmDialog(title, text, okLabel) {
    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmOk.textContent = okLabel;
    return new Promise((resolve) => {
      if (typeof els.dialog.showModal !== "function") { resolve(window.confirm(`${title}\n${text}`)); return; }
      // Resolve from the button click directly (more reliable than waiting on the "close" event),
      // with "close" as a fallback for Esc / backdrop dismissal.
      let done = false;
      const form = els.dialog.querySelector("form");
      const finish = (ok) => {
        if (done) return;
        done = true;
        form.removeEventListener("click", onClick);
        els.dialog.removeEventListener("close", onClose);
        if (els.dialog.open) els.dialog.close();
        resolve(ok);
      };
      const onClick = (e) => {
        const b = e.target.closest("button[value]");
        if (b) { e.preventDefault(); finish(b.value === "ok"); }
      };
      const onClose = () => finish(false);
      form.addEventListener("click", onClick);
      els.dialog.addEventListener("close", onClose);
      els.dialog.showModal();
      els.dialog.querySelector('button[value="cancel"]').focus();
    });
  }

  // Append text to parent, wrapping search matches in <mark> (safe: uses text nodes only)
  function appendHighlighted(parent, text, q) {
    if (!q) { parent.textContent = text; return; }
    const lower = text.toLowerCase();
    let i = 0;
    while (i < text.length) {
      const j = lower.indexOf(q, i);
      if (j === -1) { parent.append(text.slice(i)); break; }
      if (j > i) parent.append(text.slice(i, j));
      const m = document.createElement("mark");
      m.textContent = text.slice(j, j + q.length);
      parent.append(m);
      i = j + q.length;
    }
  }

  function snippetFor(note, q) {
    const body = (note.body || "").replace(/\s+/g, " ").trim();
    if (!body) return note.strokes && note.strokes.length ? "A quill sketch" : "An empty page";
    if (q) {
      const idx = body.toLowerCase().indexOf(q);
      if (idx > 40) return "…" + body.slice(idx - 30, idx + 120);
    }
    return body.slice(0, 160);
  }

  // ---------- List rendering ----------
  function renderList() {
    const q = query.trim().toLowerCase();
    const sorted = [...notes].sort((a, b) => b.updated - a.updated);
    const shown = q
      ? sorted.filter((n) => (n.title + "\n" + n.body).toLowerCase().includes(q))
      : sorted;

    const frag = document.createDocumentFragment();
    shown.forEach((note, i) => {
      const ink = inkOf(note);
      const li = document.createElement("li");
      li.className = "note-card" + (note.id === currentId ? " active" : "");
      li.dataset.id = note.id;
      li.style.animationDelay = Math.min(i * 40, 400) + "ms";
      li.style.setProperty("--card-ink", ink.c);
      li.style.setProperty("--seal", ink.wax);
      li.style.setProperty("--seal-hi", ink.hi);
      li.style.setProperty("--seal-lo", ink.lo);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Open note: " + (note.title || "Untitled missive"));
      if (note.id === currentId) btn.setAttribute("aria-current", "true");

      const body = document.createElement("div");
      body.className = "scroll-body";
      const h3 = document.createElement("h3");
      appendHighlighted(h3, note.title || "Untitled missive", q);
      const p = document.createElement("p");
      p.className = "snippet";
      appendHighlighted(p, snippetFor(note, q), q);
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = shortDate(note.updated);
      if (note.strokes && note.strokes.length) {
        const sm = document.createElement("span");
        sm.className = "sketch-mark"; sm.textContent = "· with sketch";
        when.append(sm);
      }
      const seal = document.createElement("span");
      seal.className = "seal"; seal.setAttribute("aria-hidden", "true");
      seal.textContent = initialOf(note);

      body.append(h3, p, when, seal);
      btn.append(body);
      li.append(btn);
      frag.append(li);
    });
    els.list.replaceChildren(frag);

    if (!notes.length) {
      els.listEmpty.hidden = false;
      els.listEmpty.textContent = "The archive is empty.";
    } else if (!shown.length) {
      els.listEmpty.hidden = false;
      els.listEmpty.textContent = `No scroll mentions “${query.trim()}”.`;
    } else {
      els.listEmpty.hidden = true;
    }
  }

  // Light-weight update of one card while typing (avoids re-animating the whole list)
  function refreshCard(note) {
    const li = els.list.querySelector(`.note-card[data-id="${CSS.escape(note.id)}"]`);
    if (!li) return renderList();
    const q = query.trim().toLowerCase();
    const h3 = li.querySelector("h3"), p = li.querySelector(".snippet"), seal = li.querySelector(".seal");
    h3.replaceChildren(); appendHighlighted(h3, note.title || "Untitled missive", q);
    p.replaceChildren(); appendHighlighted(p, snippetFor(note, q), q);
    seal.textContent = initialOf(note);
    li.querySelector(".when").firstChild.textContent = shortDate(note.updated);
    // move to top if not already (most-recent-first ordering)
    if (els.list.firstElementChild !== li) els.list.prepend(li);
  }

  // ---------- Editor ----------
  function showEditorState() {
    const has = !!current();
    els.page.hidden = !has;
    els.emptyDesk.hidden = has;
    [els.deleteBtn, els.quillBtn, els.undoBtn, els.clearDrawBtn].forEach((b) => (b.disabled = !has));
  }

  function applyInk(note) {
    const ink = inkOf(note);
    els.page.style.setProperty("--page-ink", ink.c);
    els.page.style.setProperty("--seal", ink.wax);
    els.page.style.setProperty("--seal-hi", ink.hi);
    els.page.style.setProperty("--seal-lo", ink.lo);
    els.inks.querySelectorAll(".ink-dot").forEach((d) => d.setAttribute("aria-checked", String(d.dataset.ink === (note ? note.ink : "iron"))));
  }

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow to restart animation
    el.classList.add(cls);
  }

  function openNote(id, { animate = true, focus = false } = {}) {
    flushSave();
    const note = notes.find((n) => n.id === id);
    currentId = note ? note.id : null;
    settings.lastId = currentId; saveSettings();
    showEditorState();
    if (!note) { renderList(); return; }

    els.title.value = note.title;
    els.body.value = note.body;
    els.dateLine.textContent = "Penned " + fancyDate(note.created);
    els.pageSeal.querySelector("span").textContent = initialOf(note);
    applyInk(note);
    autoGrow();
    els.deskScroll.scrollTop = 0;

    if (animate) {
      restartAnim(els.page, "turn-in");
      restartAnim(els.page, "inking");
      restartAnim(els.pageSeal, "stamp");
    }
    els.list.querySelectorAll(".note-card").forEach((li) => {
      const on = li.dataset.id === currentId;
      li.classList.toggle("active", on);
      const b = li.querySelector("button");
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });

    if (isMobile()) document.body.classList.add("show-editor");
    resizeCanvas();
    requestAnimationFrame(() => { resizeCanvas(); if (focus) els.title.focus({ preventScroll: true }); });
    setSaveState("");
  }

  function newNote() {
    const now = Date.now();
    const prevInk = current() ? current().ink : "iron";
    const note = { id: uid(), title: "", body: "", ink: prevInk, strokes: [], created: now, updated: now };
    notes.unshift(note);
    if (query) { query = ""; els.search.value = ""; }
    persist();
    currentId = note.id;
    renderList();
    openNote(note.id, { focus: true });
    toast("A fresh sheet is laid upon the desk.");
  }

  async function deleteCurrent() {
    const note = current();
    if (!note) return;
    const ok = await confirmDialog(
      "Burn this note?",
      `“${note.title || "Untitled missive"}” will be committed to the flames and cannot be recovered.`,
      "Burn it"
    );
    if (!ok) return;
    if (drawing) setDrawing(false);
    const li = els.list.querySelector(`.note-card[data-id="${CSS.escape(note.id)}"]`);
    const finish = () => {
      notes = notes.filter((n) => n.id !== note.id);
      persist();
      const next = [...notes].sort((a, b) => b.updated - a.updated)[0];
      currentId = null;
      renderList();
      if (next && !isMobile()) openNote(next.id);
      else { showEditorState(); document.body.classList.remove("show-editor"); }
      toast("The note has turned to ash.");
    };
    if (li && !isMobile()) { li.classList.add("burning"); setTimeout(finish, 550); }
    else finish();
  }

  function touch(note) { note.updated = Date.now(); }

  function autoGrow() {
    const ta = els.body;
    const scroll = els.deskScroll.scrollTop;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    els.deskScroll.scrollTop = scroll;
  }

  // ---------- Settings / toolbar ----------
  function buildInks() {
    Object.entries(INKS).forEach(([key, ink]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ink-dot"; b.dataset.ink = key;
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false");
      b.title = ink.name; b.setAttribute("aria-label", ink.name + " ink");
      b.style.setProperty("--c", ink.c);
      b.addEventListener("click", () => {
        const note = current(); if (!note) return;
        note.ink = key; touch(note); applyInk(note); scheduleSave();
        const li = els.list.querySelector(`.note-card[data-id="${CSS.escape(note.id)}"]`);
        if (li) {
          li.style.setProperty("--card-ink", ink.c); li.style.setProperty("--seal", ink.wax);
          li.style.setProperty("--seal-hi", ink.hi); li.style.setProperty("--seal-lo", ink.lo);
          refreshCard(note);
        }
      });
      els.inks.append(b);
    });
  }

  function applySettings() {
    document.body.dataset.font = settings.font;
    document.body.classList.toggle("readable", !!settings.readable);
    els.fontSelect.value = settings.font;
    els.readableBtn.setAttribute("aria-pressed", String(!!settings.readable));
    // fonts change text metrics, so re-measure once they've loaded
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => { autoGrow(); resizeCanvas(); });
    requestAnimationFrame(() => { autoGrow(); resizeCanvas(); });
  }

  // ---------- Quill drawing ----------
  // Strokes are stored as vectors normalised by page width, so they re-render crisply at any size.
  // Each point: [x/W, y/W, pressure]. Each stroke: { ink: "#hex", pts: [...] }.
  let dpr = 1, cw = 0, ch = 0, active = null;
  const NIB_ANGLE = -Math.PI / 4; // broad-edge nib held at 45°

  function resizeCanvas() {
    if (els.page.hidden) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = els.page.offsetWidth, h = els.page.offsetHeight;
    if (!w || !h) return;
    if (w !== cw || h !== ch || els.canvas.width !== Math.round(w * dpr)) {
      cw = w; ch = h;
      els.canvas.width = Math.round(w * dpr);
      els.canvas.height = Math.round(h * dpr);
    }
    redraw();
  }

  function nibSize(W, p) {
    return (W / 760) * 3.4 * (0.55 + p * 0.9);
  }

  function drawSegment(a, b, color, W) {
    const ax = a[0] * W, ay = a[1] * W, bx = b[0] * W, by = b[1] * W;
    const sa = nibSize(W, a[2]), sb = nibSize(W, b[2]);
    const nx = Math.cos(NIB_ANGLE), ny = Math.sin(NIB_ANGLE);
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(ax + nx * sa, ay + ny * sa);
    ctx.lineTo(bx + nx * sb, by + ny * sb);
    ctx.lineTo(bx - nx * sb, by - ny * sb);
    ctx.lineTo(ax - nx * sa, ay - ny * sa);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, W / 1100); // hairline so strokes along the nib never vanish
    ctx.stroke();
  }

  function drawStroke(s, W) {
    const pts = s.pts;
    if (!pts.length) return;
    ctx.globalAlpha = 0.92;
    if (pts.length === 1) {
      const r = nibSize(W, pts[0][2]);
      ctx.fillStyle = s.ink;
      ctx.beginPath(); ctx.ellipse(pts[0][0] * W, pts[0][1] * W, r, r * 0.45, NIB_ANGLE, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 1; i < pts.length; i++) drawSegment(pts[i - 1], pts[i], s.ink, W);
    ctx.globalAlpha = 1;
  }

  function redraw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const note = current();
    if (!note || !note.strokes) return;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    note.strokes.forEach((s) => drawStroke(s, cw));
  }

  function pointFrom(e) {
    const r = els.canvas.getBoundingClientRect();
    const W = r.width;
    // mouse/touch report 0 or 0.5 pressure; treat those as a medium pen
    let p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return [(e.clientX - r.left) / W, (e.clientY - r.top) / W, p];
  }

  els.canvas.addEventListener("pointerdown", (e) => {
    if (!drawing || !current()) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    if (els.page.offsetWidth !== cw || els.page.offsetHeight !== ch) resizeCanvas();
    els.canvas.setPointerCapture(e.pointerId);
    active = { ink: inkOf(current()).c, pts: [pointFrom(e)], pid: e.pointerId };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(active, cw);
  });
  els.canvas.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== active.pid) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.92;
    for (const ev of events.length ? events : [e]) {
      const pt = pointFrom(ev);
      const last = active.pts[active.pts.length - 1];
      const dx = (pt[0] - last[0]) * cw, dy = (pt[1] - last[1]) * cw;
      if (dx * dx + dy * dy < 1.5) continue; // skip jitter
      // speed thins the line a little, like a quill running dry
      const speed = Math.hypot(dx, dy);
      if (ev.pointerType !== "pen") pt[2] = Math.max(0.18, Math.min(0.75, 0.75 - speed / 90));
      pt[2] = last[2] * 0.6 + pt[2] * 0.4; // smooth
      pt[0] = +pt[0].toFixed(5); pt[1] = +pt[1].toFixed(5); pt[2] = +pt[2].toFixed(3);
      active.pts.push(pt);
      drawSegment(last, pt, active.ink, cw);
    }
    ctx.globalAlpha = 1;
  });
  function endStroke(e) {
    if (!active || (e && e.pointerId !== active.pid)) return;
    const note = current();
    if (note) {
      note.strokes = note.strokes || [];
      note.strokes.push({ ink: active.ink, pts: active.pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5), +(+p[2]).toFixed(3)]) });
      touch(note); scheduleSave(); refreshCard(note);
    }
    active = null;
  }
  els.canvas.addEventListener("pointerup", endStroke);
  els.canvas.addEventListener("pointercancel", endStroke);
  els.canvas.addEventListener("lostpointercapture", endStroke);

  function setDrawing(on) {
    drawing = on && !!current();
    document.body.classList.toggle("drawing", drawing);
    els.quillBtn.setAttribute("aria-pressed", String(drawing));
    if (drawing) {
      resizeCanvas();
      document.activeElement && document.activeElement.blur();
      toast(isMobile() ? "Quill in hand — draw with a finger. Tap Quill again to write." : "Quill in hand — sketch upon the page. Esc to put it down.");
    }
  }

  // ---------- Events ----------
  els.newBtn.addEventListener("click", newNote);
  els.emptyNewBtn.addEventListener("click", newNote);
  els.deleteBtn.addEventListener("click", deleteCurrent);

  els.list.addEventListener("click", (e) => {
    const li = e.target.closest(".note-card");
    if (!li) return;
    if (li.dataset.id === currentId && !isMobile()) return;
    if (drawing) setDrawing(false);
    openNote(li.dataset.id);
  });

  els.backBtn.addEventListener("click", () => {
    flushSave();
    if (drawing) setDrawing(false);
    document.body.classList.remove("show-editor");
    els.body.blur(); els.title.blur();
  });

  els.title.addEventListener("input", () => {
    const note = current(); if (!note) return;
    note.title = els.title.value; touch(note);
    els.pageSeal.querySelector("span").textContent = initialOf(note);
    refreshCard(note); scheduleSave();
  });
  els.title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.body.focus(); }
  });
  els.body.addEventListener("input", () => {
    const note = current(); if (!note) return;
    note.body = els.body.value; touch(note);
    autoGrow(); refreshCard(note); scheduleSave();
    if (!note.title) els.pageSeal.querySelector("span").textContent = initialOf(note);
  });

  let searchTimer;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = els.search.value; renderList(); }, 120);
  });
  els.search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = els.list.querySelector(".note-card");
      if (first) openNote(first.dataset.id);
    } else if (e.key === "Escape") { els.search.value = ""; query = ""; renderList(); }
  });

  els.fontSelect.addEventListener("change", () => {
    settings.font = els.fontSelect.value;
    if (settings.readable) settings.readable = false;
    saveSettings(); applySettings();
    if (current()) restartAnim(els.page, "inking");
  });
  els.readableBtn.addEventListener("click", () => {
    settings.readable = !settings.readable; saveSettings(); applySettings();
  });

  els.quillBtn.addEventListener("click", () => setDrawing(!drawing));
  els.undoBtn.addEventListener("click", () => {
    const note = current(); if (!note || !note.strokes || !note.strokes.length) return toast("No strokes left to undo.");
    note.strokes.pop(); touch(note); redraw(); scheduleSave(); refreshCard(note);
  });
  els.clearDrawBtn.addEventListener("click", async () => {
    const note = current(); if (!note || !note.strokes || !note.strokes.length) return toast("The page bears no sketches.");
    if (!(await confirmDialog("Scrape away the sketches?", "All quill drawings on this page will be erased. Thy words remain.", "Erase"))) return;
    note.strokes = []; touch(note); redraw(); scheduleSave(); refreshCard(note);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawing) { setDrawing(false); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (isMobile()) document.body.classList.remove("show-editor"); els.search.focus(); els.search.select(); }
    if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); newNote(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && drawing) { e.preventDefault(); els.undoBtn.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave(); setSaveState("Ink dried ✓"); }
  });

  if ("ResizeObserver" in window) new ResizeObserver(() => resizeCanvas()).observe(els.page);
  let resizeRaf;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      autoGrow(); resizeCanvas();
      if (!isMobile()) {
        document.body.classList.remove("show-editor");
        // grew from phone to desktop layout with nothing open: lay out the latest note
        if (!current() && notes.length) openNote([...notes].sort((a, b) => b.updated - a.updated)[0].id, { animate: false });
      }
      else if (current() && document.activeElement && (document.activeElement === els.body || document.activeElement === els.title)) document.body.classList.add("show-editor");
    });
  });
  window.addEventListener("beforeunload", flushSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
  // keep other tabs in sync
  window.addEventListener("storage", (e) => {
    if (e.key !== NOTES_KEY) return;
    notes = loadNotes();
    renderList();
    if (!current()) { currentId = null; showEditorState(); }
    else if (document.activeElement !== els.body && document.activeElement !== els.title) openNote(currentId, { animate: false });
  });

  // ---------- Boot ----------
  buildInks();
  applySettings();
  if (!loadJSON(NOTES_KEY, null)) persist(); // store the welcome note on first run
  renderList();
  const startId = notes.some((n) => n.id === settings.lastId) ? settings.lastId : ([...notes].sort((a, b) => b.updated - a.updated)[0] || {}).id;
  if (startId && !isMobile()) openNote(startId);
  else showEditorState();
  setSaveState("");
})();
