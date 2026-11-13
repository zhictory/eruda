// Cascadia Code is used by the console/storage editor textareas.
// @font-face must live in document.head: a face declared inside a shadow root
// does not work, but a face in the outer document DOES apply to shadow-tree
// content (same trick eruda uses for ./style/icon.css). `local()` comes first so
// an installed font is used offline; the CDN woff2 is the fallback.
export default "@font-face{font-family:'Cascadia Code';font-style:normal;font-weight:400;font-display:swap;src:local('Cascadia Code'),local('CascadiaMono'),url(https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@5.3.0/files/cascadia-code-latin-400-normal.woff2) format('woff2')}"
