---
doc: spec
status: approved
---

# Blast Radius — Technical Spec

## How This Works, In Plain Language
Three files do everything. `reach.js` is pure logic: hand it a parsed Terraform plan object
and it returns two reach graphs (prior, planned), the edges it derived, and the findings with
severity tags. `index.html` is the page: paste box, SVG canvas, findings panel — it calls
`reach.js` and draws the result. `test.js` runs `reach.js` against the committed example plan
and asserts the findings are what we expect.

No build step, no bundler, no framework, no server-side processing. The plan never leaves the
browser. This shape is chosen because the entire product is one pure function plus a drawing
of its output, and anything more would be scaffolding for a second feature that doesn't exist.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.

1. Page loads → `index.html` shows the paste box and the **Load the example plan** button.
2. Paste or click example → `JSON.parse` in a try/catch → shape check for `format_version`
   and `planned_values` → on failure, a named error into the findings panel, canvas untouched.
3. Valid plan → `analyze(plan)` in `reach.js` returns `{prior, planned, edges, findings, counts}`.
4. `index.html` lays out nodes (layered, by distance from principals), draws SVG edges grey
   for prior reach and red for new, dims untouched nodes, animates the counter `prior → planned`.
5. Findings render severity-sorted in the right panel. Click a finding → highlight its edge
   path, dim everything else. Click a node → popover naming the reference path, IAM statement
   index, or SG rule that created each inbound edge.

## Stack
- **Vanilla JS (ES modules), no dependencies.** `reach.js` exports `analyze()`; `index.html`
  imports it with `<script type="module">`. Rationale: the logic is JSON traversal and the view
  is SVG — both native. Tradeoff accepted: no reactive re-render, so the view redraws wholesale
  on each parse. At this size that is cheaper than a framework.
- **Inline SVG, hand-rolled layered layout.** No d3, no cytoscape, no dagre.
  Tradeoff: layout quality is ours to get right, and it is the one real build risk (below).
- **CSS custom properties, no preprocessor.** Native nesting is fine in current browsers.
- **`node --test` with `node:assert`** for the check. Node v22.23.1 verified on this host.
  Zero install.
- **Terraform v1.13.1** (verified) to generate the example plan. Not a runtime dependency —
  the generated `plan.json` is committed.

Docs: [Terraform JSON format](https://developer.hashicorp.com/terraform/internals/json-format),
[SVG](https://developer.mozilla.org/en-US/docs/Web/SVG), [node:test](https://nodejs.org/api/test.html).

## Where It Runs and How Someone Tries It
Runtime: any modern browser. No API keys, no env vars, no network calls after page load.

- Locally: `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`.
  (Needed only because ES modules are blocked on `file://`.)
- Tests: `node --test` in the repo root.
- Deployment (optional, for convenience of judges): static files served by the existing Caddy
  instance on Joshua's host under a subdomain. Not a substitute for the video.

Recording: browser at 1280×720 or wider, example plan loaded by button so no typing is filmed.

## Look and Feel
Carried from `prd.md > Look and Feel` — do not re-interview.

Near-black canvas (`#0d1117`-ish), grey nodes for prior reach, one red (`#f85149`-ish) used
*only* for new reach, amber reserved for the unknown/dashed state. Monospace throughout for
ARNs and resource addresses; a single sans face for panel prose. Dense and fast, not spacious.
Interface copy is flat and declarative — "aws_iam_role.ci can now read every object in
aws_s3_bucket.data", never "Uh oh! We found an issue". Motion only on the reach counter.
No gradients, illustrations, rounded dashboard cards, or decorative animation.

## Components

### `reach.js` — `analyze(plan)`
Pure, no DOM, no I/O. Returns `{counts, nodes, edges, findings, caveats}`.
PRD ref: `prd.md > Reach computation — three edge kinds`, `prd.md > Severity — three rules`.

Sub-steps, each a small named function:
- `nodesFrom(plan)` — union of `prior_state` and `planned_values` resource addresses.
- `referenceEdges(plan)` — from `configuration.root_module.resources[].expressions[].references`;
  strips attribute suffixes (`aws_s3_bucket.data.arn` → `aws_s3_bucket.data`).
- `iamEdges(plan)` — parse `jsonencode`d policy strings in planned values; map
  `Statement[].Action` + `Resource` to target addresses by ARN match against known resources.
- `sgEdges(plan)` — ingress rules → port ranges → resources referencing that SG; `0.0.0.0/0`
  and `::/0` originate from a synthetic `internet` node.
- `reachFrom(edges, roots)` — BFS, returns the reachable set. Run twice: prior, planned.
- `findingsFor(delta)` — applies the three severity rules in order, one tag per finding.

### `index.html` — view
Paste box, SVG canvas, findings panel, counter, node popover. Imports `analyze`.
PRD ref: `prd.md > Screens and Layout`, `prd.md > The reach delta`.
Layout: nodes bucketed into columns by BFS depth from principals, evenly spaced vertically
within a column, edges as cubic béziers. No force simulation, no animation on layout.

### `test.js` — the one runnable check
PRD ref: `prd.md > Severity — three rules, nothing more`.
Asserts against the committed `demo/plan2.json`: prior reach excludes the bucket, planned reach
includes it, exactly one `high` finding naming `aws_iam_role.ci` → `aws_s3_bucket.data`, and
that malformed input throws a named error rather than a `TypeError`.

## Data Model
No persistence, no storage, no accounts. All state is one in-memory object produced by
`analyze()` and discarded on reload. The pasted plan is held in a variable, never written
anywhere. Leaving and coming back is a blank slate, by design (`prd.md > States and Boundaries`).

## File Structure
```
blast-radius/
├── index.html          # the whole view: paste box, SVG canvas, findings panel
├── reach.js            # analyze(plan) -> {counts, nodes, edges, findings, caveats}
├── test.js             # node --test; asserts findings against demo/plan2.json
├── LICENSE             # MIT (hackathon requires a detectable OSS license)
├── README.md           # what it is, how to run, what's real vs simplified
├── demo/
│   ├── main.tf         # the module the example plan comes from
│   ├── terraform.tfstate  # committed synthetic baseline = the "before" world
│   └── plan2.json      # committed real `terraform show -json` output
└── devpost/            # Devpost learning workspace (scope, prd, spec)
```

## External Services and Dependencies
None at runtime. No APIs, no database, no keys, no rate limits, no cost.
Terraform is a dev-time tool only, already installed at `~/bin/terraform`.

## Important Failure Modes
- **`known after apply` values** → ARN matching can't resolve, so the edge is drawn dashed and
  labelled unknown rather than dropped or guessed. This is the common case in real plans and
  the honest answer is visible uncertainty.
- **Hand-rolled layout overlaps at larger node counts** → cap rendered nodes (~40), list the
  remainder in the panel with a count. Agreed fallback from `prd.md > Open Questions`.
- **Policy documents that aren't `jsonencode`d strings** (already-parsed objects, or HCL
  heredocs) → `iamEdges` skips what it can't parse and adds a caveat line naming the skipped
  resource, instead of failing the whole analysis.

## What Was Simplified and Why
- **Root module only** instead of full module tree and `for_each`/`count` expansion — the
  reference graph in `configuration` is flat per module; walking `module_calls` is a second
  traversal that proves nothing more. Full version needs recursive module resolution plus
  index-aware address matching.
- **String/prefix ARN matching** instead of real IAM ARN pattern evaluation — handles `*`,
  `prefix/*`, and exact matches. Full version implements IAM's wildcard semantics and
  `Condition` evaluation.
- **Reach as asserted by the policy document** instead of effective permissions — conditions,
  permission boundaries, SCPs and deny precedence are not evaluated, and the UI says so.
  Full version is a policy evaluation engine.
- **Synthetic committed baseline state** instead of real remote state — gives a genuine
  `prior_state` with zero AWS calls and no credentials. Disclosed in the README.

## Decisions and Open Issues

Decisions:
- Three files, no dependencies, no build step — Joshua's stack preference is whatever is
  smallest that works; this is also the only shape that stays recordable and clonable.
- `reach.js` kept pure specifically so the one runnable check needs no DOM harness.
- Grey/red on the canvas, severity in the panel — one meaning per visual channel
  (`prd.md > Product Decisions`).
- MIT license, because the hackathon requires a detectable OSS license in the About section.

Verified by live execution on this host (not assumed):
- `terraform v1.13.1`, `node v22.23.1`.
- `configuration.root_module.resources[].expressions[].references` contains the
  IAM-policy → S3-bucket edge: `["aws_s3_bucket.data.arn", "aws_s3_bucket.data"]`.
- A greenfield plan has **no** `prior_state`; a `-refresh=false` plan against the committed
  baseline **does** (`prior resources: [aws_iam_role.ci, aws_s3_bucket.data]`,
  `planned: [+ aws_iam_role_policy.ci]`, changes `update / create / no-op`). The whole
  before/after kernel depends on this and it is confirmed.

The one genuine unknown: whether a hand-rolled layered SVG layout reads well on video at
root-module size. Not resolvable on paper. Investigation agreed for `5-build`: build the
layout first against `demo/plan2.json`, screenshot it, judge it, and fall back to the node
cap if it's muddy. Evidence needed: a rendered screenshot, not an assertion that it works.

Carried from `prd.md > Open Questions`: same item, now assigned to the build with a fallback.
