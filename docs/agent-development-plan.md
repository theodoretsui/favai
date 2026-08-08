# Agent capability development plan

## Status

This document records the agreed direction for improving FavaAI's agent
capabilities without treating general UI/UX work as part of the initiative.
Small UI changes that are necessary to present and approve an exact tool call
remain in scope for human-in-the-loop execution.

| Workstream | Status | Summary |
| --- | --- | --- |
| BQL guidance | Implemented; pending review | Added a progressively disclosed, skill-like BQL reference, corrected prompts, structured results, and runtime examples. |
| Ledger entry proposals | Agreed | Use separate typed tools for transactions and selected dated directives, joined by one reviewed change set. |
| Ledger file creation | Agreed | Add a narrowly scoped capability to create a Beancount file and include it from the main ledger. |
| Human in the loop | Agreed | Add a reusable tool authorization layer before enabling ledger-structure writes. |

The implementation should be delivered as focused pull requests. This plan
does not authorize merging a pull request or publishing a package release.

## Goals

- Give the agent accurate, discoverable BQL guidance without permanently
  placing the complete language reference in the system prompt.
- Keep read-only tools easy to use while making write capabilities explicit,
  reviewable, and narrowly scoped.
- Allow the agent to propose creation of a new Beancount source file and its
  corresponding `include` entry without granting arbitrary filesystem access.
- Establish a generic human-in-the-loop mechanism that future mutating or
  destructive tools can reuse.
- Improve tool results and errors so the agent can recover from a failed call
  instead of guessing.

## Non-goals

- Giving the browser agent shell or unrestricted filesystem access.
- Treating free-form chat text such as "yes" or "continue" as authorization
  for a write.
- Redesigning the chat or proposal UI beyond the controls required to inspect
  and approve a tool call.
- Expanding the initial directive allowlist to account closing, padding,
  documents, global options, plugins, or lexical tag stacks.
- Editing or deleting existing ledger entries as part of the initial file
  creation capability.

## Guiding architecture

Keep the agent's permanent system prompt limited to stable role, safety, and
tool-routing rules. Put detailed usage instructions close to the relevant tool
or behind a reference tool that the agent can call on demand.

Classify tools by effect:

| Effect | Initial tools | Execution policy |
| --- | --- | --- |
| Read | `today`, `bql_help`, `bql_query` | Execute automatically. |
| Propose | `propose_transactions`, `propose_directives` | Execute automatically; they update one pending change set but do not write the ledger. |
| Write | Ledger file creation and future confirmed transaction writes | Require approval of the exact operation. |
| Destructive | Future overwrite, edit, or delete tools | Require stronger approval; not part of the initial implementation. |

The backend remains the security boundary. Frontend validation and an agent
hook improve behavior but do not replace backend path, payload, concurrency,
and authorization checks.

## Workstream 1: progressively disclosed BQL guidance

### Current problems

- The current prompt describes `SELECT ... FROM` as a standard SQL form. In
  BQL, `FROM` filters complete entries or transactions, while `WHERE` filters
  postings; both clauses are optional.
- The short prompt mixes correct examples with incomplete language rules,
  encouraging the model to extrapolate ordinary SQL behavior that BQL does
  not implement.
- `bql_query` returns a flattened table, but its result details do not expose
  columns, row counts, or truncation in a structured form.
- Query failures do not direct the agent to the relevant documentation topic.

### Design

Add a read-only `bql_help` tool with a small topic enum. It acts as a local,
skill-like reference and returns only the requested section:

- `overview`
- `filters`
- `columns`
- `aggregations`
- `positions_and_inventories`
- `ordering_and_limits`
- `statements`
- `examples`
- `troubleshooting`

The initial system prompt should explain when to use `bql_help` and
`bql_query`, but should not embed the full reference. The reference content
should be concise, tested against the project's installed Fava/Beanquery
version, and based on the upstream Beancount Query Language documentation:

- <https://github.com/beancount/docs/blob/master/docs/beancount_query_language.md>

Keep source and license attribution with the local reference. Do not copy the
entire upstream document into the model context or frontend bundle as a single
prompt.

Improve `bql_query` results so they include:

- the executed query;
- column names and types;
- returned rows;
- total and returned row counts where available;
- an explicit truncation flag and limit;
- a useful error message that recommends an appropriate `bql_help` topic.

The tool remains read-only. BQL statements that transform query output must
not be confused with ledger-file mutation.

### Tests and acceptance criteria

- Prompt and tool tests assert the correct `FROM` and `WHERE` semantics.
- Every `bql_help` topic returns non-empty, bounded content.
- Reference examples execute successfully against a representative fixture
  ledger, or are explicitly marked as conceptual when runtime support differs.
- Aggregate examples cover `GROUP BY`, `SUM(position)`, `units`, and `cost`.
- Result tests cover tables, string results, empty results, multiple
  currencies, and truncation.
- Query errors remain tool errors and give the agent enough information to
  correct and retry the query.

## Workstream 2: ledger entry proposals

### Status

The following design is agreed for implementation. It is based on the
Beancount syntax cheat sheet at revision
`be7719d990d61ebe0342cb0ef0bc10c2d0f22509` (content blob
`e93dd9226c75d32c739d56e0929b46c63ede7b9a`):

- <https://github.com/beancount/docs/blob/be7719d990d61ebe0342cb0ef0bc10c2d0f22509/docs/beancount_cheat_sheet.md>

The cheat sheet treats transactions as only one family of dated Beancount
directives. It also covers account lifecycle, commodities, prices, notes,
documents, balance assertions, padding, and events. Transaction postings can
carry per-unit or total costs, compound costs, prices, lot dates, flags, and
metadata. Global or lexical statements such as `option`, `include`,
`pushtag`, and `poptag` have different scope and ordering semantics.

Known issues to resolve during design:

- The tool description should make one-call, complete-batch submission more
  prominent.
- The prompt says all amounts are positive even though Beancount postings and
  the current validator accept signed amounts.
- The prompt suggests new subaccounts while the tool rejects accounts that are
  not already present.
- The current posting shape contains only `account`, `amount`, and `currency`;
  it cannot express price conversion, cost basis, total price, or lot matching.
- The unified prompt discourages using analysis and proposal tools in the same
  request, which conflicts with workflows such as inspecting lots before a
  stock sale.

### Agreed tool boundary

Use two model-facing proposal tools. Neither tool writes a file:

1. `propose_transactions` handles the common, high-frequency workflow and
   submits a complete batch of typed transactions.
2. `propose_directives` handles a complete batch of supported, typed
   non-transaction directives.

Both tools update a single pending `LedgerChangeSet`. A change set may contain
an `open` directive and transactions that use the new account, or a commodity
declaration, price, and investment transaction. The application validates and
reviews the combined change set rather than confirming unrelated tool results
independently.

The actual "write this reviewed change set" operation should remain an
application command, not a tool callable by the model. User confirmation is
bound to the exact change-set revision and target source file. Any later agent
change creates a new revision and invalidates the previous approval.

This separation preserves the current proposal-first safety model:

```text
agent tools -> pending LedgerChangeSet -> validation and preview
            -> explicit user confirmation -> backend write
```

### `propose_transactions` v2

Keep the top-level `transactions` array and make its batch contract explicit
in the tool description and parameter description: one call contains every
transaction currently being proposed, and a retry replaces the prior
agent-generated transaction batch rather than silently appending duplicates.

Represent a posting with typed accounting concepts instead of concatenating
an unrestricted Beancount amount string:

```text
Posting
  account
  flag?
  units?: { number, currency }
  cost?:
    per_unit { number, currency, date? }
    total { number, currency, date? }
    compound { per_number, total_number, currency, date? }
  price?:
    per_unit { number, currency }
    total { number, currency }
  metadata?
```

`units.number` is signed. Cost and price numbers are unsigned. At most one
posting in a transaction may omit units for Beancount interpolation. The
backend renderer maps the typed variants to syntax such as:

```beancount
10 GOOG {502.12 USD}
10 GOOG {{5021.20 USD}}
10 GOOG {502.12 # 9.95 USD}
1000 USD @ 1.10 CAD
1000 USD @@ 1100 CAD
10 GOOG {502.12 USD, 2014-05-12} @ 510 USD
```

The transaction itself continues to support date, complete/incomplete flag,
payee, narration, tags, links, and typed metadata. Posting flags and metadata
are added. Initial metadata values use a bounded discriminated scalar model
covering strings, numbers, booleans, and dates rather than arbitrary JSON.
Lot labels and merge markers are deferred until the core cost, price, and lot
date model is stable.

The backend must render canonical Beancount, parse it back, verify that it
produces the expected transaction and posting shapes, and validate the whole
proposed batch in ledger context. Fava's current `deserialise` helper parses a
posting amount string and supports cost and price syntax indirectly, but it is
not intended for full round trips and only directly supports Transaction,
Balance, and Note entry creation. The new proposal model must not expose those
implementation limitations as its public contract.

### `propose_directives`

Use a discriminated union for the initial allowlist of dated directives:

| Directive | Required typed fields | Notes |
| --- | --- | --- |
| `open` | date, account | Optional currencies and booking method. |
| `commodity` | date, currency | Primarily useful with metadata. |
| `price` | date, commodity, amount | Covers both securities and exchange-rate history. |
| `balance` | date, account, amount | Assertion, not an adjustment; validation failure must remain visible. |
| `note` | date, account, comment | Account-scoped annotation. |
| `event` | date, type, description | Ledger-wide dated fact. |

Defer `close`, `pad`, and `document` from the first version:

- `close` changes the validity of all later account activity and deserves a
  dedicated account-lifecycle review.
- `pad` can synthesize transactions and should not be introduced until its
  generated effects can be previewed reliably.
- `document` stores a path in ledger data and needs a separate decision about
  document ingestion, path validation, and whether the referenced file must
  already exist.

Exclude `option`, `include`, `plugin`, `pushtag`, and `poptag` from the generic
directive tool:

- `include` belongs to the separately reviewed ledger-file capability.
- `option` and `plugin` change global parsing or runtime behavior and need a
  future configuration-specific threat model.
- `pushtag` and `poptag` are lexical and depend on file order, making them a
  poor fit for append-oriented structured entry writes.

Do not accept raw Beancount source from the model as an escape hatch. The
backend owns canonical rendering and rejects directive types outside the
allowlist. This prevents a valid-looking proposal field from smuggling in an
`include`, `plugin`, or global option.

### Change-set and confirmation semantics

A `LedgerChangeSet` should contain at least:

- a stable ID and monotonic revision;
- typed transaction and directive batches;
- target source file;
- canonical rendered preview;
- source checksum observed during validation;
- validation errors and warnings;
- provenance linking each batch to its tool call.

In the initial version, its target must be one of the ledger's already loaded
source files. Creating and including a new source file remains the separate,
HITL-gated capability in Workstream 3; a future orchestration layer may combine
the two only after both operations have stable validation and rollback
semantics.

Tool retries replace their own latest batch in the active change set. They do
not append by default. This makes "submit all entries once" deterministic and
prevents duplicate transactions after an agent repairs a validation error.

Before confirmation, validate the combined result against the loaded ledger,
not only each entry in isolation. This must catch:

- missing or closed accounts;
- currency constraints;
- unbalanced transactions and interpolation errors;
- invalid or ambiguous lot reductions;
- invalid cost/price combinations;
- balance assertion failures;
- duplicate or conflicting directives where Beancount reports them.

The write endpoint rechecks the target checksum and change-set revision,
writes only the canonical validated entries, and reports the Fava reload
result. A validation warning must never be silently converted into a complete
transaction flag.

### Agent workflow rules

- The agent may call read-only BQL/reference tools before proposing entries in
  the same user request.
- For an investment sale, inspect current units and lots before choosing a
  cost specification. Never invent a lot cost or acquisition date.
- Use `propose_directives` for a missing account or commodity declaration;
  do not place an undeclared directive inside transaction text.
- Submit all known transactions in one transaction call and all known
  directives in one directive call.
- Do not calculate a missing exchange rate, fee, proceeds amount, or capital
  gain unless it is derivable from user/ledger data. Preserve uncertainty and
  request review when source facts conflict.
- Tool success means "the proposal was accepted for review", never "the
  ledger was written".

### Tests and acceptance criteria

- Existing simple multi-transaction imports continue to work.
- Tool descriptions and retry tests enforce complete-batch replacement rather
  than append semantics.
- Fixtures cover simple postings, interpolation, per-unit and total costs,
  compound costs, per-unit and total prices, lot dates, posting flags, and
  metadata.
- End-to-end fixtures cover foreign-exchange conversion, security purchase,
  security sale with fees and capital gain, and multiple transactions in one
  proposal.
- Each allowed directive renders, parses, validates, previews, and writes
  correctly; each excluded directive is rejected before write.
- An `open` plus a transaction using the new account validates as one change
  set, while the transaction alone fails clearly.
- Invalid lot selection and stale source checksums prevent confirmation.
- The agent cannot inject raw source, arbitrary directive types, file paths to
  read, or global configuration through either proposal tool.

### Agreed initial scope

- Keep separate `propose_transactions` and `propose_directives` tools rather
  than one large entry union.
- Keep ordinary entry writes as user-confirmed application actions; do not add
  an agent-callable `write_entries` tool.
- Support `open`, `commodity`, `price`, `balance`, `note`, and `event` in the
  first directive version.
- Defer `close`, `pad`, and `document`.
- Allow proposals to target already loaded source files only.
- Initially support string, number, boolean, and date metadata values.
- Support lot dates in transaction v2; defer lot labels and merge markers.

The BQL, HITL, and file-creation pull requests should not introduce partial
versions of this schema. Ledger proposal work begins with the shared change-set
contract described below.

## Workstream 3: create a ledger file and include it

### User-facing capability

Add a narrowly scoped write tool that proposes an operation equivalent to:

```text
create_ledger_file(
  path,
  initial_content,
  include_in_main
)
```

The exact arguments may change during implementation, but the approved
operation must always show the destination path, full initial content, and
the `include` line that will be added to the main ledger.

This tool must use the generic HITL layer described below. It executes
sequentially and must never write before approval.

### Backend constraints

- Accept only normalized relative paths beneath the main ledger directory.
- Initially allow only `.beancount` files.
- Reject absolute paths, traversal, unsafe path components, symlink escape,
  glob patterns, and special files.
- Reject overwriting an existing file. A later overwrite capability must be a
  separate, destructive tool.
- Write the `include` only to the top-level ledger file.
- Use a normalized exact include path and reject duplicate includes.
- Compare the main file's checksum or equivalent revision before mutation so
  a concurrent user edit is never silently overwritten.
- Validate payload sizes and Beancount syntax before mutation where practical.
- Return the created path, include path, and reload/validation outcome in the
  normal JSON API response shape.

### Failure and retry semantics

Create the new source file before changing the main ledger. If the include
update fails, the loaded ledger remains unchanged and the new file is an
identifiable orphan rather than a broken include. A retry may reuse an
identical orphan only after explicit review; it must never replace different
content.

The operation should be idempotent for an already completed, identical change.
Partial and complete states must produce distinct, actionable errors.

### Tests and acceptance criteria

- A nested relative `.beancount` path can be created and included.
- The resulting main ledger and new file load successfully through Beancount
  and Fava.
- Traversal, absolute paths, symlink escape, glob paths, duplicate includes,
  existing files, invalid syntax, stale checksums, and oversized payloads are
  rejected.
- Failure between file creation and include insertion is recoverable and does
  not damage the main ledger.
- The agent tool throws on backend failure so the transcript records a tool
  error.
- No endpoint provides general read, write, rename, or delete filesystem
  access.

## Workstream 4: reusable human-in-the-loop tool authorization

### Execution model

Use `pi-agent-core`'s asynchronous `beforeToolCall` hook after tool arguments
have been validated and before `execute` is entered. For gated tools, the hook
creates an approval request and waits for an explicit user decision. A denial
or cancellation blocks the call and produces a tool result that the agent can
understand.

Approval must be bound to:

- tool name and risk class;
- canonical serialized arguments and their hash;
- current ledger and conversation session;
- a short expiration time;
- a single-use identifier or capability token.

Changing any argument invalidates the approval. Approval of one call must not
authorize later calls, even when they use the same tool.

### Interaction and transcript rules

- Show the exact operation and its expected effects before approval.
- The approval control is application state, not a model-generated message.
- Free-form user or assistant text cannot grant approval.
- Denial, expiry, abort, page refresh, and component teardown fail closed.
- The tool-call and final tool result remain in the agent transcript as the
  source of truth.
- Gated writes execute sequentially so multiple proposed mutations cannot race
  through approval or execution.

### Backend enforcement

For ledger writes, approval should produce a short-lived, single-use backend
capability tied to the canonical operation hash. The write endpoint consumes
that capability and independently revalidates paths, checksums, payloads, and
current ledger state.

The first implementation only needs `read`, `propose`, and `write` policies,
but the API should allow a future `destructive` policy without weakening the
write policy.

### Tests and acceptance criteria

- Read and proposal tools continue without an approval prompt.
- A gated tool cannot enter `execute` before approval.
- Approval executes exactly the reviewed arguments once.
- Denial, expiry, abort, refresh, argument changes, and token replay prevent
  execution.
- Backend calls without a valid capability fail even if frontend checks are
  bypassed.
- Simultaneous gated calls are serialized and individually approved.
- Approval state is never persisted as a reusable permission in conversation
  history.

## Delivery plan

### PR 1: BQL reference and query-tool contract

- Correct the base and unified BQL prompts.
- Add the topic-based `bql_help` tool and local reference content.
- Improve structured query results, truncation, and errors.
- Add frontend unit coverage and representative ledger query tests.
- Keep `project.version` unchanged.

### PR 2: generic HITL foundation

- Add tool effect/risk metadata owned by the application.
- Implement approval request state and the `beforeToolCall` gate.
- Add short-lived, operation-bound backend authorization for writes.
- Test approval, denial, cancellation, expiry, replay, and concurrency.
- Do not add a ledger mutation tool yet.

### PR 3: create-and-include ledger file

- Add the scoped backend operation and agent tool.
- Integrate it with the HITL foundation.
- Add path, checksum, partial-failure, Beancount-load, and end-to-end tests.
- Keep overwrite, edit, delete, and arbitrary file operations out of scope.

### PR 4: shared change set and `propose_transactions` v2

- Implement `propose_transactions` v2 and the shared `LedgerChangeSet` after
  the BQL, HITL, and file-creation foundations are independently reviewable.
- Add typed units, costs, prices, lot dates, posting flags, and bounded
  metadata.
- Implement complete-batch replacement, canonical rendering, ledger-context
  validation, revision-bound confirmation, and advanced transaction fixtures.

### PR 5: `propose_directives`

- Add the typed `open`, `commodity`, `price`, `balance`, `note`, and `event`
  union on top of the stable change-set contract.
- Validate mixed directive and transaction proposals as one change set.
- Keep `close`, `pad`, `document`, global configuration, includes, and lexical
  tag stacks out of scope.

### Later PRs

- Consider lot labels and merge markers after v2 cost and lot-date behavior is
  proven against real ledgers.
- Design dedicated account-closing, padding, and document workflows before
  adding their directives.
- Introduce destructive tools only with separate threat modeling and stronger
  confirmation requirements.

Each implementation PR should start from the latest `main`, run the relevant
Python and frontend checks, and be reviewed independently. The plan document
may evolve through follow-up planning PRs as decisions are made.

## Decision record

- 2026-08-05: Agreed to pursue progressively disclosed BQL guidance.
- 2026-08-05: Agreed to pursue scoped ledger file creation plus a main-ledger
  include.
- 2026-08-05: Agreed to build reusable HITL before enabling structural ledger
  writes.
- 2026-08-05: Deferred the transaction import design for further discussion.
- 2026-08-05: Reviewed the upstream Beancount syntax cheat sheet and proposed
  separate typed transaction and directive tools backed by one reviewed
  change set.
- 2026-08-05: Accepted the two-tool boundary, application-owned confirmation,
  six-directive initial allowlist, loaded-source-file restriction, bounded
  metadata, lot-date support, and deferral of close, pad, document, lot labels,
  and merge markers.
- 2026-08-06: Implemented Workstream 1 on `codex/bql-skill`, including the
  topic-based BQL reference, read-only query boundary, structured/truncated
  result metadata, actionable failures, prompt corrections, and frontend plus
  Fava-runtime tests; pending review and pull-request publication.
