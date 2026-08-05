import {
  DeleteOutlined,
  PlusOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button, Card, Form, Input, Space, Table, Tag } from "antd";

import type { Posting, Transaction } from "@/api";
import { t } from "@/i18n";
import { AccountCombobox } from "@/components/AccountCombobox";

export function ProposalTable({
  transactions,
  accounts,
  onChange,
}: {
  transactions: Transaction[];
  accounts: string[];
  onChange: (next: Transaction[]) => void;
}) {
  function updateTxn(index: number, patch: Partial<Transaction>) {
    onChange(
      transactions.map((txn, itemIndex) =>
        itemIndex === index ? { ...txn, ...patch } : txn,
      ),
    );
  }

  function updatePosting(
    txnIndex: number,
    postingIndex: number,
    patch: Partial<Posting>,
  ) {
    const txn = transactions[txnIndex];
    updateTxn(txnIndex, {
      postings: txn.postings.map((posting, itemIndex) =>
        itemIndex === postingIndex ? { ...posting, ...patch } : posting,
      ),
    });
  }

  function addPosting(txnIndex: number) {
    const txn = transactions[txnIndex];
    updateTxn(txnIndex, {
      postings: [...txn.postings, { account: "", amount: "", currency: "" }],
    });
  }

  function removePosting(txnIndex: number, postingIndex: number) {
    const txn = transactions[txnIndex];
    updateTxn(txnIndex, {
      postings: txn.postings.filter((_, index) => index !== postingIndex),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {transactions.map((txn, txnIndex) => {
        const incomplete = txn.flag === "incomplete";
        return (
          <Card
            key={txnIndex}
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
                      transactions.filter((_, index) => index !== txnIndex),
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
                value={txn.date}
                onChange={(event) =>
                  updateTxn(txnIndex, { date: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item className="md:col-span-3" label={t("proposal.payee")}>
              <Input
                value={txn.payee ?? ""}
                onChange={(event) =>
                  updateTxn(txnIndex, { payee: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item
              className="md:col-span-3"
              label={t("proposal.narration")}
            >
              <Input
                value={txn.narration}
                onChange={(event) =>
                  updateTxn(txnIndex, { narration: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item className="md:col-span-3" label={t("proposal.tags")}>
              <Input
                key={(txn.tags ?? []).join(",")}
                defaultValue={(txn.tags ?? []).map((tag) => `#${tag}`).join(" ")}
                placeholder={t("proposal.tags.placeholder")}
                onBlur={(event) =>
                  updateTxn(txnIndex, {
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
            dataSource={txn.postings}
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
                      updatePosting(txnIndex, postingIndex, { account })
                    }
                  />
                ),
              },
              {
                title: t("proposal.amount"),
                dataIndex: "amount",
                width: 130,
                render: (_, posting, postingIndex) => (
                  <Input
                    value={posting.amount ?? ""}
                    onChange={(event) =>
                      updatePosting(txnIndex, postingIndex, {
                        amount: event.target.value,
                      })
                    }
                  />
                ),
              },
              {
                title: t("proposal.currency"),
                dataIndex: "currency",
                width: 110,
                render: (_, posting, postingIndex) => (
                  <Input
                    value={posting.currency ?? ""}
                    onChange={(event) =>
                      updatePosting(txnIndex, postingIndex, {
                        currency: event.target.value,
                      })
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
                    onClick={() => removePosting(txnIndex, postingIndex)}
                  />
                ),
              },
            ]}
          />
          <Space className="mt-3">
            <Button
              icon={<PlusOutlined />}
              onClick={() => addPosting(txnIndex)}
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
