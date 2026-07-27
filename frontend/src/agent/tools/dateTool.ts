/**
 * ``today`` tool: What's the current date?
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";


/**
 * Create a ``today`` tool.
 */
export function makeTodayTool(): AgentTool<{}> {
  return {
    name: "today",
    label: "今天的日期",
    description: "获取当前日期。",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal) => {
      const today = new Date().toISOString().split("T")[0];
      return {
        content: [{ type: "text" as const, text: today }],
        details: {},
      };
    },
  };
}
