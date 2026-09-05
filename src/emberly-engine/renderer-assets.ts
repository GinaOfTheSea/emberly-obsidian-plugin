export const DEFAULT_AVATAR_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#48add3"/>
    <circle cx="256" cy="193" r="81" fill="#e7f1f5"/>
    <path d="M110 420c0-50 41-91 91-91h110c50 0 91 41 91 91-41 38-92 57-146 57s-105-19-146-57Z" fill="#e7f1f5"/>
  </svg>
`)}`;

const fontLoads = new WeakMap<Document, Promise<void>>();

export function loadEmberlyFonts(doc: Document = document): Promise<void> {
  let fontLoad = fontLoads.get(doc);
  if (fontLoad) return fontLoad;
  fontLoad = Promise.all([
    doc.fonts.load('400 48px "IBM Plex Sans"'),
    doc.fonts.load('600 80px "IBM Plex Sans"'),
  ]).then(() => undefined);
  fontLoads.set(doc, fontLoad);
  return fontLoad;
}
