
export default class DynamicChar {

  constructor() {
    this.style = null;

    // char data
    this.data = null;

    // is this char space?
    this.space = false;

    this.emoji = false;

    this.paint = false;

    // charcode
    this.charcode = 0;

    // char string value
    this.value = "";

    // word index
    this.wordIndex = -1;

    // line index of char
    this.lineIndex = -1;
  }
}

