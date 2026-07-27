import { PlusIcon, Trash2Icon } from "lucide-react";

import type { Posting, Transaction } from "@/api";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountCombobox } from "@/components/AccountCombobox";

/**
 * Editable proposal table. Every edit produces a new immutable array via
 * onChange; the parent marks the proposal dirty.
 */
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
      transactions.map((txn, i) => (i === index ? { ...txn, ...patch } : txn)),
    );
  }

  function updatePosting(
    txnIndex: number,
    postingIndex: number,
    patch: Partial<Posting>,
  ) {
    const txn = transactions[txnIndex];
    updateTxn(txnIndex, {
      postings: txn.postings.map((p, i) =>
        i === postingIndex ? { ...p, ...patch } : p,
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
      postings: txn.postings.filter((_, i) => i !== postingIndex),
    });
  }

  function removeTxn(index: number) {
    onChange(transactions.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {transactions.map((txn, txnIndex) => (
        <div
          key={txnIndex}
          className="flex flex-col gap-3 rounded-lg border bg-card p-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                {t("proposal.date")}
              </Label>
              <Input
                type="date"
                className="w-36"
                value={txn.date}
                onChange={(e) =>
                  updateTxn(txnIndex, { date: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                {t("proposal.payee")}
              </Label>
              <Input
                className="w-44"
                value={txn.payee ?? ""}
                onChange={(e) =>
                  updateTxn(txnIndex, { payee: e.target.value })
                }
              />
            </div>
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                {t("proposal.narration")}
              </Label>
              <Input
                value={txn.narration}
                onChange={(e) =>
                  updateTxn(txnIndex, { narration: e.target.value })
                }
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("proposal.transaction.remove")}
              onClick={() => removeTxn(txnIndex)}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("proposal.account")}</TableHead>
                <TableHead className="w-28">{t("proposal.amount")}</TableHead>
                <TableHead className="w-24">
                  {t("proposal.currency")}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {txn.postings.map((posting, postingIndex) => (
                <TableRow key={postingIndex}>
                  <TableCell>
                    <AccountCombobox
                      value={posting.account}
                      accounts={accounts}
                      onChange={(account) =>
                        updatePosting(txnIndex, postingIndex, { account })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={posting.amount ?? ""}
                      onChange={(e) =>
                        updatePosting(txnIndex, postingIndex, {
                          amount: e.target.value,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={posting.currency ?? ""}
                      onChange={(e) =>
                        updatePosting(txnIndex, postingIndex, {
                          currency: e.target.value,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("proposal.posting.remove")}
                      onClick={() => removePosting(txnIndex, postingIndex)}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addPosting(txnIndex)}
            >
              <PlusIcon />
              {t("proposal.posting.add")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
