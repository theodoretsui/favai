"""Runtime checks for the stable BQL examples exposed to the agent."""

from __future__ import annotations

from pathlib import Path

import pytest
from fava.core import FavaLedger


@pytest.fixture
def bql_ledger(tmp_path: Path) -> FavaLedger:
    ledger_path = tmp_path / "bql.beancount"
    ledger_path.write_text(
        """option "operating_currency" "CNY"

2026-01-01 open Assets:Bank CNY
2026-01-01 open Expenses:Food CNY
2026-01-01 open Expenses:Travel CNY

2026-01-10 * "Cafe" "Coffee" #trip
  Expenses:Food 42 CNY
  Assets:Bank -42 CNY

2026-02-05 * "Metro" "Airport train" #trip
  Expenses:Travel 30 CNY
  Assets:Bank -30 CNY
"""
    )
    return FavaLedger(str(ledger_path))


def run_query(ledger: FavaLedger, query: str):
    """Execute a query through the same Fava shell used by the frontend API."""
    return ledger.query_shell.execute_query_serialised(ledger.all_entries, query)


def test_from_filters_transactions_while_where_filters_postings(bql_ledger):
    transaction_rows = run_query(
        bql_ledger,
        "SELECT account FROM payee = 'Cafe' ORDER BY account",
    )
    posting_rows = run_query(
        bql_ledger,
        "SELECT account FROM payee = 'Cafe' "
        "WHERE account ~ '^Expenses:' ORDER BY account",
    )

    assert transaction_rows.t == "table"
    assert transaction_rows.rows == [("Assets:Bank",), ("Expenses:Food",)]
    assert posting_rows.t == "table"
    assert posting_rows.rows == [("Expenses:Food",)]


def test_aggregate_and_month_examples_execute(bql_ledger):
    result = run_query(
        bql_ledger,
        "SELECT month, account, units(sum(position)) AS amount "
        "FROM year = 2026 WHERE account ~ '^Expenses:' "
        "GROUP BY month, account ORDER BY month, account",
    )

    assert result.t == "table"
    assert [column.name for column in result.types] == ["month", "account", "amount"]
    assert len(result.rows) == 2


@pytest.mark.parametrize(
    "query, expected_type",
    [
        ("BALANCES AT cost WHERE account ~ '^Assets:'", "table"),
        ("JOURNAL '^Assets:' FROM year = 2026", "table"),
        ("PRINT FROM year = 2026 AND 'trip' IN tags", "string"),
    ],
)
def test_read_only_shortcut_examples_execute(bql_ledger, query, expected_type):
    assert run_query(bql_ledger, query).t == expected_type
