/*!
 * Event normalization adapted from @pixi/interaction 6.5, MIT License.
 * Copyright (c) 2013-2018 Mathew Groves, Chad Engler
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { InteractionManager } from "@pixi/interaction";

// Pixi 6 binds movement/release to globalThis. Keep its event names, capture
// options and normalization, but bind each renderer to its canvas's window.
export class WindowInteractionManager extends InteractionManager {
  addEvents() {
    if (this.eventsAdded || !this.interactionDOMElement) return;
    const element = this.interactionDOMElement;
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    this.supportsPointerEvents = Boolean(win.PointerEvent);
    this.supportsTouchEvents = "ontouchstart" in win;
    if (this.supportsPointerEvents) element.style.touchAction = "none";
    const bindings = this.supportsPointerEvents
      ? [[doc, "pointermove", this.onPointerMove], [element, "pointerdown", this.onPointerDown],
        [element, "pointerleave", this.onPointerOut], [element, "pointerover", this.onPointerOver],
        [win, "pointercancel", this.onPointerCancel], [win, "pointerup", this.onPointerUp]]
      : [[doc, "mousemove", this.onPointerMove], [element, "mousedown", this.onPointerDown],
        [element, "mouseout", this.onPointerOut], [element, "mouseover", this.onPointerOver],
        [win, "mouseup", this.onPointerUp]];
    if (this.supportsTouchEvents) bindings.push(
      [element, "touchstart", this.onPointerDown], [element, "touchcancel", this.onPointerCancel],
      [element, "touchend", this.onPointerUp], [element, "touchmove", this.onPointerMove]);
    this.windowBindings = bindings;
    for (const [target, event, listener] of bindings) target.addEventListener(event, listener, this._eventListenerOptions);
    this.eventsAdded = true;
  }

  removeEvents() {
    for (const [target, event, listener] of this.windowBindings || []) {
      target.removeEventListener(event, listener, this._eventListenerOptions);
    }
    this.windowBindings = [];
    if (this.interactionDOMElement && this.supportsPointerEvents) this.interactionDOMElement.style.touchAction = "";
    this.interactionDOMElement = null;
    this.eventsAdded = false;
  }

  // Adapted from @pixi/interaction 6.5 (MIT), with only realm checks changed.
    normalizeToPointerData(event) {
        const ownerWindow = this.interactionDOMElement.ownerDocument.defaultView;
        const normalizedEvents = [];
        if (this.supportsTouchEvents && event instanceof ownerWindow.TouchEvent) {
            for (let i = 0, li = event.changedTouches.length; i < li; i++) {
                const touch = event.changedTouches[i];
                if (typeof touch.button === 'undefined')
                    { touch.button = event.touches.length ? 1 : 0; }
                if (typeof touch.buttons === 'undefined')
                    { touch.buttons = event.touches.length ? 1 : 0; }
                if (typeof touch.isPrimary === 'undefined') {
                    touch.isPrimary = event.touches.length === 1 && event.type === 'touchstart';
                }
                if (typeof touch.width === 'undefined')
                    { touch.width = touch.radiusX || 1; }
                if (typeof touch.height === 'undefined')
                    { touch.height = touch.radiusY || 1; }
                if (typeof touch.tiltX === 'undefined')
                    { touch.tiltX = 0; }
                if (typeof touch.tiltY === 'undefined')
                    { touch.tiltY = 0; }
                if (typeof touch.pointerType === 'undefined')
                    { touch.pointerType = 'touch'; }
                if (typeof touch.pointerId === 'undefined')
                    { touch.pointerId = touch.identifier || 0; }
                if (typeof touch.pressure === 'undefined')
                    { touch.pressure = touch.force || 0.5; }
                if (typeof touch.twist === 'undefined')
                    { touch.twist = 0; }
                if (typeof touch.tangentialPressure === 'undefined')
                    { touch.tangentialPressure = 0; }
                // TODO: Remove these, as layerX/Y is not a standard, is deprecated, has uneven
                // support, and the fill ins are not quite the same
                // offsetX/Y might be okay, but is not the same as clientX/Y when the canvas's top
                // left is not 0,0 on the page
                if (typeof touch.layerX === 'undefined')
                    { touch.layerX = touch.offsetX = touch.clientX; }
                if (typeof touch.layerY === 'undefined')
                    { touch.layerY = touch.offsetY = touch.clientY; }
                // mark the touch as normalized, just so that we know we did it
                touch.isNormalized = true;
                normalizedEvents.push(touch);
            }
        }
        // apparently PointerEvent subclasses MouseEvent, so yay
        else if (!ownerWindow.MouseEvent
            || (event instanceof ownerWindow.MouseEvent && (!this.supportsPointerEvents || !(event instanceof ownerWindow.PointerEvent)))) {
            const tempEvent = event;
            if (typeof tempEvent.isPrimary === 'undefined')
                { tempEvent.isPrimary = true; }
            if (typeof tempEvent.width === 'undefined')
                { tempEvent.width = 1; }
            if (typeof tempEvent.height === 'undefined')
                { tempEvent.height = 1; }
            if (typeof tempEvent.tiltX === 'undefined')
                { tempEvent.tiltX = 0; }
            if (typeof tempEvent.tiltY === 'undefined')
                { tempEvent.tiltY = 0; }
            if (typeof tempEvent.pointerType === 'undefined')
                { tempEvent.pointerType = 'mouse'; }
            if (typeof tempEvent.pointerId === 'undefined')
                { tempEvent.pointerId = 1; }
            if (typeof tempEvent.pressure === 'undefined')
                { tempEvent.pressure = 0.5; }
            if (typeof tempEvent.twist === 'undefined')
                { tempEvent.twist = 0; }
            if (typeof tempEvent.tangentialPressure === 'undefined')
                { tempEvent.tangentialPressure = 0; }
            // mark the mouse event as normalized, just so that we know we did it
            tempEvent.isNormalized = true;
            normalizedEvents.push(tempEvent);
        }
        else {
            normalizedEvents.push(event);
        }
        return normalizedEvents;
    }
}
