import type { EmberlyMap } from "../shared/types";

export const BRANCH_LAYOUT_REQUIREMENT = "Branch layout requires exactly one category under the root.";

/** Count actual direct children, including collapsed/hidden categories. */
export function canUseBranchLayout(map: EmberlyMap): boolean {
  const roots = map.nodes.filter((node) => node.parentId === null);
  return !map.issues.length && roots.length === 1
    && map.nodes.filter((node) => node.parentId === roots[0]!.id).length === 1;
}

export function needsCenterLayout(map: EmberlyMap): boolean {
  return map.format === 2 && !map.issues.length && map.layout === "branch" && !canUseBranchLayout(map);
}
