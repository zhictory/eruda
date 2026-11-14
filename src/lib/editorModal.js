import LunaModal from 'luna-modal'
import h from 'licia/h'
import each from 'licia/each'
import evalCss from './evalCss'
import { classPrefix as c } from './util'

// Marker is removed on insert and the caret is placed where it was.
const MARKER = '¦'

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
let selectEl = null
let quickFnList = []
let hintEl = null
let saveBtn = null
let onSave = null
let onCancel = null
let formatMode = 'json'

function hc(tag, ...classes) {
  return h(tag + classes.map((cls) => c('.' + cls)).join(''))
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

  host = h('div' + c('.editor-drawer'))
  container.appendChild(host)

  content = hc('div', 'editor-modal')
  hintEl = hc('div', 'editor-hint')
  selectEl = hc('select', 'editor-select')
  selectEl.addEventListener('change', () => {
    const fn = quickFnList[selectEl.value]
    if (fn) insertQuickFn(fn)
    selectEl.value = ''
  })
  textarea = hc('textarea', 'editor-textarea')
  textarea.setAttribute('spellcheck', 'false')
  textarea.setAttribute('autocapitalize', 'off')
  textarea.setAttribute('autocomplete', 'off')
  textarea.setAttribute('autocorrect', 'off')

  content.appendChild(hintEl)
  content.appendChild(selectEl)
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
    width: Math.min(720, window.innerWidth - 32),
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
      hide(false, true)
    }
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
  onSave: save,
  onCancel: cancel,
} = {}) {
  ensure(container)

  formatMode = format
  onSave = save || null
  onCancel = cancel || null
  textarea.value = value
  textarea.setAttribute('placeholder', placeholder)
  hintEl.textContent = hint
  hintEl.style.display = hint ? '' : 'none'
  saveBtn.textContent = saveText

  selectEl.textContent = ''
  quickFnList = []
  if (quickFns.length) {
    const placeholder = hc('option', 'editor-select-option')
    placeholder.value = ''
    placeholder.textContent = 'Insert helper…'
    placeholder.disabled = true
    placeholder.selected = true
    selectEl.appendChild(placeholder)
    each(quickFns, (fn, i) => {
      const opt = hc('option', 'editor-select-option')
      opt.value = String(i)
      opt.textContent = fn.label
      selectEl.appendChild(opt)
      quickFnList.push(fn)
    })
  }
  selectEl.style.display = quickFns.length ? '' : 'none'

  modal.setOption('title', title)
  modal.setOption('width', Math.min(720, window.innerWidth - 32))
  modal.show()

  textarea.focus()
  const pos = textarea.value.length
  textarea.setSelectionRange(pos, pos)
}
