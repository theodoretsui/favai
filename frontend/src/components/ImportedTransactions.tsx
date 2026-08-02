import { CheckCircle2Icon } from "lucide-react";

import type { Transaction } from "@/api";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ImportedTransactions({
  transactions,
  confirmedCount,
}: {
  transactions: Transaction[];
  confirmedCount: number | null;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2Icon className="size-4 text-emerald-600" />
        <h2 className="text-sm font-medium">{t("imported.title")}</h2>
        <Badge variant="secondary">
          {t("imported.count", {
            count: confirmedCount ?? transactions.length,
          })}
        </Badge>
      </div>

      {transactions.map((transaction, transactionIndex) => (
        <div
          key={transactionIndex}
          className="flex flex-col gap-2 rounded-lg border bg-card p-3"
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="font-mono text-xs text-muted-foreground">
              {transaction.date}
            </span>
            {transaction.payee && (
              <span className="font-medium">{transaction.payee}</span>
            )}
            <span>{transaction.narration}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("proposal.account")}</TableHead>
                <TableHead className="w-32 text-right">
                  {t("proposal.amount")}
                </TableHead>
                <TableHead className="w-24">
                  {t("proposal.currency")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transaction.postings.map((posting, postingIndex) => (
                <TableRow key={postingIndex}>
                  <TableCell className="font-mono text-xs">
                    {posting.account}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {posting.amount || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {posting.currency || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </section>
  );
}
