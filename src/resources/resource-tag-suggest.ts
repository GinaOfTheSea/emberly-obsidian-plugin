import { AbstractInputSuggest, type App } from "obsidian";

export interface ResourceTagChoice {
  tag: string;
  select: () => void;
}

/** Native positioning/keyboard navigation, including outside scroll containers. */
export class ResourceTagSuggest extends AbstractInputSuggest<ResourceTagChoice> {
  constructor(app: App, input: HTMLInputElement, private readonly choices: (query: string) => ResourceTagChoice[]) {
    super(app, input);
    this.limit = 30;
  }

  protected getSuggestions(query: string): ResourceTagChoice[] { return this.choices(query); }

  renderSuggestion(choice: ResourceTagChoice, el: HTMLElement): void { el.setText(choice.tag); }

  selectSuggestion(choice: ResourceTagChoice, event: MouseEvent | KeyboardEvent): void {
    event.preventDefault(); event.stopPropagation();
    this.close();
    choice.select();
  }
}
