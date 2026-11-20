(() => {
  'use strict';

  if (!(document.documentElement instanceof HTMLElement)) return;

  const plainDocument = document.contentType === 'text/plain';
  const block = 'body,p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,caption,blockquote,figure,figcaption,summary,div,section,article,main,aside,header,footer,span' + (plainDocument ? ',pre' : '');
  const codeClasses = ['code-block', 'code-block-content', 'markdown-code-block', 'inline-code', 'code-inline', 'codehilite', 'hljs', 'shiki', 'prism-code'];
  const editorClasses = ['monaco-editor', 'cm-editor', 'CodeMirror', 'ace_editor', 'xterm'];
  const contextClasses = [...codeClasses, ...editorClasses];
  const code = [
    'code,kbd,samp,code-block,[role="code"]',
    ...codeClasses.map(name => '.' + name),
    '[data-code-block],[data-streamdown="code-block-body"]',
    ...(plainDocument ? [] : ['pre']),
  ].join(',');
  const ignored = [
    'script,style,noscript,template,svg,math,canvas,iframe',
    'button,input,textarea,select,nav,menu,[hidden],[inert]',
    '[contenteditable]:not([contenteditable="false" i])',
    '[role="textbox"],[role="toolbar"],[role="navigation"],[role="menu"],[role="button"]',
    ...editorClasses.map(name => '.' + name),
  ].join(',');
  const boundary = 'p,pre,div,ul,ol,dl,table,figure,form,fieldset,details,section,article,aside,nav,header,footer,main,blockquote,hr,h1,h2,h3,h4,h5,h6';
  const directionAttr = 'data-rastkhan-dir';
  const alignAttr = 'data-rastkhan-align';
  const marks = '[' + directionAttr + '],[' + alignAttr + ']';
  const scope = document.documentElement;
  const subtrees = new Set();
  const singles = new Set();
  let timer = 0;
  let mode = 'off';

  function clearMarks(root) {
    for (const element of [root, ...root.querySelectorAll(marks)]) {
      element.removeAttribute(directionAttr);
      element.removeAttribute(alignAttr);
    }
  }

  // Count words so a long English product name cannot outweigh a Persian sentence.
  function readingDirection(text) {
    const prose = text.replace(/(?:https?:\/\/|www\.)\S+|[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ');
    let score = 0;
    let first;
    for (const [word] of prose.matchAll(/\p{L}[\p{L}\p{M}\u200c\u200d]*/gu)) {
      const script = /^[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(word) ? 1 :
        /^\p{Script=Latin}/u.test(word) ? -1 : 0;
      if (!script) continue;
      first ??= script;
      score += script;
    }
    if (!first) return /[a-z]/i.test(text) ? 'ltr' : null;
    return (score || first) > 0 ? 'rtl' : 'ltr';
  }

  function proseOf(element) {
    const chunks = [];
    let lineBreak = false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.matches(ignored + ',' + code + ',bdi,bdo')) return NodeFilter.FILTER_REJECT;
        if (element.localName === 'li' && node.matches('ol,ul')) return NodeFilter.FILTER_REJECT;
        if (node.matches(boundary + ',br')) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let node; (node = walker.nextNode());) {
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.data);
      } else if (node.localName === 'br') {
        lineBreak = true;
        chunks.push('\n');
      } else {
        return null;
      }
    }
    return { text: chunks.join(''), lineBreak };
  }

  // A scrollport has its own direction and can hide the start of a long LTR line.
  // A scrollable article containing both prose and code must keep its own direction.
  function scrollsOnlyCode(element, style) {
    if (!element.firstElementChild || !['auto', 'scroll'].includes(style.overflowX)) return false;
    let hasCode = false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (node.matches(ignored + ',figcaption')) return NodeFilter.FILTER_REJECT;
        if (node.matches(code) || (node.matches('div,span') && looksLikeCode(node, getComputedStyle(node)))) {
          hasCode = true;
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    return !walker.nextNode() && hasCode;
  }

  function looksLikeCode(element, style) {
    // Some Markdown renderers emit anonymous preformatted divs instead of a pre.
    if (plainDocument || !['div', 'span'].includes(element.localName)) return false;
    if (!['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace)) return false;
    if (!/mono|consolas|courier|menlo/i.test(style.fontFamily)) return false;
    if (element.querySelector('p,article,section,pre,textarea,[contenteditable]')) return false;
    return /(?:^|\n)[\t ]*(?:\/\/|\/\*|[.#]?[\w$]+(?:\.[\w$]+)*\s*(?:\(|=(?!=))|(?:const|let|val|fun|function|import|class|def)\s+\w)/m.test(element.textContent);
  }

  function inspect(element) {
    const tag = element.localName;
    if (element.matches(code)) return { dir: 'code' };
    if (tag === 'a') {
      return /^(?:https?:\/\/|www\.|[\w.%+-]+@[\w.-]+\.)/i.test(element.textContent.trim())
        ? { dir: 'ltr' } : null;
    }
    const style = getComputedStyle(element);
    if (looksLikeCode(element, style)) return { dir: 'code' };
    if (tag !== 'body' && scrollsOnlyCode(element, style)) return { dir: 'code-scroll' };
    // A container with block children belongs to the layout. Each child is visited separately.
    if (element.firstElementChild && element.localName !== 'li' && element.querySelector(':scope > :is(' + boundary + ')')) return null;
    if (!['block', 'flow-root', 'list-item', 'table-cell', 'table-caption', 'inline-block'].includes(style.display)) return null;
    const prose = proseOf(element);
    if (!prose || !prose.text.trim()) return null;
    const dir = mode === 'rtl' ? 'rtl' : readingDirection(prose.text);
    if (!dir) return null;
    const lines = mode === 'auto' && (prose.lineBreak ||
      (/\S[^\S\n]*\n[\s\S]*\S/u.test(prose.text) && ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(style.whiteSpace)));
    return { dir: lines ? dir + '-lines' : dir, align: !/center|justify/.test(style.textAlign) };
  }

  function scan(root, candidates) {
    if (root.matches(ignored) || root.parentElement?.closest(ignored + ',' + code)) {
      clearMarks(root);
      return;
    }
    if (root.matches(block + ',' + code + ',a')) candidates.add(root);
    if (root.matches(code)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(element) {
        if (element.matches(ignored)) {
          clearMarks(element);
          return NodeFilter.FILTER_REJECT;
        }
        if (element.matches(code)) {
          // A code sample is a single unit, even with syntax-highlighted token spans.
          candidates.add(element);
          return NodeFilter.FILTER_REJECT;
        }
        if (element.matches(block + ',a')) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let element; (element = walker.nextNode());) candidates.add(element);
  }

  function flush() {
    timer = 0;
    const candidates = new Set();
    for (const root of subtrees) {
      if (!root.isConnected) continue;
      let ancestor = root.parentElement;
      while (ancestor && !subtrees.has(ancestor)) ancestor = ancestor.parentElement;
      if (!ancestor) scan(root, candidates);
    }
    for (const element of singles) {
      if (element.isConnected && !element.closest(ignored) && !element.parentElement?.closest(code)) {
        candidates.add(element);
      }
    }
    subtrees.clear();
    singles.clear();
    // Read computed styles together before making any changes that invalidate layout.
    const updates = Array.from(candidates, element => [element, inspect(element)]);
    for (const [element, result] of updates) {
      if (!result) {
        element.removeAttribute(directionAttr);
      } else if (element.getAttribute(directionAttr) !== result.dir) {
        element.setAttribute(directionAttr, result.dir);
      }
      element.toggleAttribute(alignAttr, Boolean(result?.align));
    }
  }

  function schedule() {
    if (!timer) timer = window.setTimeout(flush, 24);
  }

  function queueOwners(node) {
    // Recheck the containing paragraph and any scrollports around a changing snippet.
    for (let element = node; element && element !== scope; element = element.parentElement) {
      if (singles.has(element)) break;
      if (element.matches(block + ',a,' + code)) singles.add(element);
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const element = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      if (!element) continue;
      if (record.type === 'attributes') {
        // Highlighting often arrives after the Markdown. Ordinary class changes
        // only affect the element and its owners; recognized code roots own a subtree.
        if (record.attributeName === 'class') {
          const before = new Set((record.oldValue || '').split(/\s+/));
          const contextChanged = contextClasses.some(name => before.has(name) !== element.classList.contains(name));
          if (!contextChanged) {
            if (!element.closest(ignored + ',' + code)) queueOwners(element);
            continue;
          }
        }
        subtrees.add(element);
        queueOwners(element.parentElement);
      } else if (!element.closest(ignored + ',' + code)) {
        queueOwners(element);
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) subtrees.add(node);
        }
      } else if (record.type === 'childList') {
        // A page can move a previously styled paragraph into an editor.
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && (node.matches(marks) || node.querySelector(marks))) clearMarks(node);
        }
      }
    }
    if (subtrees.size || singles.size) schedule();
  });

  function configure({ enabled = true, readingMode = 'auto' }) {
    const next = enabled ? (readingMode === 'rtl' ? 'rtl' : 'auto') : 'off';
    if (next === mode) return;
    mode = next;
    observer.disconnect();
    clearTimeout(timer);
    timer = 0;
    singles.clear();
    subtrees.clear();
    scope.toggleAttribute('data-rastkhan-active', mode !== 'off');
    if (mode === 'off') {
      clearMarks(scope);
      return;
    }
    subtrees.add(scope);
    schedule();
    observer.observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'data-code-block', 'data-streamdown', 'contenteditable', 'role', 'hidden', 'inert', 'dir'],
    });
  }

  let revision = 0;
  async function readSettings() {
    const version = ++revision;
    const settings = await chrome.storage.local.get(['enabled', 'readingMode']);
    if (version === revision) configure(settings);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('enabled' in changes || 'readingMode' in changes)) readSettings();
  });
  readSettings();
})();
