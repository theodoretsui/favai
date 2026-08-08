import { describe, expect, it } from "vitest";

import type { Posting } from "@/api";
import { postingAmount, postingCurrency } from "./ImportedTransactions";

describe("written transaction posting display", () => {
  it("reads amount and currency from typed posting units", () => {
    const posting: Posting = {
      account: "Expenses:Food",
      units: { number: "50.00", currency: "CNY" },
    };

    expect(postingAmount(posting)).toBe("50.00");
    expect(postingCurrency(posting)).toBe("CNY");
  });

  it("shows placeholders for an inferred posting", () => {
    const posting: Posting = { account: "Assets:Bank" };

    expect(postingAmount(posting)).toBe("—");
    expect(postingCurrency(posting)).toBe("—");
  });
});
