/**
 * Tool effect/risk metadata, owned by the application (not the model).
 *
 * Every agent tool is classified into a risk policy. Only ``write`` and
 * ``destructive`` tools require explicit user approval before ``execute``;
 * ``read`` and ``propose`` tools run without any prompt. ``destructive`` is
 * reserved for future irreversible operations: it must never be weakened to
 * bypass the approval gate, and may later add stronger confirmation.
 */

export type ToolRiskPolicy = "read" | "propose" | "write" | "destructive";

export interface ToolRisk {
  policy: ToolRiskPolicy;
  /** Optional i18n key describing the expected effects, shown pre-approval. */
  effectKey?: string;
}

export type ToolRiskRegistry = Record<string, ToolRisk>;

/** Risk classification for the tools the application registers today. */
export const DEFAULT_TOOL_RISK: ToolRiskRegistry = {
  today: { policy: "read" },
  bql_help: { policy: "read" },
  bql_query: { policy: "read" },
  propose_transactions: { policy: "propose" },
  propose_directives: { policy: "propose" },
  create_ledger_file: { policy: "write", effectKey: "approval.effect.create_file" },
};

/**
 * Unknown tools fail closed: anything without explicit metadata is treated
 * as a gated write so newly added tools can never silently skip approval.
 */
const UNKNOWN_TOOL_RISK: ToolRisk = { policy: "write" };

export function resolveToolRisk(
  toolName: string,
  registry: ToolRiskRegistry = DEFAULT_TOOL_RISK,
): ToolRisk {
  return registry[toolName] ?? UNKNOWN_TOOL_RISK;
}

/** Whether a policy requires explicit user approval before execution. */
export function requiresApproval(policy: ToolRiskPolicy): boolean {
  return policy === "write" || policy === "destructive";
}
