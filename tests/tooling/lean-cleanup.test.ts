import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { createHash } from "node:crypto";
import { planLeanCleanup, removeProperties } from "../../scripts/dev/lean-cleanup";

const document = (path: string, properties: Record<string, unknown>, body = "# Independent heading\n\n[[Keep this]]\n") => ({ path, content: `---\n${stringify(properties)}---\n${body}` });
const documents = () => [
  document("Map/Map.md", { emberly: "map", "emberly-format": 2, "emberly-id": "map", "emberly-root-id": "root", "emberly-layout": "center", title: "Old map name" },
    "<!-- emberly-outline:start -->\n- [Old](<root.md>) ^emberly-topic-root\n  - [Old](<Topic.md>) ^emberly-topic-topic\n<!-- emberly-outline:end -->\n"),
  document("Map/Topic.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map", "emberly-parent": "root", "emberly-order": "a0", title: "Override", "emberly-color": -1,
    "emberly-collapsed": false, "emberly-rating": 0, "emberly-state": 0, "emberly-side": "right", created: "1999-01-01", modified: "2000-02-02", custom: { nested: true } }),
  document("Map/Resources/Manual.pdf.md", { emberly: "resource", "emberly-format": 2, "emberly-id": "resource", "emberly-map": "map", "emberly-topic": "topic", "emberly-kind": "file", "emberly-asset": "Assets/file.pdf", "emberly-order": 1, title: "Another title", tags: ["keep"] }),
];
const body = (content: string) => content.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
const props = (content: string) => parse(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/.exec(content)![1]!);

describe("explicit test-vault cleanup", () => {
  it("removes only approved keys, preserving bodies, dates, IDs, ownership and custom properties", () => {
    const input = documents(), plan = planLeanCleanup(input);
    expect(plan.skipped).toEqual([]); expect(plan.changes).toHaveLength(3);
    for (const change of plan.changes) {
      const expected = props(change.before);
      for (const key of change.removed) delete expected[key];
      expect(props(change.after)).toEqual(expected);
      expect(body(change.after)).toBe(body(change.before));
    }
    const topic = plan.changes.find((change) => change.path === "Map/Topic.md")!;
    expect(props(topic.after)).toMatchObject({ created: "1999-01-01", modified: "2000-02-02", "emberly-id": "topic", "emberly-map": "map", custom: { nested: true } });
    expect(planLeanCleanup(input.map((file) => ({ ...file, content: plan.changes.find((change) => change.path === file.path)!.after }))).changes).toEqual([]);
  });
  it("preserves BOM, CRLF, comments and exact retained property formatting", () => {
    const before = '\uFEFF---\r\nemberly: topic\r\n# keep this comment\r\ncreated: "1999-01-01"\r\ntitle: old\r\ncustom: [1, 2]\r\nemberly-rating: 0\r\nmodified: 2000-01-01T00:00:00.000Z\r\n---\r\n\r\n# Keep body\r\n';
    const after = removeProperties(before, ["title", "emberly-rating"]);
    expect(after).toBe(before.replace("title: old\r\n", "").replace("emberly-rating: 0\r\n", ""));
  });
  it("removes a multiline title without touching the next property or body", () => {
    const before = "---\nemberly: topic\ntitle: |\n  First\n  Second\ncustom: keep\n---\nBody\n";
    expect(removeProperties(before, ["title"])).toBe("---\nemberly: topic\ncustom: keep\n---\nBody\n");
  });
  it("preserves mixed body/header line endings without changing offsets", () => {
    const before = "---\nemberly: topic\ntitle: old\ncustom: keep\n---\n# Notes\r\nKeep exactly.\r\n";
    expect(removeProperties(before, ["title"])).toBe(before.replace("title: old\n", ""));
  });
  it("preserves non-default settings, including all nonzero state bits", () => {
    const input = documents();
    const fm = props(input[1]!.content);
    Object.assign(fm, { "emberly-side": "left", "emberly-color": 0, "emberly-collapsed": true, "emberly-rating": 3, "emberly-state": 12 });
    input[1] = document("Map/Topic.md", fm);
    expect(planLeanCleanup(input).changes.find((change) => change.path === "Map/Topic.md")!.removed).toEqual(["title"]);
  });
  it("ignores ordinary notes and attachment contents, including Markdown with Emberly-looking YAML", () => {
    const ordinary = document("Notes/Keep.md", { title: "Keep", created: "yesterday" });
    const asset = document("Map/Assets/upload.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "topic", "emberly-map": "map", title: "Keep" });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const before = [hash(ordinary.content), hash(asset.content)];
    const plan = planLeanCleanup([...documents(), ordinary, asset]);
    expect(plan.changes.some((change) => change.path === ordinary.path || change.path === asset.path)).toBe(false);
    expect(plan.skipped).toEqual([]);
    expect([hash(ordinary.content), hash(asset.content)]).toEqual(before);
  });
  it("skips ambiguous IDs, unsupported notes and invalid ownership without guessing", () => {
    const input = documents();
    input.push(document("Map/Orphan.md", { emberly: "topic", "emberly-format": 2, "emberly-id": "orphan", "emberly-map": "absent", title: "Keep" }));
    input.push(document("Map/Old resource.md", { emberly: "resource", "emberly-format": 1, "emberly-id": "old", "emberly-map": "map", title: "Keep" }));
    input.push(document("Map/Bad owner.md", { emberly: "resource", "emberly-format": 2, "emberly-id": "bad", "emberly-map": "map", "emberly-topic": "missing", "emberly-order": 1, title: "Keep" }));
    expect(planLeanCleanup(input).skipped.map((skip) => skip.path)).toEqual(["Map/Orphan.md", "Map/Old resource.md", "Map/Bad owner.md"]);
    input.push({ ...input[1]!, path: "Map/Duplicate.md" });
    const ambiguous = planLeanCleanup(input);
    expect(ambiguous.changes).toEqual([]);
    expect(ambiguous.skipped).toHaveLength(input.length);
  });
  it("rejects duplicate YAML keys and shared anchors that would change retained values", () => {
    expect(() => removeProperties("---\ntitle: x\ntitle: y\ncustom: true\n---\n", ["title"])).toThrow("Invalid");
    expect(() => removeProperties("---\ntitle: &shared old\ncustom: *shared\n---\n", ["title"])).toThrow();
  });
});
