export interface WorkspaceModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface WorkspaceModel {
  id: string;
  name: string;
  description?: string;
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string };
}
export interface WorkspaceModelGroup {
  id: string;
  name: string;
  models: readonly WorkspaceModel[];
}
