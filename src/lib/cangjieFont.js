// 仓耳今楷01 W03 (TsangerJinKai01 W03) Chinese web font loader.
//
// The font is licensed, so it is shipped as a small self-hosted WOFF2 subset
// (GB2312 common hanzi + ASCII + punctuation, ~1.9MB) embedded as a base64 data
// URI. This keeps eruda a single-file drop-in: the font works on any page the
// script is loaded on, with no extra font file to serve beside it.
//
// Strategy:
//   1. A local() @font-face is declared first — if the user already installed
//      the font, the browser uses it and never decodes the embedded bytes.
//   2. A second @font-face with the base64 data URI is added as fallback.
//
// Both faces are injected by direct DOM manipulation, NOT through evalCss, so
// eruda's resetStyle() (which rewrites `px`, `_` and var(--x)) never touches the
// base64 payload.

import cangjieData from './cangjieData'

let loaded = false

export default function loadCangjieFont() {
  if (loaded || typeof document === 'undefined') return
  loaded = true

  const head = document.head || document.getElementsByTagName('head')[0]
  if (!head) return

  const face =
    "@font-face{font-family:'CangErJinKai01 W03';font-style:normal;font-weight:400;font-display:swap;" +
    "src:local('仓耳今楷01 W03'),local('TsangerJinKai01 W03'),local('仓耳今楷01'),local('CangErJinKai01 W03')," +
    'url(data:font/woff2;base64,' +
    cangjieData +
    ") format('woff2')}"

  const style = document.createElement('style')
  style.type = 'text/css'
  style.appendChild(document.createTextNode(face))
  head.appendChild(style)
}
