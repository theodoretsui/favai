import { describe, expect, it } from "vitest";

import type { Transaction } from "@/api";
import { prepareTransactionsForValidation } from "./proposalEditing";

describe("proposal editing", () => {
  it("turns fully cleared units into an inferred balancing posting", () => {
    const transactions: Transaction[] = [
      {
        date: "2026-08-09",
        narration: "Lunch",
        postings: [
          {
            account: "Expenses:Food",
            units: { number: "50.00", currency: "CNY" },
          },
          {
            account: "Assets:Bank",
            units: { number: "", currency: "" },
          },
        ],
      },
    ];

    const prepared = prepareTransactionsForValidation(transactions);

    expect(prepared[0].postings[1].units).toBeUndefined();
    expect(transactions[0].postings[1].units).toEqual({
      number: "",
      currency: "",
    });
  });

  it("leaves partially entered units for backend validation", () => {
    const transactions: Transaction[] = [
      {
        date: "2026-08-09",
        narration: "Lunch",
        postings: [
          {
            account: "Expenses:Food",
            units: { number: "50.00", currency: "" },
          },
        ],
      },
    ];

    expect(prepareTransactionsForValidation(transactions)).toEqual(transactions);
  });
});
