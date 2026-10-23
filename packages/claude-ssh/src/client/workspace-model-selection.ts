import { t } from "./i18n.js";
import { isClaudeProvider, type WorkspaceEligibilityGate } from "./workspace-eligibility.js";
import type { WorkspaceModel, WorkspaceModelSelection } from "./workspace-model-types.js";

type Catalog = readonly { id: string; models: readonly Pick<WorkspaceModel, "id" | "reasoning">[] }[];

/** Check again at the commit boundary, including a lock acquired while verification was pending. */
export async function selectWorkspaceModel(
  selection: WorkspaceModelSelection,
  options: {
    gate: WorkspaceEligibilityGate;
    canSelect(): boolean;
    catalog(): Catalog;
    select(selection: WorkspaceModelSelection): Promise<unknown>;
  },
): Promise<boolean> {
  if (!options.canSelect()) return false;
  const verified = isClaudeProvider(selection.provider) ? await options.gate.refresh() : undefined;
  if (!options.canSelect() || (verified && options.gate.getSnapshot() !== verified)) return false;
  if (isClaudeProvider(selection.provider) &&
      (!verified?.eligible || !verified.providerIds.includes(selection.provider))) {
    throw new Error(verified?.reason ?? t("workspaceModels.unavailable"));
  }
  const model = options.catalog().find((group) => group.id === selection.provider)?.models
    .find((model) => model.id === selection.model);
  if (!model) throw new Error(t("workspaceModels.modelGone"));
  if (selection.reasoningEffort && !model.reasoning?.efforts.some((effort) => effort.id === selection.reasoningEffort)) {
    throw new Error(t("workspaceModels.effortGone"));
  }
  const result = await options.select(selection);
  return !(result && typeof result === "object" && "ok" in result && result.ok === false);
}
