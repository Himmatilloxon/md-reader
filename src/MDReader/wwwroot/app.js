/* MD Reader UI: tabs, viewer, editor, find, TOC, themes, host bridge. */
'use strict';

const $ = s => document.querySelector(s);
const appEl = $('#app'), docEl = $('#doc'), viewPane = $('#view-pane'), tocEl = $('#toc');
const { esc } = MDRender;
/** Top of an element in view-pane scroll coordinates. */
const topIn = el => el.getBoundingClientRect().top - viewPane.getBoundingClientRect().top + viewPane.scrollTop;

// ------------------------------------------------------------ icons
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  explorer: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5 12 16l2.5-2.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  printer: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
};
const icon = name => `<svg class="i" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;
function paintIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const html = icon(el.dataset.icon);
    if (el.tagName === 'I') el.outerHTML = html; else el.innerHTML = html;
  }
}

// ------------------------------------------------------------ host bridge
const host = window.chrome && window.chrome.webview;
const send = msg => host ? host.postMessage(msg) : console.log('[host]', msg);
let ridSeq = 0;
const pending = new Map();
const request = msg => new Promise(resolve => {
  const rid = ++ridSeq;
  pending.set(rid, resolve);
  send({ ...msg, rid });
  if (!host) setTimeout(() => resolve({ ok: false }), 0);
});

// ------------------------------------------------------------ state
const DEFAULT_UI = { theme: 'system', zoom: 1, sidebar: true, split: 0.5 };
let ui = { ...DEFAULT_UI };
let recent = [];
let tabs = [];
let active = null;
let tabSeq = 0, untitledSeq = 0;
let cm = null;
const closedStack = [];

const isDirty = t => !t.doc.isClean(t.cleanGen);
const samePathAs = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const findTab = path => tabs.find(t => samePathAs(t.path, path));

function makeTab(path, content) {
  const doc = CodeMirror.Doc(content, { name: 'gfm', highlightFormatting: true, fencedCodeBlockHighlighting: false });
  const t = {
    id: ++tabSeq, path, name: path ? MDRender.baseName(path) : `Untitled-${++untitledSeq}`,
    doc, cleanGen: doc.changeGeneration(), mode: 'view', viewScroll: 0, renderedGen: -1, external: null,
  };
  doc.on('change', () => onDocChange(t));
  return t;
}

// ------------------------------------------------------------ theme & zoom
const media = matchMedia('(prefers-color-scheme: dark)');
const isDarkNow = () => ui.theme === 'dark' || (ui.theme === 'system' && media.matches);
function applyTheme() {
  const dark = isDarkNow();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#hljs-light').disabled = dark;
  $('#hljs-dark').disabled = !dark;
  const btn = $('#btn-theme');
  btn.innerHTML = icon(ui.theme === 'system' ? 'monitor' : ui.theme === 'dark' ? 'moon' : 'sun');
  btn.title = `Theme: ${ui.theme[0].toUpperCase() + ui.theme.slice(1)} (click to change)`;
  send({ type: 'theme', dark });
  if (active) MDRender.renderMermaid(docEl, dark);
}
media.addEventListener('change', () => { if (ui.theme === 'system') applyTheme(); });

function setTheme(theme) { ui.theme = theme; saveUi(); applyTheme(); }
function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  setTheme(order[(order.indexOf(ui.theme) + 1) % order.length]);
  toast(`Theme: ${ui.theme}`);
}

function applyZoom() {
  document.documentElement.style.setProperty('--doc-zoom', ui.zoom);
  if (cm) cm.refresh();
}
function zoom(delta) {
  ui.zoom = delta === 0 ? 1 : Math.min(2.5, Math.max(0.6, Math.round((ui.zoom + delta) * 10) / 10));
  applyZoom();
  saveUi();
  toast(`Zoom ${Math.round(ui.zoom * 100)}%`);
}

let uiTimer = 0;
function saveUi() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => send({ type: 'ui', ui }), 300);
}

// ------------------------------------------------------------ tabs
function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t === active ? ' active' : '') + (isDirty(t) ? ' dirty' : '');
    el.title = t.path || t.name;
    el.draggable = true;
    el.dataset.id = t.id;
    el.innerHTML = `<span class="tab-name">${esc(t.name)}</span><button class="tab-close" title="Close (Ctrl+W)">${icon('x')}</button>`;
    el.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); closeTab(t); }
      else if (e.button === 0 && !e.target.closest('.tab-close')) activate(t);
    });
    el.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(t); });
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-mdr-tab', String(t.id)); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-mdr-tab')) e.preventDefault(); });
    el.addEventListener('drop', e => {
      const id = +e.dataTransfer.getData('application/x-mdr-tab');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const from = tabs.findIndex(x => x.id === id), to = tabs.indexOf(t);
      if (from < 0 || from === to) return;
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      renderTabs();
      saveSession();
    });
    bar.appendChild(el);
  }
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateTabState(t) {
  const el = document.querySelector(`.tab[data-id="${t.id}"]`);
  if (el) el.classList.toggle('dirty', isDirty(t));
}

function addTab(t, focus = true) {
  const idx = active ? tabs.indexOf(active) + 1 : tabs.length;
  tabs.splice(idx, 0, t);
  if (focus || !active) activate(t); else renderTabs();
  saveSession();
}

function activate(t) {
  if (active && active !== t && active.mode === 'view') active.viewScroll = viewPane.scrollTop;
  if (active && active !== t && active.mode === 'split') active.viewScroll = viewPane.scrollTop;
  active = t;
  closeFind(false);
  renderTabs();
  showActive(true);
  saveSession();
}

function showActive(restoreScroll) {
  closePopover();
  const t = active;
  appEl.classList.toggle('empty', !t);
  if (!t) {
    renderWelcome();
    setTitle();
    updateStatus();
    showBanner();
    updateToolbar();
    return;
  }
  setMode(t.mode, false);
  if (t.renderedGen !== t.doc.changeGeneration() || docEl.dataset.tab !== String(t.id)) renderDoc(t);
  if (restoreScroll) viewPane.scrollTop = t.viewScroll || 0;
  setTitle();
  showBanner();
  updateStatus();
  updateToolbar();
}

async function closeTab(t) {
  if (isDirty(t)) {
    const choice = await modal({
      title: `Save changes to ${t.name}?`,
      text: 'Your changes will be lost if you don\'t save them.',
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Don\'t save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
    });
    if (choice === 'cancel' || choice == null) return;
    if (choice === 'save' && !(await saveTab(t))) return;
  }
  const idx = tabs.indexOf(t);
  if (idx < 0) return;
  tabs.splice(idx, 1);
  if (t.path) {
    closedStack.push(t.path);
    if (closedStack.length > 20) closedStack.shift();
    if (!findTab(t.path)) send({ type: 'close', path: t.path });
  }
  if (active === t) {
    active = null;
    const next = tabs[Math.min(idx, tabs.length - 1)] || null;
    if (next) activate(next); else { renderTabs(); showActive(false); }
  } else renderTabs();
  saveSession();
  syncDirty();
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  activate(tabs[(i + dir + tabs.length) % tabs.length]);
}

function saveSession() {
  send({ type: 'session', files: tabs.filter(t => t.path).map(t => t.path), active: active?.path || '' });
}

let lastDirty = false;
function syncDirty() {
  const d = tabs.some(isDirty);
  if (d !== lastDirty) { lastDirty = d; send({ type: 'dirty', value: d }); }
}

function setTitle() {
  const title = active ? `${isDirty(active) ? '● ' : ''}${active.name} — MD Reader` : 'MD Reader';
  if (document.title !== title) {
    document.title = title;
    send({ type: 'title', title });
  }
}

// ------------------------------------------------------------ rendering
let renderTimer = 0;
function renderDoc(t) {
  const html = MDRender.render(t.doc.getValue());
  docEl.innerHTML = html;
  docEl.dataset.tab = t.id;
  MDRender.postProcess(docEl, t.path ? MDRender.dirOf(t.path) : '');
  t.renderedGen = t.doc.changeGeneration();
  MDRender.renderMermaid(docEl, isDarkNow()).then(() => { lineMap = null; });
  buildToc();
  lineMap = null;
  if (findState.open && findState.target === 'doc') runFind(false);
}

function onDocChange(t) {
  updateTabState(t);
  syncDirty();
  setTitle();
  if (t !== active) return;
  clearTimeout(renderTimer);
  const len = t.doc.getValue().length;
  renderTimer = setTimeout(() => {
    if (active !== t) return;
    const top = viewPane.scrollTop;
    renderDoc(t);
    viewPane.scrollTop = top;
    if (t.mode === 'split') syncPreviewToEditor();
    updateStatus();
  }, len > 300000 ? 600 : len > 60000 ? 250 : 90);
}

// ------------------------------------------------------------ TOC
let tocLinks = [];
function buildToc() {
  const heads = [...docEl.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')]
    .filter(h => !h.closest('blockquote, details:not([open])'));
  tocEl.innerHTML = '';
  tocLinks = [];
  if (!heads.length) { tocEl.innerHTML = '<div class="empty">No headings</div>'; return; }
  const min = Math.min(...heads.map(h => +h.tagName[1]));
  for (const h of heads) {
    const lvl = +h.tagName[1] - min;
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.title = h.textContent;
    a.className = 'lvl-' + lvl;
    a.style.paddingLeft = (8 + lvl * 14) + 'px';
    a.addEventListener('click', e => { e.preventDefault(); scrollToHeading(h); });
    tocEl.appendChild(a);
    tocLinks.push({ a, h });
  }
  updateTocCurrent();
}

function scrollToHeading(h) {
  viewPane.scrollTo({ top: topIn(h) - 12 });
  h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
  if (active?.mode === 'split' && cm && h.dataset.line) {
    const line = +h.dataset.line;
    cm.scrollTo(null, cm.heightAtLine(line, 'local') - 20);
  }
}

function scrollToAnchor(id) {
  if (!id) return;
  const sel = `[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`;
  const el = docEl.querySelector(sel) || docEl.querySelector(`[id="${CSS.escape(MDRender.slugify(id))}"]`);
  if (el) scrollToHeading(el);
}

let tocRaf = 0;
function updateTocCurrent() {
  if (!tocLinks.length) return;
  const atBottom = viewPane.scrollTop + viewPane.clientHeight >= viewPane.scrollHeight - 4;
  // at the very end of the document, the last heading on screen counts as current
  const top = atBottom ? viewPane.scrollTop + viewPane.clientHeight * 0.6 : viewPane.scrollTop + 60;
  let cur = tocLinks[0];
  for (const item of tocLinks) { if (topIn(item.h) <= top) cur = item; else break; }
  for (const item of tocLinks) item.a.classList.toggle('current', item === cur);
  cur.a.scrollIntoView({ block: 'nearest' });
}
viewPane.addEventListener('scroll', () => {
  cancelAnimationFrame(tocRaf);
  tocRaf = requestAnimationFrame(updateTocCurrent);
}, { passive: true });

// ------------------------------------------------------------ modes, editor, scroll sync
function ensureEditor() {
  if (cm) return cm;
  cm = CodeMirror($('#editor'), {
    lineWrapping: true,
    lineNumbers: false,
    indentUnit: 2,
    tabSize: 4,
    indentWithTabs: false,
    spellcheck: true,
    inputStyle: 'contenteditable',
    viewportMargin: 30,
    extraKeys: {
      Enter: 'newlineAndIndentContinueMarkdownList',
      Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  '),
      'Shift-Tab': c => c.indentSelection('subtract'),
      'Ctrl-B': c => wrapSelection(c, '**'),
      'Ctrl-I': c => wrapSelection(c, '*'),
      'Ctrl-K': c => insertLink(c),
      'Ctrl-`': c => wrapSelection(c, '`'),
    },
  });
  cm.on('scroll', () => { if (!syncLock) syncPreviewToEditor(); });
  cm.on('cursorActivity', () => updateStatus());
  return cm;
}

function wrapSelection(c, mark) {
  const sel = c.getSelection();
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
    c.replaceSelection(sel.slice(mark.length, -mark.length), 'around');
    return;
  }
  c.replaceSelection(mark + sel + mark, 'around');
  if (!sel) { const p = c.getCursor(); c.setCursor({ line: p.line, ch: p.ch - mark.length }); }
}
function insertLink(c) {
  const sel = c.getSelection();
  c.replaceSelection(`[${sel || 'text'}](url)`);
  const p = c.getCursor();
  c.setSelection({ line: p.line, ch: p.ch - 4 }, { line: p.line, ch: p.ch - 1 });
}

function setMode(mode, save = true) {
  const t = active;
  if (!t) return;
  if (t.mode === 'view' && mode === 'split') t.viewScroll = viewPane.scrollTop;
  t.mode = mode;
  appEl.classList.toggle('mode-split', mode === 'split');
  appEl.classList.toggle('mode-view', mode === 'view');
  if (mode === 'split') {
    const editor = ensureEditor();
    if (editor.getDoc() !== t.doc) editor.swapDoc(t.doc);
    $('#editor-pane').style.width = (ui.split * 100) + '%';
    editor.refresh();
    if (save) editor.focus();
    requestAnimationFrame(() => editor.refresh());
  } else if (save) {
    viewPane.focus({ preventScroll: true });
  }
  updateToolbar();
  updateStatus();
}

function toggleEdit() {
  if (!active) return;
  if (active.mode === 'view') {
    // start editing near what the reader was looking at
    const line = topVisibleSourceLine();
    setMode('split');
    if (line != null) {
      cm.setCursor({ line, ch: 0 });
      cm.scrollTo(null, cm.heightAtLine(line, 'local') - 20);
    }
  } else {
    setMode('view');
  }
}

function topVisibleSourceLine() {
  const top = viewPane.scrollTop;
  let best = null;
  for (const el of docEl.querySelectorAll('[data-line]')) {
    if (topIn(el) <= top + 10) best = +el.dataset.line; else break;
  }
  return best;
}

let lineMap = null, syncLock = false;
function buildLineMap() {
  const map = [];
  for (const el of docEl.querySelectorAll('[data-line]')) {
    const line = +el.dataset.line;
    const top = topIn(el);
    if (!map.length || line > map[map.length - 1].line) map.push({ line, top });
  }
  return map;
}
function syncPreviewToEditor() {
  if (!cm || !active || active.mode !== 'split') return;
  lineMap ??= buildLineMap();
  if (!lineMap.length) return;
  const info = cm.getScrollInfo();
  if (info.top + info.clientHeight >= info.height - 4) { viewPane.scrollTop = viewPane.scrollHeight; return; }
  const lineNo = cm.lineAtHeight(info.top, 'local');
  const lineTop = cm.heightAtLine(lineNo, 'local');
  const lineH = Math.max(1, cm.heightAtLine(lineNo + 1, 'local') - lineTop);
  const pos = lineNo + Math.min(1, (info.top - lineTop) / lineH);
  let i = 0;
  while (i < lineMap.length - 1 && lineMap[i + 1].line <= pos) i++;
  const a = lineMap[i], b = lineMap[i + 1];
  let y = a.top;
  if (b && pos >= a.line) y = a.top + (b.top - a.top) * ((pos - a.line) / (b.line - a.line));
  else if (pos < a.line) y = a.top * (pos / Math.max(1, a.line));
  viewPane.scrollTop = Math.max(0, y - 24);
}

// splitter drag
(() => {
  const sp = $('#splitter');
  sp.addEventListener('mousedown', e => {
    e.preventDefault();
    sp.classList.add('active');
    const rect = $('#main').getBoundingClientRect();
    const move = ev => {
      ui.split = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
      $('#editor-pane').style.width = (ui.split * 100) + '%';
      lineMap = null;
    };
    const up = () => {
      sp.classList.remove('active');
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      cm?.refresh();
      saveUi();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
})();

function toggleSidebar() {
  ui.sidebar = !ui.sidebar;
  appEl.classList.toggle('no-sidebar', !ui.sidebar);
  if (active?.mode === 'split' && ui.sidebar) setMode('view');
  saveUi();
  updateToolbar();
}

function updateToolbar() {
  const hasTab = !!active;
  $('#btn-toc').classList.toggle('on', ui.sidebar && active?.mode !== 'split');
  const edit = $('#btn-edit');
  const editing = active?.mode === 'split';
  edit.classList.toggle('on', editing);
  edit.innerHTML = icon(editing ? 'book' : 'pen');
  edit.title = editing ? 'Back to reading (Ctrl+E)' : 'Edit (Ctrl+E)';
  for (const b of document.querySelectorAll('[data-cmd="edit"], [data-cmd="toc"], [data-cmd="find"]')) b.disabled = !hasTab;
}

// ------------------------------------------------------------ status
function updateStatus() {
  const t = active;
  if (!t) { $('#status-left').textContent = ''; $('#status-right').textContent = ''; return; }
  const text = docEl.innerText || '';
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  const mins = Math.max(1, Math.round(words / 230));
  let left = `${words.toLocaleString()} words · ${mins} min read`;
  if (t.mode === 'split' && cm) {
    const c = cm.getCursor();
    left += ` · Ln ${c.line + 1}, Col ${c.ch + 1}`;
  }
  if (isDirty(t)) left += ' · Unsaved';
  $('#status-left').textContent = left;
  const right = $('#status-right');
  right.textContent = t.path || 'Not saved yet';
  right.title = t.path ? 'Click to copy path' : '';
}
$('#status-right').addEventListener('click', () => {
  if (!active?.path) return;
  copyText(active.path).then(() => toast('Path copied'));
});

// ------------------------------------------------------------ banner (external changes)
function showBanner() {
  const t = active;
  const banner = $('#banner');
  if (!t || !t.external) { banner.hidden = true; return; }
  const actions = banner.querySelector('.banner-actions');
  actions.innerHTML = '';
  const addBtn = (label, fn, primary) => {
    const b = document.createElement('button');
    b.className = 'btn small' + (primary ? ' primary' : '');
    b.textContent = label;
    b.onclick = fn;
    actions.appendChild(b);
  };
  if (t.external.kind === 'changed') {
    $('#banner-text').textContent = 'This file was changed by another program, but you have unsaved edits here.';
    addBtn('Load their version', () => { applyContent(t, t.external.content); t.external = null; showBanner(); }, true);
    addBtn('Keep mine', () => { t.external = null; showBanner(); });
  } else {
    $('#banner-text').textContent = 'This file was deleted or moved on disk.';
    addBtn('Save it again', () => saveTab(t, true).then(() => { t.external = null; showBanner(); }), true);
    addBtn('Close tab', () => { t.external = null; closeTab(t); });
    addBtn('Dismiss', () => { t.external = null; showBanner(); });
  }
  banner.hidden = false;
}

function applyContent(t, content) {
  const top = viewPane.scrollTop;
  const cursor = t.doc.getCursor();
  t.doc.setValue(content);
  t.doc.setCursor(cursor);
  t.cleanGen = t.doc.changeGeneration();
  updateTabState(t);
  syncDirty();
  if (t === active) {
    clearTimeout(renderTimer);
    renderDoc(t);
    viewPane.scrollTop = top;
    setTitle();
    updateStatus();
  }
}

// ------------------------------------------------------------ open / save
function openFile(file, anchor, focus = true) {
  let t = findTab(file.path);
  if (t) {
    if (!isDirty(t) && t.doc.getValue() !== file.content) applyContent(t, file.content);
    if (focus) activate(t);
  } else {
    // replace an untouched empty untitled tab instead of stacking another
    const blank = active && !active.path && !isDirty(active) && active.doc.getValue() === '' ? active : null;
    t = makeTab(file.path, file.content);
    addTab(t, focus);
    if (blank) closeTab(blank);
  }
  if (anchor && focus) requestAnimationFrame(() => scrollToAnchor(anchor));
}

function newFile() {
  const t = makeTab(null, '');
  t.mode = 'split';
  addTab(t, true);
}

async function saveTab(t, forceAs = false) {
  const gen = t.doc.changeGeneration();
  const content = t.doc.getValue();
  const res = (t.path && !forceAs)
    ? await request({ type: 'save', path: t.path, content })
    : await request({ type: 'saveAs', content, name: t.path ? MDRender.baseName(t.path) : suggestName(t) });
  if (!res || !res.ok) return false;
  if (res.path && !samePathAs(res.path, t.path)) {
    t.path = res.path;
    t.name = MDRender.baseName(res.path);
    renderTabs();
    saveSession();
    if (t === active) renderDoc(t); // relative images now resolve
  }
  t.cleanGen = gen;
  t.external = null;
  updateTabState(t);
  syncDirty();
  if (t === active) { setTitle(); updateStatus(); showBanner(); }
  toast('Saved');
  return true;
}

function suggestName(t) {
  const m = /^#\s+(.+)$/m.exec(t.doc.getValue());
  const base = m ? m[1].replace(/[\\/:*?"<>|#]/g, '').trim().slice(0, 60) : '';
  return (base || 'Untitled') + '.md';
}

async function reloadActive() {
  const t = active;
  if (!t || !t.path) return;
  if (isDirty(t)) {
    const ok = await modal({
      title: 'Reload from disk?', text: 'Your unsaved changes in this tab will be lost.',
      buttons: [{ label: 'Cancel', value: false }, { label: 'Reload', value: true, danger: true }],
    });
    if (!ok) return;
  }
  const res = await request({ type: 'reload', path: t.path });
  if (res.ok) { applyContent(t, res.content); t.external = null; showBanner(); toast('Reloaded'); }
  else toast(res.error || 'Could not reload');
}

async function exportHtml() {
  const t = active;
  if (!t) return;
  const clone = docEl.cloneNode(true);
  clone.querySelectorAll('.copy-btn, .code-head').forEach(e => e.remove());
  clone.querySelectorAll('mark.find-hit').forEach(m => m.replaceWith(...m.childNodes));
  clone.querySelectorAll('[src^="https://local.mdr/"], [poster^="https://local.mdr/"]').forEach(el => {
    for (const attr of ['src', 'poster']) {
      const v = el.getAttribute(attr);
      if (v && v.startsWith('https://local.mdr/')) {
        const p = new URL(v).searchParams.get('p');
        el.setAttribute(attr, 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:'));
      }
    }
  });
  const css = await (await fetch('app.css')).text();
  const hl = await (await fetch(isDarkNow() ? 'vendor/hljs-dark.css' : 'vendor/hljs-light.css')).text();
  const html = `<!doctype html>
<html lang="en" data-theme="${isDarkNow() ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.name.replace(/\.[^.]+$/, ''))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>${css}\n${hl}\nhtml,body{height:auto;overflow:auto}body{background:var(--bg)}</style>
</head><body><article class="markdown-body">${clone.innerHTML}</article></body></html>`;
  const res = await request({ type: 'export', content: html, name: t.name.replace(/\.[^.]+$/, '') + '.html' });
  if (res.ok) toast('Exported');
}

// ------------------------------------------------------------ link handling
docEl.addEventListener('click', e => {
  const copy = e.target.closest('.copy-btn');
  if (copy) {
    const code = copy.closest('.code-block').querySelector('code').innerText;
    copyText(code).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); });
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) { scrollToAnchor(decodeURIComponent(href.slice(1))); return; }
  if (/^(https?:|mailto:)/i.test(href)) { send({ type: 'external', url: href }); return; }
  const hashAt = href.indexOf('#');
  const pathPart = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const anchor = hashAt >= 0 ? decodeURIComponent(href.slice(hashAt + 1)) : '';
  const base = active?.path ? MDRender.dirOf(active.path) : '';
  const path = MDRender.resolveLocal(base, pathPart);
  if (!path) { toast(base ? 'Unsupported link' : 'Save this file first to follow relative links'); return; }
  if (MDRender.MD_EXT.test(path)) send({ type: 'openPath', path, anchor });
  else send({ type: 'external', url: path });
});
docEl.addEventListener('auxclick', e => { if (e.button === 1 && e.target.closest('a')) e.preventDefault(); });

function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
  return Promise.resolve();
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

// ------------------------------------------------------------ find
const findState = { open: false, target: 'doc', hits: [], index: -1, cmMarks: [] };
const findInput = $('#find-input');

function openFind() {
  if (!active) return;
  const editorFocused = active.mode === 'split' && cm && cm.hasFocus();
  findState.target = editorFocused ? 'editor' : 'doc';
  findState.open = true;
  $('#findbar').hidden = false;
  const sel = editorFocused ? cm.getSelection() : String(getSelection());
  if (sel && !sel.includes('\n') && sel.length < 100) findInput.value = sel;
  findInput.placeholder = findState.target === 'editor' ? 'Find in source' : 'Find in document';
  findInput.focus();
  findInput.select();
  runFind(true);
}

function closeFind(refocus = true) {
  if (!findState.open) return;
  findState.open = false;
  $('#findbar').hidden = true;
  clearFindMarks();
  if (refocus) {
    if (findState.target === 'editor' && cm) cm.focus(); else viewPane.focus({ preventScroll: true });
  }
}

function clearFindMarks() {
  for (const m of docEl.querySelectorAll('mark.find-hit')) {
    const parent = m.parentNode;
    m.replaceWith(...m.childNodes);
    parent.normalize();
  }
  for (const m of findState.cmMarks) m.clear();
  findState.cmMarks = [];
  findState.hits = [];
  findState.index = -1;
}

function runFind(scroll) {
  const q = findInput.value;
  clearFindMarks();
  if (!q) { $('#find-count').textContent = ''; return; }
  const ql = q.toLowerCase();

  if (findState.target === 'editor' && cm) {
    const cur = cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: true });
    while (cur.findNext() && findState.hits.length < 5000) {
      findState.hits.push({ from: cur.from(), to: cur.to() });
      findState.cmMarks.push(cm.markText(cur.from(), cur.to(), { className: 'cm-find-hit' }));
    }
    const cursor = cm.getCursor('from');
    findState.index = Math.max(0, findState.hits.findIndex(h => CodeMirror.cmpPos(h.from, cursor) >= 0));
  } else {
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('.katex, .mermaid-block svg, style, script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue, lower = text.toLowerCase();
      let i = lower.indexOf(ql);
      if (i < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (i >= 0 && findState.hits.length < 5000) {
        frag.append(text.slice(last, i));
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        mark.textContent = text.slice(i, i + q.length);
        frag.append(mark);
        findState.hits.push(mark);
        last = i + q.length;
        i = lower.indexOf(ql, last);
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
    const top = viewPane.scrollTop;
    findState.index = Math.max(0, findState.hits.findIndex(m => topIn(m) >= top));
  }
  if (!findState.hits.length) findState.index = -1;
  showFindCurrent(scroll);
}

function showFindCurrent(scroll) {
  const n = findState.hits.length;
  $('#find-count').textContent = n ? `${findState.index + 1} of ${n}` : 'No results';
  if (!n) return;
  const hit = findState.hits[findState.index];
  if (findState.target === 'editor') {
    cm.setSelection(hit.from, hit.to);
    if (scroll) cm.scrollIntoView({ from: hit.from, to: hit.to }, 80);
  } else {
    findState.hits.forEach((m, i) => m.classList.toggle('current', i === findState.index));
    if (scroll) {
      const details = hit.closest('details');
      if (details && !details.open) details.open = true;
      hit.scrollIntoView({ block: 'center' });
    }
  }
}

function findStep(dir) {
  const n = findState.hits.length;
  if (!n) return;
  findState.index = (findState.index + dir + n) % n;
  showFindCurrent(true);
}

let findTimer = 0;
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => { findTimer = 0; runFind(true); }, 80);
});
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (findTimer) { clearTimeout(findTimer); findTimer = 0; runFind(false); }
    findStep(e.shiftKey ? -1 : 1);
  }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#find-next').onclick = () => findStep(1);
$('#find-prev').onclick = () => findStep(-1);
$('#find-close').onclick = () => closeFind();

// ------------------------------------------------------------ popovers & menus
let popoverAnchor = null;
function openPopover(anchor, build) {
  const pop = $('#popover');
  if (!pop.hidden && popoverAnchor === anchor) { closePopover(); return; }
  pop.innerHTML = '';
  build(pop);
  pop.hidden = false;
  popoverAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
}
function closePopover() { $('#popover').hidden = true; popoverAnchor = null; }
document.addEventListener('mousedown', e => {
  if (!$('#popover').hidden && !e.target.closest('#popover') && !e.target.closest('[data-cmd]')) closePopover();
});

function menuItem(pop, { label, sub, key, iconName, onClick, checked, keepOpen }) {
  const b = document.createElement('button');
  b.className = 'menu-item' + (checked ? ' checked' : '');
  b.innerHTML = `${icon(checked ? 'check' : iconName || 'file')}<span class="mi-label">${esc(label)}${sub ? `<span class="mi-sub">${esc(sub)}</span>` : ''}</span>${key ? `<span class="mi-key">${esc(key)}</span>` : ''}`;
  b.onclick = () => { if (!keepOpen) closePopover(); onClick(); };
  pop.appendChild(b);
  return b;
}
const menuSep = pop => pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
const menuHead = (pop, text) => pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-head', textContent: text }));

function showRecentMenu(anchor) {
  openPopover(anchor, pop => {
    menuHead(pop, 'Recent files');
    if (!recent.length) {
      pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-empty', textContent: 'Nothing here yet' }));
      return;
    }
    for (const p of recent.slice(0, 15)) {
      menuItem(pop, { label: MDRender.baseName(p), sub: MDRender.dirOf(p), iconName: 'file', onClick: () => send({ type: 'openPath', path: p }) });
    }
    menuSep(pop);
    menuItem(pop, { label: 'Clear recent files', iconName: 'trash', onClick: () => send({ type: 'clearRecent' }) });
  });
}

function showMainMenu(anchor) {
  openPopover(anchor, pop => {
    const t = active;
    if (t) {
      menuItem(pop, { label: 'Save', key: 'Ctrl+S', iconName: 'save', onClick: () => saveTab(t) });
      menuItem(pop, { label: 'Save as…', key: 'Ctrl+Shift+S', iconName: 'save', onClick: () => saveTab(t, true) });
      if (t.path) {
        menuItem(pop, { label: 'Reload from disk', key: 'Ctrl+R', iconName: 'refresh', onClick: reloadActive });
        menuItem(pop, { label: 'Show in File Explorer', iconName: 'explorer', onClick: () => send({ type: 'reveal', path: t.path }) });
        menuItem(pop, { label: 'Copy file path', iconName: 'copy', onClick: () => copyText(t.path).then(() => toast('Path copied')) });
      }
      menuSep(pop);
      menuItem(pop, { label: 'Print / Save as PDF', key: 'Ctrl+P', iconName: 'printer', onClick: printDoc });
      menuItem(pop, { label: 'Export as HTML…', iconName: 'code', onClick: exportHtml });
      menuSep(pop);
    }
    const row = document.createElement('div');
    row.className = 'menu-row';
    row.innerHTML = `<span class="mi-label">Zoom</span>`;
    const zbtn = (name, d, title) => {
      const b = document.createElement('button');
      b.className = 'icon-btn small';
      b.title = title;
      b.innerHTML = icon(name);
      b.onclick = () => { zoom(d); val.textContent = Math.round(ui.zoom * 100) + '%'; };
      return b;
    };
    const val = Object.assign(document.createElement('button'), { className: 'icon-btn small zoom-val', textContent: Math.round(ui.zoom * 100) + '%', title: 'Reset (Ctrl+0)' });
    val.onclick = () => { zoom(0); val.textContent = '100%'; };
    row.append(zbtn('minus', -0.1, 'Zoom out (Ctrl+-)'), val, zbtn('plus', 0.1, 'Zoom in (Ctrl+=)'));
    pop.appendChild(row);
    menuSep(pop);
    menuHead(pop, 'Theme');
    for (const [v, label, ic] of [['system', 'Match Windows', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']])
      menuItem(pop, { label, iconName: ic, checked: ui.theme === v, onClick: () => setTheme(v) });
    menuSep(pop);
    menuItem(pop, { label: 'Keyboard shortcuts', iconName: 'keyboard', onClick: showShortcuts });
  });
}

function showShortcuts() {
  const rows = [
    ['Ctrl+O', 'Open file'], ['Ctrl+N', 'New file'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as'],
    ['Ctrl+W', 'Close tab'], ['Ctrl+Shift+T', 'Reopen closed tab'], ['Ctrl+Tab', 'Next tab'],
    ['Ctrl+E', 'Toggle edit mode'], ['Ctrl+\\', 'Toggle contents sidebar'], ['Ctrl+F / F3', 'Find / next'],
    ['Ctrl+R', 'Reload from disk'], ['Ctrl+P', 'Print / PDF'], ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom'],
    ['Ctrl+B / Ctrl+I / Ctrl+K', 'Bold / italic / link (editor)'],
  ];
  modal({
    title: 'Keyboard shortcuts',
    html: `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${rows.map(([k, d]) =>
      `<tr><td style="padding:4px 12px 4px 0;white-space:nowrap;color:var(--text)"><code style="font-family:var(--font-mono)">${esc(k)}</code></td><td style="padding:4px 0;color:var(--muted)">${esc(d)}</td></tr>`).join('')}</table>`,
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

function printDoc() {
  if (!active) return;
  closeFind(false);
  window.print();
}

// ------------------------------------------------------------ modal & toast
let modalResolve = null;
function modal({ title, text, html, buttons }) {
  return new Promise(resolve => {
    const m = $('#modal');
    m.innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${html ? `<div style="margin-bottom:16px">${html}</div>` : ''}<div class="modal-buttons"></div>`;
    const row = m.querySelector('.modal-buttons');
    let primaryBtn = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.onclick = () => finish(b.value);
      row.appendChild(el);
      if (b.primary) primaryBtn = el;
    }
    const finish = v => { $('#modal-backdrop').hidden = true; modalResolve = null; resolve(v); };
    modalResolve = finish;
    $('#modal-backdrop').hidden = false;
    (primaryBtn || row.lastChild).focus();
  });
}
$('#modal-backdrop').addEventListener('mousedown', e => { if (e.target.id === 'modal-backdrop' && modalResolve) modalResolve(null); });

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1600);
}

// ------------------------------------------------------------ welcome
function renderWelcome() {
  const box = $('#welcome-recent');
  box.innerHTML = '';
  if (!recent.length) return;
  box.innerHTML = '<h2>Recent</h2>';
  for (const p of recent.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'recent-item';
    row.title = p;
    row.innerHTML = `${icon('file')}<div class="ri-text"><div class="ri-name">${esc(MDRender.baseName(p))}</div><div class="ri-dir"><bdi>${esc(MDRender.dirOf(p))}</bdi></div></div>` +
      `<button class="icon-btn small ri-remove" title="Remove from list">${icon('x')}</button>`;
    row.onclick = e => {
      if (e.target.closest('.ri-remove')) send({ type: 'removeRecent', path: p });
      else send({ type: 'openPath', path: p });
    };
    box.appendChild(row);
  }
}

// ------------------------------------------------------------ commands & keys
const commands = {
  new: newFile,
  open: () => send({ type: 'open' }),
  recent: el => showRecentMenu(el),
  toc: () => { if (active?.mode === 'split') { setMode('view'); if (!ui.sidebar) toggleSidebar(); } else toggleSidebar(); },
  edit: toggleEdit,
  find: openFind,
  theme: cycleTheme,
  menu: el => showMainMenu(el),
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-cmd]');
  if (el && commands[el.dataset.cmd]) commands[el.dataset.cmd](el);
});

document.addEventListener('keydown', e => {
  if (!$('#modal-backdrop').hidden) {
    if (e.key === 'Escape' && modalResolve) { e.preventDefault(); modalResolve(null); }
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!$('#popover').hidden) { closePopover(); return; }
    if (findState.open) { closeFind(); return; }
  }
  if (e.key === 'F3') { e.preventDefault(); findState.open ? findStep(e.shiftKey ? -1 : 1) : openFind(); return; }
  if (!ctrl) return;
  let handled = true;
  if (k === 'o') commands.open();
  else if (k === 'n') newFile();
  else if (k === 's' && e.shiftKey) active && saveTab(active, true);
  else if (k === 's') active && saveTab(active);
  else if (k === 'w' || e.key === 'F4') active && closeTab(active);
  else if (k === 't' && e.shiftKey) { const p = closedStack.pop(); if (p) send({ type: 'openPath', path: p }); }
  else if (e.key === 'Tab') cycleTab(e.shiftKey ? -1 : 1);
  else if (e.key === 'PageDown') cycleTab(1);
  else if (e.key === 'PageUp') cycleTab(-1);
  else if (k === 'e') toggleEdit();
  else if (k === 'f') openFind();
  else if (e.key === '\\') commands.toc();
  else if (k === 'r') reloadActive();
  else if (k === 'p') printDoc();
  else if (e.key === '=' || e.key === '+') zoom(0.1);
  else if (e.key === '-') zoom(-0.1);
  else if (e.key === '0') zoom(0);
  else if (/^[1-9]$/.test(e.key) && tabs.length) activate(e.key === '9' ? tabs[tabs.length - 1] : tabs[Math.min(+e.key - 1, tabs.length - 1)]);
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });

// keyboard scrolling in the reader even when nothing is focused
document.addEventListener('keydown', e => {
  if (!active || active.mode !== 'view' || e.ctrlKey || e.altKey) return;
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (document.activeElement === viewPane) return;
  const map = { ArrowDown: 40, ArrowUp: -40, PageDown: viewPane.clientHeight * 0.9, PageUp: -viewPane.clientHeight * 0.9, ' ': viewPane.clientHeight * 0.9 * (e.shiftKey ? -1 : 1) };
  if (e.key === 'Home') { viewPane.scrollTop = 0; e.preventDefault(); }
  else if (e.key === 'End') { viewPane.scrollTop = viewPane.scrollHeight; e.preventDefault(); }
  else if (map[e.key] != null) { viewPane.scrollBy({ top: map[e.key] }); e.preventDefault(); }
});

// ------------------------------------------------------------ drag & drop files
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#drop-overlay').hidden = false; } });
addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  if (host && host.postMessageWithAdditionalObjects) host.postMessageWithAdditionalObjects({ type: 'drop' }, e.dataTransfer.files);
});

// ------------------------------------------------------------ messages from host
async function handleRequestClose() {
  const dirty = tabs.filter(isDirty);
  if (!dirty.length) { send({ type: 'closeNow' }); return; }
  const choice = await modal({
    title: dirty.length === 1 ? `Save changes to ${dirty[0].name}?` : `Save changes to ${dirty.length} files?`,
    text: 'Your changes will be lost if you don\'t save them.',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Don\'t save', value: 'discard', danger: true }, { label: dirty.length === 1 ? 'Save' : 'Save all', value: 'save', primary: true }],
  });
  if (choice === 'discard') { send({ type: 'closeNow' }); return; }
  if (choice !== 'save') return;
  for (const t of dirty) {
    activate(t);
    if (!(await saveTab(t))) return;
  }
  send({ type: 'closeNow' });
}

function onHostMessage(msg) {
  switch (msg.type) {
    case 'init': {
      ui = { ...DEFAULT_UI, ...(msg.ui || {}) };
      recent = msg.recent || [];
      appEl.classList.toggle('no-sidebar', !ui.sidebar);
      applyTheme();
      applyZoom();
      for (const f of msg.files || []) tabs.push(makeTab(f.path, f.content));
      const first = tabs.find(t => samePathAs(t.path, msg.active)) || tabs[tabs.length - 1] || null;
      if (first) activate(first); else { renderTabs(); showActive(false); }
      break;
    }
    case 'opened': openFile(msg.file, msg.anchor, msg.focus !== false); break;
    case 'changed': {
      for (const t of tabs.filter(x => samePathAs(x.path, msg.path))) {
        if (isDirty(t)) t.external = { kind: 'changed', content: msg.content };
        else { applyContent(t, msg.content); t.external = null; }
      }
      showBanner();
      break;
    }
    case 'deleted':
      for (const t of tabs.filter(x => samePathAs(x.path, msg.path))) t.external = { kind: 'deleted' };
      showBanner();
      break;
    case 'recent':
      recent = msg.recent || [];
      if (!active) renderWelcome();
      break;
    case 'reply': {
      const fn = pending.get(msg.rid);
      if (fn) { pending.delete(msg.rid); fn(msg); }
      break;
    }
    case 'requestClose': handleRequestClose(); break;
    case 'error': toast(msg.message); break;
  }
}

if (host) host.addEventListener('message', e => onHostMessage(e.data));

// ------------------------------------------------------------ boot
paintIcons();
updateToolbar();
if (host) send({ type: 'ready' });
else {
  // Opened directly in a browser (development): show a sample.
  onHostMessage({ type: 'init', ui: {}, recent: [], files: [] });
}
