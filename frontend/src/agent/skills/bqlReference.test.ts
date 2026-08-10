import { describe, expect, it } from "vitest";
import {
  BQL_HELP_TOPICS,
  BQL_REFERENCE,
  BQL_REFERENCE_LICENSE,
  BQL_REFERENCE_SOURCE,
  getBqlReference,
} from "./bqlReference";

describe("BQL reference", () => {
  it("exposes every bounded progressive-disclosure topic", () => {
    expect(BQL_HELP_TOPICS).toEqual([
      "overview",
      "filters",
      "columns",
      "aggregations",
      "positions_and_inventories",
      "ordering_and_limits",
      "statements",
      "examples",
      "troubleshooting",
    ]);

    for (const topic of BQL_HELP_TOPICS) {
      const content = getBqlReference(topic);
      expect(content.length, topic).toBeGreaterThan(100);
      expect(content.length, topic).toBeLessThan(3_000);
      expect(content, topic).toBe(BQL_REFERENCE[topic]);
    }
  });

  it("documents entry-level FROM and posting-level WHERE semantics", () => {
    expect(BQL_REFERENCE.overview).toContain(
      "FROM 不是必填的 SQL 表名",
    );
    expect(BQL_REFERENCE.overview).toContain(
      "FROM <整条 entry/transaction 的过滤条件>",
    );
    expect(BQL_REFERENCE.overview).toContain(
      "WHERE <posting 的过滤条件>",
    );
  });

  it("attributes the upstream Beancount documentation", () => {
    expect(BQL_REFERENCE_SOURCE).toBe(
      "https://github.com/beancount/docs/blob/master/docs/beancount_query_language.md",
    );
    expect(BQL_REFERENCE_LICENSE).toBe("MIT");
  });
});
