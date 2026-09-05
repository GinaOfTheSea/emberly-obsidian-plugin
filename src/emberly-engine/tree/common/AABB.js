
export default class AABB {
  constructor(startX, startY, endX, endY) {
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
  }

  update(node) {
    const w05 = node.width / 2;
    const h05 = node.height / 2;
    this.startX = Math.min(this.startX, node.globalPositionX - w05);
    this.startY = Math.min(this.startY, node.globalPositionY - h05);
    this.endX = Math.max(this.endX, node.globalPositionX + w05);
    this.endY = Math.max(this.endY, node.globalPositionY + h05);
  }

  getMidPoint() {
    const x = this.startX + (this.endX - this.startX) / 2;
    const y = this.startY + (this.endY - this.startY) / 2;
    return { x, y };
  }

  getHeight() {
    return (this.endY - this.startY) * 1.02;
  }

  getWidth() {
    return (this.endX - this.startX) * 1.02;
  }
}