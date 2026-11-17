/* Markdown → HTML pipeline (markdown-it + KaTeX + highlight.js + Mermaid) and path helpers. */
'use strict';

const MDRender = (() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ paths
  const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdx|mdwn|txt)$/i;

  function normalizePath(p) {
    p = p.replace(/\//g, '\\');
    let prefix = '';
    if (p.startsWith('\\\\')) { prefix = '\\\\'; p = p.slice(2); }
    const out = [];
    for (const part of p.split('\\')) {
      if (part === '' || part === '.') continue;
      if (part === '..') { if (out.length > (prefix ? 2 : 1)) out.pop(); continue; }
      out.push(part);
    }
    return prefix + out.join('\\');
  }
  const isAbsolute = p => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
  const dirOf = p => p ? p.replace(/[\\/][^\\/]*$/, '') : '';
  const baseName = p => p ? p.replace(/^.*[\\/]/, '') : '';
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

  function fileUrlToPath(url) {
    let p = safeDecode(url.replace(/^file:\/*/i, ''));
    if (/^[a-zA-Z]:/.test(p)) return normalizePath(p);
    return '\\\\' + normalizePath(p); // file://server/share
  }

  /** Resolve a link/src from a document to an absolute Windows path, or null if it is a URL. */
  function resolveLocal(baseDir, href) {
    if (!href) return null;
    if (/^file:/i.test(href)) return fileUrlToPath(href);
    if (/^[a-z][a-z0-9+.-]+:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href)) return null; // http:, data:, mailto:...
    if (href.startsWith('//')) return null;
    const p = safeDecode(href);
    if (isAbsolute(p)) return normalizePath(p);
    if (!baseDir) return null;
    if (p.startsWith('/') || p.startsWith('\\')) return normalizePath(baseDir.slice(0, 2) + p);
    return normalizePath(baseDir + '\\' + p);
  }
  const localUrl = path => 'https://local.mdr/?p=' + encodeURIComponent(path);

  // ------------------------------------------------------------ slugs
  function slugify(text) {
    return text.trim().toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  }

  // ------------------------------------------------------------ math plugin
  function mathPlugin(md) {
    function inlineMath(state, silent) {
      const src = state.src, start = state.pos;
      if (src.charCodeAt(start) !== 0x24 /* $ */) return false;

      if (src.charCodeAt(start + 1) === 0x24) { // $$ ... $$ inline display
        const end = src.indexOf('$$', start + 2);
        if (end === -1 || end === start + 2) return false;
        if (!silent) {
          const t = state.push('math_inline_display', 'math', 0);
          t.content = src.slice(start + 2, end);
        }
        state.pos = end + 2;
        return true;
      }

      const next = src[start + 1];
      if (!next || /\s/.test(next)) return false;
      let end = start + 1;
      for (;;) {
        end = src.indexOf('$', end);
        if (end === -1) return false;
        if (src[end - 1] === '\\') { end++; continue; }
        if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || '')) { end++; continue; }
        break;
      }
      if (!silent) {
        const t = state.push('math_inline', 'math', 0);
        t.content = src.slice(start + 1, end);
      }
      state.pos = end + 1;
      return true;
    }

    function blockMath(state, startLine, endLine, silent) {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.src.slice(pos, pos + 2) !== '$$') return false;

      const firstRest = state.src.slice(pos + 2, max).trim();
      let content, line = startLine, found = false;
      if (firstRest.length >= 2 && firstRest.endsWith('$$')) {
        content = firstRest.slice(0, -2);
        found = true;
      } else {
        const lines = [firstRest];
        for (line = startLine + 1; line < endLine; line++) {
          pos = state.bMarks[line] + state.tShift[line];
          max = state.eMarks[line];
          if (pos < max && state.sCount[line] < state.blkIndent) break;
          const text = state.src.slice(pos, max).trimEnd();
          if (text.endsWith('$$')) { lines.push(text.slice(0, -2)); found = true; break; }
          lines.push(text);
        }
        content = lines.join('\n');
      }
      if (!found) return false;
      if (silent) return true;
      const t = state.push('math_block', 'math', 0);
      t.block = true;
      t.content = content;
      t.map = [startLine, line + 1];
      state.line = line + 1;
      return true;
    }

    const tex = (src, display) => {
      try { return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' }); }
      catch (e) { return `<code class="math-error">${esc(src)}</code>`; }
    };
    md.inline.ruler.after('escape', 'math_inline', inlineMath);
    md.block.ruler.after('blockquote', 'math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.math_inline = (t, i) => tex(t[i].content, false);
    md.renderer.rules.math_inline_display = (t, i) => `<span class="math-display">${tex(t[i].content, true)}</span>`;
    md.renderer.rules.math_block = (t, i) =>
      `<div class="math-display"${t[i].map ? ` data-line="${t[i].map[0]}"` : ''}>${tex(t[i].content, true)}</div>\n`;
    md.__tex = tex;
  }

  // ------------------------------------------------------------ heading ids + source line attrs
  function structurePlugin(md) {
    md.core.ruler.push('mdr_structure', state => {
      const used = new Map();
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.map && t.nesting === 1 && t.level === 0) t.attrSet('data-line', String(t.map[0]));
        else if (t.map && t.nesting === 1 && (t.type === 'list_item_open' || t.type === 'tr_open')) t.attrSet('data-line', String(t.map[0]));
        if (t.type === 'heading_open') {
          const inline = tokens[i + 1];
          const text = (inline.children || []).filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('');
          let slug = slugify(text) || 'section';
          const n = used.get(slug) || 0;
          used.set(slug, n + 1);
          if (n) slug += '-' + n;
          t.attrSet('id', slug);
        }
      }
    });
  }

  // ------------------------------------------------------------ markdown-it instance
  const md = window.markdownit({ html: true, linkify: true, typographer: false, breaks: false })
    .use(window.markdownitFootnote)
    .use(mathPlugin)
    .use(structurePlugin);

  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    if (lang === 'mermaid')
      return `<div class="mermaid-block"${line}><pre class="mermaid-src">${esc(t.content)}</pre></div>\n`;
    if (lang === 'math' || lang === 'katex')
      return `<div class="math-display"${line}>${md.__tex(t.content, true)}</div>\n`;
    let body = null;
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      try { body = hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value; } catch { /* plain */ }
    }
    if (body === null) body = esc(t.content);
    return `<div class="code-block"${line}><div class="code-head"><span class="code-lang">${esc(lang)}</span>` +
      `</div><pre class="hljs"><code>${body}</code></pre></div>\n`;
  };
  md.renderer.rules.code_block = (tokens, idx) => {
    const t = tokens[idx];
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    return `<div class="code-block"${line}><div class="code-head"><span class="code-lang"></span>` +
      `</div><pre class="hljs"><code>${esc(t.content)}</code></pre></div>\n`;
  };

  // ------------------------------------------------------------ render
  const FRONT_MATTER = /^(?:﻿)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

  function render(src) {
    let front = '';
    const m = FRONT_MATTER.exec(src);
    if (m) {
      front = `<details class="front-matter" data-line="0"><summary>Front matter</summary><pre>${esc(m[1])}</pre></details>`;
      // keep line numbers stable for scroll sync by blanking instead of removing
      src = m[0].replace(/[^\n]/g, '') + src.slice(m[0].length);
    }
    const html = front + md.render(src);
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
      ADD_ATTR: ['data-line'],
      ALLOW_DATA_ATTR: true,
    });
  }

  const ALERTS = {
    note: ['Note', '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>'],
    tip: ['Tip', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>'],
    important: ['Important', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v4M12 14h.01"/>'],
    warning: ['Warning', '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'],
    caution: ['Caution', '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v4M12 16h.01"/>'],
  };

  /** DOM fix-ups after innerHTML: local media, task lists, alerts, tables. */
  function postProcess(root, baseDir) {
    for (const el of root.querySelectorAll('img[src], video[src], audio[src], source[src], video[poster]')) {
      for (const attr of ['src', 'poster']) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const local = resolveLocal(baseDir, v);
        if (local) el.setAttribute(attr, localUrl(local));
      }
      if (el.tagName === 'IMG') el.loading = 'lazy';
    }

    for (const li of root.querySelectorAll('li')) {
      const firstEl = li.firstElementChild;
      const holder = firstEl && firstEl.tagName === 'P' && li.firstChild === firstEl ? firstEl : li;
      const first = holder.firstChild;
      if (!first || first.nodeType !== 3) continue;
      const m = /^\[([ xX])\](\s|$)/.exec(first.nodeValue);
      if (!m) continue;
      first.nodeValue = first.nodeValue.slice(m[0].length);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.disabled = true;
      cb.checked = m[1] !== ' ';
      holder.insertBefore(cb, first);
      li.classList.add('task-item');
      li.parentElement.classList.add('task-list');
    }

    for (const bq of root.querySelectorAll('blockquote')) {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P' || !p.firstChild || p.firstChild.nodeType !== 3) continue;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(p.firstChild.nodeValue);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      p.firstChild.nodeValue = p.firstChild.nodeValue.slice(m[0].length);
      if (p.firstChild.nodeValue === '' && p.childNodes.length > 1 && p.childNodes[1].nodeName === 'BR') p.childNodes[1].remove();
      if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
      bq.classList.add('alert', 'alert-' + kind);
      const title = document.createElement('div');
      title.className = 'alert-title';
      title.innerHTML = `<svg class="i" viewBox="0 0 24 24">${ALERTS[kind][1]}</svg>${ALERTS[kind][0]}`;
      bq.prepend(title);
    }

    for (const table of root.querySelectorAll('table')) {
      if (table.parentElement.classList.contains('table-wrap')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      if (table.dataset.line) wrap.dataset.line = table.dataset.line;
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }

    for (const head of root.querySelectorAll('.code-head')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy';
      head.appendChild(btn);
    }

    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^(https?:|mailto:)/i.test(href)) a.classList.add('external');
      a.title = a.title || href;
    }
  }

  // ------------------------------------------------------------ mermaid (lazy)
  let mermaidPromise = null, mermaidTheme = null, mermaidSeq = 0, mermaidQueue = Promise.resolve();
  const mermaidCache = new Map();
  function loadMermaid() {
    return mermaidPromise ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/mermaid.min.js';
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => { mermaidPromise = null; reject(new Error('Mermaid failed to load')); };
      document.head.appendChild(s);
    });
  }

  function renderMermaid(root, dark) {
    const blocks = [...root.querySelectorAll('.mermaid-block')];
    if (!blocks.length) return Promise.resolve();
    for (const b of blocks) {
      if (!b.dataset.src) b.dataset.src = b.querySelector('.mermaid-src')?.textContent ?? '';
    }
    const job = mermaidQueue.then(async () => {
      const mermaid = await loadMermaid();
      const theme = dark ? 'dark' : 'default';
      if (mermaidTheme !== theme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'Segoe UI Variable Text, Segoe UI, sans-serif' });
        mermaidTheme = theme;
      }
      for (const b of blocks) {
        if (!b.isConnected) continue;
        const src = b.dataset.src;
        const key = theme + '\u0000' + src;
        let svg = mermaidCache.get(key);
        if (!svg) {
          const id = 'mmd-' + (++mermaidSeq);
          try {
            svg = (await mermaid.render(id, src)).svg;
            if (mermaidCache.size > 300) mermaidCache.clear();
            mermaidCache.set(key, svg);
          } catch (e) {
            document.getElementById(id)?.remove();
            document.getElementById('d' + id)?.remove();
            b.innerHTML = `<pre class="mermaid-error">Mermaid: ${esc((e && e.message) || e)}</pre>`;
            continue;
          }
        }
        b.innerHTML = svg;
        b.classList.add('rendered');
      }
    }).catch(e => console.warn(e));
    mermaidQueue = job;
    return job;
  }

  return { render, postProcess, renderMermaid, resolveLocal, localUrl, dirOf, baseName, isAbsolute, MD_EXT, esc, slugify };
})();
