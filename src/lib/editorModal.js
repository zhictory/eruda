import LunaModal from 'luna-modal'
import h from 'licia/h'
import each from 'licia/each'
import evalCss from './evalCss'
import { classPrefix as c } from './util'

// Marker is removed on insert and the caret is placed where it was.
const MARKER = '¦'
const DRAWER_CLASS = c('editor-drawer')
const DRAWER_OPEN_CLASS = c('editor-drawer-open')

// Only helpers that are available in the page's global scope (logger.evaluate
// uses eval in that scope). DevTools-only shortcuts such as $0 / copy() are
// intentionally left out because they would throw at runtime.
export const JS_QUICK_FNS = [
  { label: 'log()', code: 'console.log(¦)' },
  { label: 'dir()', code: 'console.dir(¦)' },
  { label: 'table()', code: 'console.table(¦)' },
  { label: 'stringify()', code: 'JSON.stringify(¦, null, 2)' },
  { label: 'parse()', code: 'JSON.parse(¦)' },
  { label: 'keys()', code: 'Object.keys(¦)' },
  { label: 'values()', code: 'Object.values(¦)' },
  { label: 'entries()', code: 'Object.entries(¦)' },
  { label: 'query()', code: 'document.querySelector(¦)' },
  { label: 'queryAll()', code: 'document.querySelectorAll(¦)' },
  { label: 'location', code: 'location.href' },
  { label: 'reload()', code: 'location.reload()' },
  { label: 'storage', code: 'Object.entries(localStorage)' },
  { label: 'cookies', code: 'document.cookie' },
  { label: 'now()', code: 'performance.now()' },
  { label: 'typeof', code: 'typeof ¦' },
]

// The modal must live inside the eruda container so that the styles injected
// by evalCss (which may be inside a shadow root) still apply to it.
export function getEditorContainer(devtools) {
  return devtools._$el.get(0)
}

let host = null
let modal = null
let content = null
let textarea = null
let selectBox = null
let selectTrigger = null
let selectMenu = null
let selectOpen = false
let quickFnList = []
let hintEl = null
let saveBtn = null
// Recent executed snippets, shown in a right-hand sidebar of the console editor.
// Kept in memory (so it works even when localStorage is unavailable) and
// mirrored to localStorage best-effort so it survives reloads.
let historyKey = ''
let historyCache = null
let historyCacheKey = ''
let historyPanel = null
let historyList = null
const HISTORY_MAX = 30
let onSave = null
let onCancel = null
let formatMode = 'json'

function hc(tag, ...classes) {
  return h(tag + classes.map((cls) => c('.' + cls)).join(''))
}

function closeSelectMenu() {
  selectOpen = false
  if (selectMenu) selectMenu.classList.remove(c('editor-select-menu-open'))
}

function toggleSelectMenu() {
  selectOpen = !selectOpen
  selectMenu.classList.toggle(c('editor-select-menu-open'), selectOpen)
}

// Grow the textarea to fit its content so the drawer never needs its own
// scrollbar for short/medium snippets. Past a comfortable cap the textarea
// itself scrolls (see .editor-textarea max-height) instead of the modal body.
function autoResizeTextarea() {
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = textarea.scrollHeight + 'px'
}

function insert(text) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const val = textarea.value
  textarea.value = val.slice(0, start) + text + val.slice(end)
  autoResizeTextarea()
  const pos = start + text.length
  textarea.focus()
  textarea.setSelectionRange(pos, pos)
}

const HISTORY_STORAGE_KEY = 'eruda-js-editor-history'

function getStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadHistory() {
  if (historyCacheKey === historyKey && historyCache) return historyCache
  let list = []
  const store = getStorage()
  if (store) {
    try {
      const raw = store.getItem(HISTORY_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) list = parsed
      }
    } catch {
      // Ignore malformed/corrupt stored history.
    }
  }
  historyCache = list
  historyCacheKey = historyKey
  return list
}

function saveHistoryToStore(list) {
  const store = getStorage()
  if (!store) return
  try {
    store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage may be full or blocked; history still lives in memory.
  }
}

function addHistory(text) {
  const val = text.trim()
  if (!val) return
  const list = loadHistory().filter((item) => item !== val)
  list.unshift(val)
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX
  historyCache = list
  historyCacheKey = historyKey
  saveHistoryToStore(list)
}

function renderHistory() {
  if (!historyList) return
  const list = loadHistory()
  historyList.textContent = ''
  if (!list.length) {
    const empty = hc('div', 'editor-history-empty')
    empty.textContent = 'No recent code yet'
    historyList.appendChild(empty)
    return
  }
  each(list, (code) => {
    const item = hc('div', 'editor-history-item')
    item.textContent = code.length > 120 ? code.slice(0, 120) + '…' : code
    item.setAttribute('title', code)
    item.addEventListener('click', () => {
      textarea.value = code
      textarea.focus()
      const pos = textarea.value.length
      textarea.setSelectionRange(pos, pos)
    })
    historyList.appendChild(item)
  })
}

function insertQuickFn(fn) {
  const at = fn.code.indexOf(MARKER)
  const clean = at === -1 ? fn.code : fn.code.replace(MARKER, '')
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const val = textarea.value
  textarea.value = val.slice(0, start) + clean + val.slice(end)
  autoResizeTextarea()
  const caret = start + (at === -1 ? clean.length : at)
  textarea.focus()
  textarea.setSelectionRange(caret, caret)
}

function formatCode(text) {
  const trimmed = text.trim()
  if (!trimmed) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return formatMode === 'code' ? beautify(text) : text
  }
}

// Lightweight, non-evaluating beautifier. JSON is handled above; this only
// normalises indentation for the remaining JS. It is intentionally simple and
// does not try to parse template literals or regex literals.
function beautify(src) {
  const lines = []
  let indent = 0
  let cur = ''
  let quote = ''
  let str = false
  let esc = false
  let lineComment = false
  let blockComment = false

  const push = () => {
    const t = cur.trim()
    if (t) lines.push('  '.repeat(indent) + t)
    cur = ''
  }
  const len = src.length

  for (let i = 0; i < len; i++) {
    const ch = src[i]
    const next = src[i + 1]

    if (lineComment) {
      cur += ch
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      cur += ch
      if (ch === '*' && next === '/') {
        cur += next
        i++
        blockComment = false
      }
      continue
    }
    if (str) {
      cur += ch
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === quote) str = false
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      cur += ch
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      str = true
      quote = ch
      cur += ch
      continue
    }
    if (ch === '}' || ch === ']') {
      push()
      indent = Math.max(0, indent - 1)
      cur = ch
      continue
    }
    if (ch === '{' || ch === '[') {
      cur += ch
      push()
      indent++
      continue
    }
    if (ch === ';' || ch === ',') {
      cur += ch
      push()
      continue
    }
    if (ch === '\n' || ch === '\r') {
      push()
      continue
    }
    cur += ch
  }
  push()

  return lines.join('\n')
}

function hide(save, cancelled) {
  if (!modal) return
  const val = textarea.value
  // Snap back to the closed position so the next open animates in from the
  // top again (the host is reused between opens).
  host.classList.remove(DRAWER_OPEN_CLASS)
  modal.hide()
  if (save && onSave) {
    const fn = onSave
    onSave = null
    onCancel = null
    if (historyKey) addHistory(val)
    fn(val)
  } else if (cancelled && onCancel) {
    const fn = onCancel
    onSave = null
    onCancel = null
    fn(val)
  }
}

function ensure(container) {
  if (modal && host && container.contains(host)) return

  evalCss(require('./editorModal.scss'))

  // LunaModal's Component constructor adds the real `luna-modal` class to the
  // host itself. Do NOT set an inline `display: none` here: show() only removes
  // the `luna-modal-hidden` class, so an inline style would never be cleared
  // and the editor would stay invisible.
  host = h('div')
  container.appendChild(host)

  content = hc('div', 'editor-modal')
  hintEl = hc('div', 'editor-hint')

  // A native <select> renders its option list with the OS widget on iOS
  // WKWebView, where font-size / color / spacing on <option> are ignored.
  // Build a plain DOM dropdown instead so the helper names are real elements
  // whose typography and spacing we fully control with CSS.
  selectBox = hc('div', 'editor-select')
  selectTrigger = hc('div', 'editor-select-trigger')
  selectTrigger.textContent = 'Insert helper'
  selectTrigger.setAttribute('role', 'button')
  selectTrigger.setAttribute('tabindex', '0')
  selectMenu = hc('div', 'editor-select-menu')
  selectTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleSelectMenu()
  })
  selectTrigger.addEventListener('keydown', (e) => {
    if (
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp'
    ) {
      e.preventDefault()
      toggleSelectMenu()
    }
  })
  selectBox.appendChild(selectTrigger)
  selectBox.appendChild(selectMenu)

  textarea = hc('textarea', 'editor-textarea')
  textarea.setAttribute('spellcheck', 'false')
  textarea.setAttribute('autocapitalize', 'off')
  textarea.setAttribute('autocomplete', 'off')
  textarea.setAttribute('autocorrect', 'off')

  // A side-by-side row: the editor on the left, a recent-history list on the
  // right. Only the console drawer shows it; the storage editor keeps a plain
  // single column (openEditor toggles the panel via EDITOR_HISTORY_CLASS).
  const mainCol = hc('div', 'editor-main')
  mainCol.appendChild(hintEl)
  mainCol.appendChild(selectBox)
  mainCol.appendChild(textarea)

  historyPanel = hc('div', 'editor-history')
  const historyTitle = hc('div', 'editor-history-title')
  historyTitle.textContent = 'Recent'
  historyList = hc('div', 'editor-history-list')
  historyPanel.appendChild(historyTitle)
  historyPanel.appendChild(historyList)

  // Compact icon toolbar pinned to the top-right of the popup instead of a
  // full-width text footer. Icons come from eruda's own icon font (c() adds the
  // eruda- prefix that evalCss gives the icon.css selectors); a title attribute
  // keeps the action discoverable on hover / long-press.
  const makeIconBtn = (iconCls, title, onClick, primary) => {
    const btn = hc('button', 'editor-icon-btn')
    if (primary) btn.classList.add(c('editor-icon-btn-primary'))
    btn.type = 'button'
    btn.title = title
    btn.appendChild(hc('span', iconCls))
    btn.addEventListener('click', onClick)
    return btn
  }
  const cancelBtn = makeIconBtn('icon-clear', 'Cancel', () => hide(false, true))
  const formatBtn = makeIconBtn('icon-tool', 'Format', () => {
    textarea.value = formatCode(textarea.value)
    autoResizeTextarea()
    textarea.focus()
  })
  saveBtn = makeIconBtn('icon-play', 'Run', () => hide(true, false), true)

  const toolbar = hc('div', 'editor-toolbar')
  toolbar.appendChild(cancelBtn)
  toolbar.appendChild(formatBtn)
  toolbar.appendChild(saveBtn)
  content.appendChild(toolbar)

  const row = hc('div', 'editor-row')
  row.appendChild(mainCol)
  row.appendChild(historyPanel)
  content.appendChild(row)

  modal = new LunaModal(host, {
    title: '',
    content,
    width: window.innerWidth,
    showClose: false,
  })

  textarea.addEventListener('input', autoResizeTextarea)

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      insert('  ')
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      hide(true, false)
    }
  })

  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (selectOpen) {
        closeSelectMenu()
        return
      }
      hide(false, true)
    }
  })

  // Tapping outside the dropdown closes it (the modal content, footer, etc.).
  host.addEventListener('click', (e) => {
    if (selectOpen && !selectBox.contains(e.target)) closeSelectMenu()
  })
}

export function openEditor({
  container,
  title = '',
  value = '',
  placeholder = '',
  saveText = 'Save',
  hint = '',
  quickFns = [],
  format = 'json',
  drawer = false,
  // Pass a key (e.g. 'js') to show the recent-history sidebar and record saved
  // snippets under it. Omitted for the storage editor, which stays single-column.
  history = '',
  onSave: save,
  onCancel: cancel,
} = {}) {
  ensure(container)

  // The real `luna-modal` class is added by LunaModal's constructor; toggling
  // our prefixed drawer class on the same host turns it into a top drawer.
  host.classList.toggle(DRAWER_CLASS, drawer)
  historyKey = history || ''
  historyPanel.style.display = history ? '' : 'none'
  if (history) renderHistory()

  formatMode = format
  onSave = save || null
  onCancel = cancel || null
  textarea.value = value
  autoResizeTextarea()
  textarea.setAttribute('placeholder', placeholder)
  hintEl.textContent = hint
  hintEl.style.display = hint ? '' : 'none'
  // The save button is now icon-only; expose the caller's label via title.
  saveBtn.title = saveText

  selectMenu.textContent = ''
  quickFnList = []
  closeSelectMenu()
  if (quickFns.length) {
    each(quickFns, (fn) => {
      const opt = hc('div', 'editor-select-option')
      opt.textContent = fn.label
      opt.setAttribute('role', 'option')
      opt.setAttribute('tabindex', '0')
      opt.addEventListener('click', (e) => {
        e.stopPropagation()
        insertQuickFn(fn)
        closeSelectMenu()
      })
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          insertQuickFn(fn)
          closeSelectMenu()
        }
      })
      selectMenu.appendChild(opt)
      quickFnList.push(fn)
    })
  }
  selectBox.style.display = quickFns.length ? '' : 'none'

  modal.setOption('title', title)
  modal.setOption(
    'width',
    drawer ? window.innerWidth : Math.min(720, window.innerWidth - 32)
  )

  // Reset to the closed position every time. The host is shared between the
  // console drawer and the storage modal, so without this the drawer would
  // already be open after being shown once and no transition would fire.
  host.classList.remove(DRAWER_OPEN_CLASS)
  modal.show()

  if (drawer) {
    // Flush the closed transform to layout before adding the open class, so
    // WebKit on iOS actually animates the change instead of jumping straight
    // to the end state (keyframes in a shadow root were unreliable there).
    // Reading offsetHeight forces a style/layout recalculation.
    void host.offsetHeight
    // A second frame is more reliable than a single forced reflow in WKWebView.
    requestAnimationFrame(() => {
      // Guard against the editor being closed (or re-opened as a centred
      // modal) before this frame runs.
      if (host.classList.contains(DRAWER_CLASS)) {
        host.classList.add(DRAWER_OPEN_CLASS)
      }
    })
  }

  textarea.focus()
  const pos = textarea.value.length
  textarea.setSelectionRange(pos, pos)
}
