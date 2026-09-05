import type { MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { IntegratedMapPane } from "../maps/integrated-map-pane";
import type { TopicNotePane } from "../topics/topic-note-pane";

/** Owns pane associations and guarantees that the newest navigation request wins. */
export class PaneCoordinator {
  readonly topicLeaves = new Map<WorkspaceLeaf, WorkspaceLeaf>();
  readonly topicPanes = new Map<WorkspaceLeaf, TopicNotePane>();
  readonly openInMapActions = new Map<MarkdownView, HTMLElement>();
  readonly integratedPanes = new Map<WorkspaceLeaf, IntegratedMapPane>();
  readonly integratedNativeOpens = new Map<WorkspaceLeaf, TFile>();
  readonly topicPaneFiles = new Map<WorkspaceLeaf, TFile | null>();
  readonly topicOpenRequests = new Map<WorkspaceLeaf, symbol>();
  private readonly topicOpenQueues = new Map<WorkspaceLeaf, Promise<void>>();

  async runLatest(mapLeaf: WorkspaceLeaf, action: (request: symbol) => Promise<void>, changed: () => void): Promise<void> {
    const request = Symbol();
    this.topicOpenRequests.set(mapLeaf, request);
    changed();
    const previous = this.topicOpenQueues.get(mapLeaf) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (this.topicOpenRequests.get(mapLeaf) === request) await action(request);
    });
    this.topicOpenQueues.set(mapLeaf, pending);
    try { await pending; } finally {
      if (this.topicOpenQueues.get(mapLeaf) === pending) this.topicOpenQueues.delete(mapLeaf);
      if (this.topicOpenRequests.get(mapLeaf) === request) this.topicOpenRequests.delete(mapLeaf);
      changed();
    }
  }

  dispose(): void {
    for (const pane of this.integratedPanes.values()) pane.dispose();
    this.integratedPanes.clear();
    this.integratedNativeOpens.clear();
    this.topicPaneFiles.clear();
    for (const pane of this.topicPanes.values()) pane.dispose();
    this.topicPanes.clear();
    for (const action of this.openInMapActions.values()) action.remove();
    this.openInMapActions.clear();
    this.topicLeaves.clear();
    this.topicOpenRequests.clear();
    this.topicOpenQueues.clear();
  }
}
