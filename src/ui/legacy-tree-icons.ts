import { setIcon } from "obsidian";

/*! @license MUI ExpandLess/ExpandMore icons — MIT
Copyright (c) 2014 Call-Em-All

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Exact geometry from legacy emberly-application/src/components/atoms/icons/
// NewChildIcon.jsx and NewSiblingIcon.jsx. Only iconColor becomes currentColor.
// Collapse/expand are the MUI ExpandLess/ExpandMore used by DesktopMapOverlay.
// Their MIT license is included in THIRD_PARTY_NOTICES.md.
const legacyIcons = {
  "emberly-map-settings": [["path", { d: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" }]],
  "emberly-new-child": [
    ["path", { d: "M17 8L17 12L17 16M13 12L21 12", stroke: "currentColor", "stroke-width": "2" }],
    ["path", { d: "M6 12L11 12", stroke: "currentColor", "stroke-width": "2" }],
    ["circle", { cx: "5", cy: "12", r: "2" }],
  ],
  "emberly-new-sibling": [
    ["path", { d: "M17 13L17 17L17 21M13 17L21 17", stroke: "currentColor", "stroke-width": "2" }],
    ["path", { d: "M3 7L7 7L7 5L3 5L3 7ZM7 7L16 7L16 5L7 5L7 7ZM6 6L6 12.5L8 12.5L8 6L6 6ZM6 12.5C6 13.8574 6.26723 15.2375 7.08238 16.2972C7.93438 17.4048 9.2571 18 11 18L11 16C9.7429 16 9.06562 15.5952 8.66762 15.0778C8.23277 14.5125 8 13.6426 8 12.5L6 12.5Z" }],
    ["circle", { cx: "17", cy: "6", r: "2" }],
  ],
  "emberly-collapse": [["path", { d: "m12 8-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" }]],
  "emberly-expand": [["path", { d: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z" }]],
} satisfies Record<string, [string, Record<string, string>][] >;

/** Render trusted, bundled source geometry without React/MUI or global icon state. */
export function setMapIcon(element: HTMLElement, name: string): void {
  if (!Object.hasOwn(legacyIcons, name)) { setIcon(element, name); return; }
  const ns = "http://www.w3.org/2000/svg";
  const svg = element.ownerDocument.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "24", height: "24", fill: "currentColor", stroke: "none",
    class: "svg-icon emberly-legacy-tree-icon", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(key, value);
  for (const [tag, attributes] of legacyIcons[name as keyof typeof legacyIcons]) {
    const shape = element.ownerDocument.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.appendChild(shape);
  }
  element.replaceChildren(svg);
}
