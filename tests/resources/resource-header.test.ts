// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceHeader } from "../../src/resources/resource-header";
import type { TFile } from "obsidian";
import { readResourceSettings, resourceProperties, type ResourceChange, type ResourceIdentity } from "../../src/resources/resource-properties";
import { ResourceFixture } from "../helpers/resource-fixture";
import { installObsidianDom } from "../helpers/obsidian-dom";

vi.mock("../../src/resources/resource-tag-suggest", () => ({ ResourceTagSuggest: class { close() {} } }));
vi.mock("obsidian", async (original) => ({ ...await original<object>(), Menu: class {} }));

let fixture: ResourceFixture;
let header: ResourceHeader;
beforeEach(async () => { installObsidianDom(); fixture = await ResourceFixture.create(); });
afterEach(async () => { header?.dispose(); document.body.replaceChildren(); await fixture.dispose(); });

it("keeps tag order, the toggle and input focus through refreshes, removal and addition", async () => {
  const file = fixture.index.file(fixture.index.resourceCatalog().resources[0]!.path)!;
  let properties = { ...fixture.index.propertiesFor(file), tags: ["gulls", "birds/coastal"] };
  const save = vi.fn(async (_file: TFile, _identity: ResourceIdentity, change: ResourceChange) => {
    properties = { ...properties, ...resourceProperties(properties, change) };
    return readResourceSettings(properties);
  });
  header = new ResourceHeader(document.body, fixture.app, fixture.index, save, vi.fn(), vi.fn(), vi.fn(), vi.fn());
  header.update(file, properties);
  const row = header.container.querySelector<HTMLElement>(".emberly-resource-header-tags")!;
  const toggle = row.querySelector<HTMLButtonElement>(":scope > button")!;
  const input = header.container.querySelector<HTMLInputElement>(".emberly-resource-tag-form input")!;
  const form = input.closest("form")!;
  const tags = () => Array.from(row.querySelectorAll(":scope > .emberly-resource-tag-chip > span")).map((tag) => tag.textContent);
  expect(tags()).toEqual(["gulls", "birds/coastal"]);
  expect(row.lastElementChild).toBe(toggle);

  toggle.focus();
  properties = { ...properties, tags: ["gulls", "birds/coastal", "field-notes"] };
  header.update(file, properties);
  expect(document.activeElement).toBe(toggle);
  expect(row.lastElementChild).toBe(toggle);
  toggle.click();
  expect(document.activeElement).toBe(input);
  expect(form.hidden).toBe(false);
  row.querySelector<HTMLButtonElement>('[aria-label="Remove tag gulls"]')!.click();
  await vi.waitFor(() => expect(tags()).toEqual(["birds/coastal", "field-notes"]));
  expect(document.activeElement).toBe(input);
  expect(row.lastElementChild).toBe(toggle);

  input.value = "seabirds";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(tags()).toEqual(["birds/coastal", "field-notes", "seabirds"]));
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
  toggle.click();
  expect(form.hidden).toBe(true);
  expect(row.querySelector('[aria-label^="Remove tag"]')).toBeNull();
  expect(row.lastElementChild).toBe(toggle);
});
