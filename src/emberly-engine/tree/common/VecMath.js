

export default class VecMath {

  static Distance2F(x0, y0, x1, y1) {
    const dx = x0 - x1;
    const dy = y0 - y1;
    return dx * dx + dy * dy;
  }

  static ColorToSigned24Bit(s) {
    switch (s.length) {
      case 0:
      case 1: return 0x0;
      case 4: return VecMath.ColorToSigned24Bit(`#${s.substr(1).split("").map(t => t + t).join("")}`);
      case 7: return parseInt(s.substr(1), 16);
      default: return 0x0;
    }
  }

  static Signed24BitToColor(n) {
    if (n === null || n === undefined) return null;
    let c = (n & 0x00FFFFFF).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
  }

}
