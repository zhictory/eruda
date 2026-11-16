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

function insert(text) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const val = textarea.value
  textarea.value = val.slice(0, start) + text + val.slice(end)
  const pos = start + text.length
  textarea.focus()
  textarea.setSelectionRange(pos, pos)
}

function insertQuickFn(fn) {
  const at = fn.code.indexOf(MARKER)
  const clean = at === -1 ? fn.code : fn.code.replace(MARKER, '')
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const val = textarea.value
  textarea.value = val.slice(0, start) + clean + val.slice(end)
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
  selectTrigger.textContent = 'Insert helper…'
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

  content.appendChild(hintEl)
  content.appendChild(selectBox)
  content.appendChild(textarea)

  const cancelBtn = hc('button', 'editor-btn', 'editor-btn-cancel')
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', () => hide(false, true))

  const formatBtn = hc('button', 'editor-btn', 'editor-btn-format')
  formatBtn.type = 'button'
  formatBtn.textContent = 'Format'
  formatBtn.addEventListener('click', () => {
    textarea.value = formatCode(textarea.value)
    textarea.focus()
  })

  saveBtn = hc('button', 'editor-btn', 'editor-btn-primary')
  saveBtn.type = 'button'
  saveBtn.addEventListener('click', () => hide(true, false))

  const footer = hc('div', 'editor-footer')
  footer.appendChild(cancelBtn)
  footer.appendChild(formatBtn)
  footer.appendChild(saveBtn)

  modal = new LunaModal(host, {
    title: '',
    content,
    footer,
    width: window.innerWidth,
    showClose: false,
  })

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
  onSave: save,
  onCancel: cancel,
} = {}) {
  ensure(container)

  // The real `luna-modal` class is added by LunaModal's constructor; toggling
  // our prefixed drawer class on the same host turns it into a top drawer.
  host.classList.toggle(DRAWER_CLASS, drawer)

  formatMode = format
  onSave = save || null
  onCancel = cancel || null
  textarea.value = value
  textarea.setAttribute('placeholder', placeholder)
  hintEl.textContent = hint
  hintEl.style.display = hint ? '' : 'none'
  saveBtn.textContent = saveText

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
