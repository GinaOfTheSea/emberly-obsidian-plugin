import { Point } from "../pixi";

class PinchGesturePlugin {

  constructor(options) {
    this.viewport = options.viewport;
    this.listenerNode = options.listenerNode;

    this.onGestureStart = (event) => {
      this.initialScale = this.viewport.scale.x;
      const initialGlobalPosition = this.viewport.input.getPointerPosition(event);
      this.initialLocalPosition = this.viewport.toLocal(initialGlobalPosition);
    };
  
    this.onGestureEnd = () => {
      this.viewport.emit("zoomed", { viewport: this.viewport, type: "pinch" });
    };
  
    this.onGestureChange = (event) => {
      if (!this.initialLocalPosition) {
        throw new Error("Missing initial position");
      }
  
      const newScale = event.scale * this.initialScale;
      this.viewport.setZoom(newScale);
  
      const globalPosition = this.viewport.input.getPointerPosition(
        event
      );
      const localPosition = this.viewport.toLocal(globalPosition);
  
      const deltaX = localPosition.x - this.initialLocalPosition.x;
      const deltaY = localPosition.y - this.initialLocalPosition.y;
  
      this.moveRelative(deltaX, deltaY);
      this.viewport.emit("moved", { viewport: this.viewport, type: "pinch" });
    };


    this.listenerNode.addEventListener("gesturestart", this.onGestureStart);
    this.listenerNode.addEventListener("gesturechange", this.onGestureChange);
    this.listenerNode.addEventListener("gestureend", this.onGestureEnd);
    this.initialScale = this.viewport.scale.x;
  }

  down() {
    return false;
  }
  
  move() {
    return false;
  }

  up() {
    return false;
  }

  wheel() {
    return false;
  }

   update() {}
   reset() {}
   resize() {}
   pause() {}
   resume() {}

  destroy() {
    this.listenerNode.removeEventListener("gesturestart", this.onGestureStart);
    this.listenerNode.removeEventListener(
      "gesturechange",
      this.onGestureChange
    );
    this.listenerNode.removeEventListener("gestureend", this.onGestureEnd);
  }

  setListenerNode(node) {
    this.destroy();
    this.listenerNode = node;
    node.addEventListener("gesturestart", this.onGestureStart);
    node.addEventListener("gesturechange", this.onGestureChange);
    node.addEventListener("gestureend", this.onGestureEnd);
  }

  

  moveRelative(deltaX, deltaY) {
    this.viewport.moveCenter(
      new Point(
        this.viewport.center.x - deltaX,
        this.viewport.center.y - deltaY
      )
    );
  }
}

export default PinchGesturePlugin;
