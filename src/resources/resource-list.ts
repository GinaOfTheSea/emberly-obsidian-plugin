/** Resource presentation types; membership comes from resource-catalog.ts. */
export interface TopicResource {
  id: string;
  path: string;
  title: string;
  kind: string;
  url: string;
  asset: string;
  tags: string[];
  thumbnail?: string;
}

export interface TopicResources {
  resources: TopicResource[];
  issues: string[];
}
