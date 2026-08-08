/** ``bql_help`` tool: load one focused section of the local BQL reference. */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  BQL_HELP_TOPICS,
  BQL_REFERENCE_LICENSE,
  BQL_REFERENCE_SOURCE,
  getBqlReference,
  type BqlHelpTopic,
} from "@/agent/skills/bqlReference";

const BqlHelpParams = Type.Object({
  topic: Type.Union(
    [
      Type.Literal("overview"),
      Type.Literal("filters"),
      Type.Literal("columns"),
      Type.Literal("aggregations"),
      Type.Literal("positions_and_inventories"),
      Type.Literal("ordering_and_limits"),
      Type.Literal("statements"),
      Type.Literal("examples"),
      Type.Literal("troubleshooting"),
    ],
    {
      description:
        "需要加载的 BQL 参考主题。只选择当前查询所需的最小主题。",
    },
  ),
});

/** Create the progressively disclosed BQL reference tool. */
export function makeBqlHelpTool(): AgentTool<typeof BqlHelpParams> {
  return {
    name: "bql_help",
    label: "查看 BQL 参考",
    description:
      "按主题加载一小段本地 BQL 参考。语法不确定、查询失败或需要 position/inventory 口径时先调用；不要一次加载无关主题。",
    parameters: BqlHelpParams,
    execute: async (_toolCallId, params, _signal) => {
      const topic = params.topic as BqlHelpTopic;
      if (!BQL_HELP_TOPICS.includes(topic)) {
        throw new Error(`未知 BQL 参考主题：${String(params.topic)}`);
      }
      const reference = getBqlReference(topic);
      return {
        content: [
          {
            type: "text" as const,
            text: `${reference}\n\n参考来源：${BQL_REFERENCE_SOURCE}\n来源许可：${BQL_REFERENCE_LICENSE}`,
          },
        ],
        details: {
          topic,
          source: BQL_REFERENCE_SOURCE,
          license: BQL_REFERENCE_LICENSE,
        },
      };
    },
  };
}
