import {
  DeleteOutlined,
  PlusOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button, Card, Form, Input, Space, Table, Tag } from "antd";

import type { Posting, Transaction } from "@/api";
import { AccountCombobox } from "@/components/AccountCombobox";
import { t } from "@/i18n";

export function ProposalTable({
  transactions,
  accounts,
  onChange,
}: {
  transactions: Transaction[];
  accounts: string[];
  onChange: (next: Transaction[]) => void;
}) {
  function updateTransaction(index: number, patch: Partial<Transaction>) {
    onChange(
      transactions.map((transaction, itemIndex) =>
        itemIndex === index ? { ...transaction, ...patch } : transaction,
      ),
    );
  }

  function updatePosting(
    transactionIndex: number,
    postingIndex: number,
    patch: Partial<Posting>,
  ) {
    const transaction = transactions[transactionIndex];
    updateTransaction(transactionIndex, {
      postings: transaction.postings.map((posting, itemIndex) =>
        itemIndex === postingIndex ? { ...posting, ...patch } : posting,
      ),
    });
  }

  function updateUnits(
    transactionIndex: number,
    postingIndex: number,
    field: "number" | "currency",
    value: string,
  ) {
    const posting = transactions[transactionIndex].postings[postingIndex];
    updatePosting(transactionIndex, postingIndex, {
      units: {
        number: posting.units?.number ?? "",
        currency: posting.units?.currency ?? "",
        [field]: value,
      },
    });
  }

  function addPosting(transactionIndex: number) {
    const transaction = transactions[transactionIndex];
    updateTransaction(transactionIndex, {
      postings: [...transaction.postings, { account: "" }],
    });
  }

  function removePosting(transactionIndex: number, postingIndex: number) {
    const transaction = transactions[transactionIndex];
    updateTransaction(transactionIndex, {
      postings: transaction.postings.filter(
        (_, index) => index !== postingIndex,
      ),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {transactions.map((transaction, transactionIndex) => {
        const incomplete = transaction.flag === "incomplete";
        return (
          <Card
            key={transactionIndex}
            size="small"
            className={incomplete ? "favai-proposal-incomplete" : undefined}
            extra={
              <Space size={4}>
                {incomplete && (
                  <Tag color="warning" icon={<WarningOutlined />}>
                    {t("proposal.flag.incomplete")}
                  </Tag>
                )}
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  title={t("proposal.transaction.remove")}
                  onClick={() =>
                    onChange(
                      transactions.filter(
                        (_, index) => index !== transactionIndex,
                      ),
                    )
                  }
                />
              </Space>
            }
          >
            <div className="grid grid-cols-1 gap-x-2 md:grid-cols-12">
              <Form.Item className="md:col-span-3" label={t("proposal.date")}>
                <Input
                  type="date"
                  value={transaction.date}
                  onChange={(event) =>
                    updateTransaction(transactionIndex, {
                      date: event.target.value,
                    })
                  }
                />
              </Form.Item>
              <Form.Item className="md:col-span-3" label={t("proposal.payee")}>
                <Input
                  value={transaction.payee ?? ""}
                  onChange={(event) =>
                    updateTransaction(transactionIndex, {
                      payee: event.target.value,
                    })
                  }
                />
              </Form.Item>
              <Form.Item
                className="md:col-span-3"
                label={t("proposal.narration")}
              >
                <Input
                  value={transaction.narration}
                  onChange={(event) =>
                    updateTransaction(transactionIndex, {
                      narration: event.target.value,
                    })
                  }
                />
              </Form.Item>
              <Form.Item className="md:col-span-3" label={t("proposal.tags")}>
                <Input
                  key={(transaction.tags ?? []).join(",")}
                  defaultValue={(transaction.tags ?? [])
                    .map((tag) => `#${tag}`)
                    .join(" ")}
                  placeholder={t("proposal.tags.placeholder")}
                  onBlur={(event) =>
                    updateTransaction(transactionIndex, {
                      tags: event.target.value
                        .split(/[,\s]+/)
                        .map((tag) => tag.trim().replace(/^#/, ""))
                        .filter(Boolean),
                    })
                  }
                />
              </Form.Item>
            </div>

            <Table<Posting>
              size="small"
              pagination={false}
              rowKey={(_, postingIndex) => String(postingIndex)}
              dataSource={transaction.postings}
              scroll={{ x: 560 }}
              columns={[
                {
                  title: t("proposal.account"),
                  dataIndex: "account",
                  render: (_, posting, postingIndex) => (
                    <AccountCombobox
                      value={posting.account}
                      accounts={accounts}
                      onChange={(account) =>
                        updatePosting(transactionIndex, postingIndex, {
                          account,
                        })
                      }
                    />
                  ),
                },
                {
                  title: t("proposal.amount"),
                  width: 130,
                  render: (_, posting, postingIndex) => (
                    <Input
                      value={posting.units?.number ?? ""}
                      onChange={(event) =>
                        updateUnits(
                          transactionIndex,
                          postingIndex,
                          "number",
                          event.target.value,
                        )
                      }
                    />
                  ),
                },
                {
                  title: t("proposal.currency"),
                  width: 110,
                  render: (_, posting, postingIndex) => (
                    <Input
                      value={posting.units?.currency ?? ""}
                      onChange={(event) =>
                        updateUnits(
                          transactionIndex,
                          postingIndex,
                          "currency",
                          event.target.value,
                        )
                      }
                    />
                  ),
                },
                {
                  key: "actions",
                  width: 44,
                  render: (_, _posting, postingIndex) => (
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      title={t("proposal.posting.remove")}
                      onClick={() =>
                        removePosting(transactionIndex, postingIndex)
                      }
                    />
                  ),
                },
              ]}
            />
            <Space className="mt-3">
              <Button
                icon={<PlusOutlined />}
                onClick={() => addPosting(transactionIndex)}
              >
                {t("proposal.posting.add")}
              </Button>
            </Space>
          </Card>
        );
      })}
    </div>
  );
}
