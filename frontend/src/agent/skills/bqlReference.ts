/**
 * Curated, progressively disclosed BQL reference for the browser agent.
 *
 * Keep each topic small enough to load independently. The content is based on
 * the upstream Beancount Query Language documentation and checked against the
 * Beanquery version installed by this project.
 */

export const BQL_REFERENCE_SOURCE =
  "https://github.com/beancount/docs/blob/master/docs/beancount_query_language.md";
export const BQL_REFERENCE_LICENSE = "MIT";

export const BQL_REFERENCE = {
  overview: `# BQL 概览

BQL 在 Beancount 账本上查询交易及其 postings。常用形式是：

SELECT <目标列或表达式>
FROM <整条 entry/transaction 的过滤条件>
WHERE <posting 的过滤条件>
GROUP BY <分组列>
ORDER BY <排序列>
LIMIT <行数>

关键区别：普通账本查询中的 FROM 不是必填的 SQL 表名，而是先筛选完整 entry/transaction；WHERE 再筛选其中的 posting。两者都可省略。

示例：
SELECT date, payee, account, position
FROM year = 2026
WHERE account ~ '^Expenses:'
ORDER BY date;

BQL 只类似 SQL，不要假设它支持任意 SQL 语法。没有 HAVING；需要对聚合结果二次筛选时，改写查询或在取得结果后分析。`,

  filters: `# FROM 与 WHERE 过滤

- FROM 对完整 entry/transaction 求值。交易通过后，其 postings 才进入下一阶段。
- WHERE 对单条 posting 求值，也能读取父交易的 date、payee、narration、tags 等列。
- 日期字面量不加引号：date >= 2026-01-01。
- 字符串使用单引号：payee = 'Acme'。
- 正则搜索使用 ~：account ~ '^Expenses:Food(:|$)'。
- 常用运算符：=、!=、<、<=、>、>=、AND、OR、NOT、IN、~。
- 标签和链接是字符串集合：'trip' IN tags。

选择某年内带 trip 标签的完整交易，再只看支出 postings：
SELECT date, payee, narration, account, position
FROM year = 2026 AND 'trip' IN tags
WHERE account ~ '^Expenses:'
ORDER BY date;

如果希望保留一笔匹配交易的所有 postings，把条件放在 FROM；如果只希望返回匹配的 postings，把条件放在 WHERE。`,

  columns: `# 常用列与表达式

Posting 查询常用列：
- date、year、month、day
- flag、payee、narration、tags、links、id
- account、position
- balance：在当前结果顺序上的累计 inventory

FROM 过滤主要使用 entry/transaction 层字段，例如 date、year、flag、payee、narration、tags、links、id、type。

SELECT * 会返回运行时选择的一组默认列，但正式分析最好显式列出目标，避免结果过大或含义不清。

可以使用 AS 命名表达式：
SELECT account, units(sum(position)) AS units_balance
WHERE account ~ '^Assets:'
GROUP BY account;

字段和函数以当前 Fava/Beanquery 运行时为准。遇到 unknown column/function 错误时，不要发明字段；先缩小到上面的稳定列或查看 troubleshooting。`,

  aggregations: `# 聚合与分组

常用聚合函数：count(...)、first(...)、last(...)、min(...)、max(...)、sum(...)。

只要 SELECT 目标中包含聚合函数，查询就是聚合查询。每个非聚合目标都应出现在 GROUP BY 中：

SELECT account, units(sum(position)) AS balance
WHERE account ~ '^Expenses:'
GROUP BY account
ORDER BY account;

GROUP BY 可以引用列、别名或 SELECT 位置：GROUP BY account 或 GROUP BY 1。

sum(position) 返回 Inventory，不是普通数字。通常再用 units(...)、cost(...) 等函数转换。多币种 inventory 可能包含多行/多项，不能把不同币种直接相加。

BQL 没有 HAVING。不要在 WHERE 中引用 sum(...) 等聚合结果。需要聚合后筛选时，先取得聚合结果，再由 agent 在结果上筛选和解释。`,

  positions_and_inventories: `# Position、Inventory 与金额口径

- position 表示一条 posting 的单位、commodity 以及可能的 cost lot。
- sum(position) 把多条 position 聚合为 Inventory。
- units(position|inventory) 只取持有单位。
- cost(position|inventory) 按成本基础转换。
- value(position|inventory) 依赖价格数据，表示估值口径；使用前要说明价格日期和缺失价格风险。
- balance 是按当前筛选及排序累计得到的 Inventory。

账户单位余额与成本余额：
SELECT account,
       units(sum(position)) AS units_balance,
       cost(sum(position)) AS cost_balance
WHERE account ~ '^Assets:'
GROUP BY account
ORDER BY account;

当前项目的 Beanquery 运行时不提供 weight(...) 查询函数。不要把 units、cost、value 混为同一口径。回答中应说明采用哪个口径，并保留结果中的币种/commodity。`,

  ordering_and_limits: `# 去重、排序与限制

- SELECT DISTINCT ... 对最终结果行去重。
- ORDER BY 支持列、别名或 SELECT 位置，以及 ASC/DESC。
- LIMIT 限制最终返回行数。
- 没有 ORDER BY 时，普通 posting 查询通常跟随交易日期及 posting 顺序；不要依赖它做“最大/最小”判断。

最近 20 条支出 posting：
SELECT date, payee, narration, account, units(position) AS amount
WHERE account ~ '^Expenses:'
ORDER BY date DESC
LIMIT 20;

金额排序涉及 Amount/Inventory 类型和多币种语义。若排序失败或结果混合币种，先按 currency/commodity 或账户范围缩小查询。工具自身最多向模型返回有限行数；看到结果标明已截断（details.truncated=true）时应追加更严格的 WHERE、ORDER BY 或 LIMIT。`,

  statements: `# 可用的只读语句

首选 SELECT，因为目标列和口径最明确。

Beanquery 还提供只读快捷语句：
- BALANCES [AT <units|cost|value>] [FROM ...] [WHERE ...]
- JOURNAL '<account-regexp>' [AT <units|cost|value>] [FROM ...]
- PRINT [FROM ...]：返回匹配 entry 的 Beancount 文本

示例：
BALANCES AT cost WHERE account ~ '^Assets:';
JOURNAL '^Assets:Bank(:|$)' FROM year = 2026;
PRINT FROM year = 2026 AND 'trip' IN tags;

JOURNAL 的账户正则必须是字符串，例如 JOURNAL '^Assets:'，不能写成 JOURNAL Assets。

这些语句只改变查询输出，不写入账本。不要使用 CREATE TABLE、INSERT 或其他通用数据库语句；favai 的 BQL 能力只用于读取账本。`,

  examples: `# 常用查询示例

按账户汇总支出：
SELECT account, units(sum(position)) AS amount
FROM year = 2026
WHERE account ~ '^Expenses:'
GROUP BY account
ORDER BY account;

按月和账户汇总：
SELECT month, account, units(sum(position)) AS amount
FROM year = 2026
WHERE account ~ '^Expenses:'
GROUP BY month, account
ORDER BY month, account;

查询某收款方的交易：
SELECT date, payee, narration, account, position
FROM payee ~ '星巴克|Starbucks'
ORDER BY date DESC;

账户流水及累计余额：
SELECT date, payee, narration, position, balance
WHERE account = 'Assets:Bank:Checking'
ORDER BY date;

查询带标签的完整交易：
SELECT date, payee, narration, account, position
FROM 'reimbursable' IN tags
ORDER BY date;

先运行最小查询确认列和口径，再逐步增加过滤、聚合和排序。`,

  troubleshooting: `# 查询排错

1. Parse error：检查引号、逗号、括号和子句顺序。日期写成 2026-01-01，字符串写成 'text'。
2. Unknown column/function：不要套用普通 SQL 字段；改用 date、payee、narration、account、position、tags 等稳定列。
3. 聚合错误：确保所有非聚合目标都在 GROUP BY；不要在 WHERE 中使用聚合函数。
4. 类型错误：position/Inventory 先使用 units(...)、cost(...) 或 value(...) 转换；当前运行时不支持 weight(...)；保留币种。
5. 结果重复：BQL 一行通常对应一条 posting，不是一整笔 transaction。需要交易级筛选时使用 FROM，必要时用 DISTINCT id。
6. 结果为空：先移除部分过滤，确认账户正则、日期范围、标签及 payee 是否实际存在。
7. 结果过多或标明已截断（details.truncated=true）：添加 WHERE、ORDER BY、LIMIT，或按日期/账户拆分查询。
8. JOURNAL parse error：账户表达式必须加引号，例如 JOURNAL '^Assets:'。

查询失败后应根据错误修改并重试 bql_query，不要把失败查询当成没有数据。`,
} as const;

export type BqlHelpTopic = keyof typeof BQL_REFERENCE;

export const BQL_HELP_TOPICS = Object.keys(BQL_REFERENCE) as BqlHelpTopic[];

export function getBqlReference(topic: BqlHelpTopic): string {
  return BQL_REFERENCE[topic];
}
