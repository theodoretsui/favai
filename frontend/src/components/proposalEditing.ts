import type { Transaction } from "@/api";

export function prepareTransactionsForValidation(
  transactions: Transaction[],
): Transaction[] {
  return transactions.map((transaction) => ({
    ...transaction,
    postings: transaction.postings.map((posting) => {
      if (
        posting.units &&
        !posting.units.number.trim() &&
        !posting.units.currency.trim()
      ) {
        const { units: _units, ...balancedPosting } = posting;
        return balancedPosting;
      }
      return posting;
    }),
  }));
}
