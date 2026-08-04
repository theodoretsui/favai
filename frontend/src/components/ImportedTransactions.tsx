import { CheckCircleOutlined } from "@ant-design/icons";
import { Card, Space, Table, Tag, Typography } from "antd";

import type { Transaction } from "@/api";
import { t } from "@/i18n";

export function ImportedTransactions({
  transactions,
  confirmedCount,
}: {
  transactions: Transaction[];
  confirmedCount: number | null;
}) {
  return (
    <Card
      size="small"
      title={
        <Space>
          <CheckCircleOutlined className="text-emerald-600" />
          <span>{t("imported.title")}</span>
          <Tag>
            {t("imported.count", {
              count: confirmedCount ?? transactions.length,
            })}
          </Tag>
        </Space>
      }
    >
      <div className="flex flex-col gap-3">
        {transactions.map((transaction, transactionIndex) => (
          <Card
            key={transactionIndex}
            size="small"
            title={
              <Space wrap>
                <Typography.Text type="secondary" className="font-mono text-xs">
                  {transaction.date}
                </Typography.Text>
                {transaction.payee && (
                  <Typography.Text strong>{transaction.payee}</Typography.Text>
                )}
                <Typography.Text>{transaction.narration}</Typography.Text>
              </Space>
            }
          >
            <Table
              size="small"
              pagination={false}
              rowKey={(_, index) => String(index)}
              dataSource={transaction.postings}
              columns={[
                {
                  title: t("proposal.account"),
                  dataIndex: "account",
                  className: "font-mono text-xs",
                },
                {
                  title: t("proposal.amount"),
                  dataIndex: "amount",
                  align: "right",
                  width: 130,
                  className: "font-mono text-xs",
                  render: (value: string) => value || "—",
                },
                {
                  title: t("proposal.currency"),
                  dataIndex: "currency",
                  width: 100,
                  className: "font-mono text-xs",
                  render: (value: string) => value || "—",
                },
              ]}
            />
          </Card>
        ))}
      </div>
    </Card>
  );
}
