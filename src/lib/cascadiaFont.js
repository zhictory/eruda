// Font faces injected once into document.head. A @font-face declared inside a
// shadow root does not work, but one in the outer document applies to shadow
// content too (same trick eruda uses for ./style/icon.css).

// Cascadia Code: used for Latin/digits across the panel and in the editors.
// local() first so an installed font is used offline; CDN woff2 is fallback.
const cascadia = "@font-face{font-family:'Cascadia Code';font-style:normal;font-weight:400;font-display:swap;src:local('Cascadia Code'),local('CascadiaMono'),url(https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@5.3.0/files/cascadia-code-latin-400-normal.woff2) format('woff2')}"

export default cascadia
