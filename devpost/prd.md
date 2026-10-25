---
doc: prd
status: approved
---

# Blast Radius — Product Requirements

A single-page tool where a cloud engineer pastes a `terraform plan -json` and sees what the
change can reach, before versus after, with severity-tagged findings beside the graph.
For the reviewer approving someone else's Terraform PR and the author pre-flighting their own.
Source: `scope.md > Who It's For`, `scope.md > The Unique Kernel`.

## The Core Journey
Develops `scope.md > The Core Loop`.

1. Open the page. A paste box sits centre-stage with one button: **Load the example plan**.
   Nothing else competes for attention.
2. Paste plan JSON, or click the example (the real plan generated from the committed module).
3. On parse, the paste box collapses to a thin bar and the canvas takes the page. The reach
   counter animates from prior to planned: `reach 2 → 9`.
4. The findings panel docks right, severity-sorted, each finding one line of plain English
   naming the principal, the action, and the target ARN.
5. Click a finding → its path highlights on the canvas and the rest dims. Click a node →
   see which reference, IAM statement, or SG rule put it there.
6. Success: the reviewer can say in one sentence what this plan widened, and point at it.

## Screens and Layout
One screen, no navigation.

- **Before parse:** centred paste box, example button, one line of what this does.
- **After parse:** canvas fills the page; findings panel docked right; reach counter pinned
  top-left; collapsed paste bar top, click to reopen and replace the plan.
- No routing, no second surface, no modal except the node detail popover.

## Look and Feel
Graph-first canvas — the diagram is the product (`scope.md > Inspiration & Identity`).
Tooling an SRE already trusts: no marketing surface, no onboarding, paste and read.
Dense, monospace for ARNs and resource addresses, restrained palette so red means exactly
one thing. Avoid: gradients, illustrations, rounded-card dashboard styling, animated
decoration. Motion only on the reach counter, because that number is the kernel.

## Features and Behavior

### Parsing and provenance
Accepts the output of `terraform show -json <planfile>`. Everything is computed in the
browser; the plan is never uploaded. Prior reach comes from `prior_state`, planned reach
from `planned_values`, edges from `configuration.root_module.resources[].expressions[].references`.

- As a reviewer, I want to paste a plan and get a result without configuring anything.
  - [ ] Pasting the bundled example renders a graph and at least one finding.
  - [ ] No network request is made after page load.
  - [ ] A plan with no `prior_state` still renders, with prior reach shown as `—` and a
        note that this plan has no prior state to compare against.

### Reach computation — three edge kinds
Develops `scope.md > The POC Boundary`.

- **Reference edges** — resource A references resource B's attribute, so A reaches B.
- **IAM edges** — an IAM policy document's `Action` + `Resource` become an edge from the
  attached principal to the matching resource ARN.
- **Security-group edges** — an ingress rule's port range and CIDR become an edge to each
  resource using that group; `0.0.0.0/0` is edged from a distinct `internet` node.

- As the plan author, I want reach stated as the policy asserts it, with the limits visible.
  - [ ] Each edge names its source: reference path, IAM statement index, or SG rule.
  - [ ] Unresolvable values (`known after apply`) render as a dashed edge labelled unknown,
        never silently dropped.
  - [ ] A visible caveat states that reach is as asserted by the policy document —
        conditions, permission boundaries, and SCPs are not evaluated.

### Severity — three rules, nothing more
Each finding carries exactly one tag, from the first rule that matches:

- **critical** — wildcard in an IAM `Action` or `Resource` (`*`, `s3:*`, `arn:...:*`).
- **critical** — new ingress from `0.0.0.0/0` (or `::/0`).
- **high** — a new path to a data store (S3, RDS, DynamoDB, EBS, Secrets Manager, SSM
  parameters, EFS).
- **low** — any other newly added reach.

- As a reviewer, I want to know which finding to read first.
  - [ ] Findings sort critical → high → low, stable within a tag.
  - [ ] Each finding states the rule that fired in its one-line reason.
  - [ ] A finding present in prior reach is not re-reported as new.

### The reach delta
- [ ] The counter shows prior count, planned count, and the difference.
- [ ] Nodes reachable before the change render grey; newly reachable render red.
- [ ] Nodes the change does not touch render dimmed, so the diff reads at a glance.

## States and Boundaries

- **First use** — empty canvas, paste box centred, example button. No tour.
- **Parsed, nothing widened** — canvas renders in grey, counter shows no change, panel
  reads that this plan adds no new reach. This is a valid, useful answer, not an error.
- **Malformed JSON** — named error in the panel: cannot parse as JSON, with the parser's
  position. Canvas stays empty, previous result is not destroyed.
- **Valid JSON, not a Terraform plan** — named error: expected `format_version` and
  `planned_values`. Canvas stays empty.
- **Plan with no changes at all** (`resource_changes` all no-op) — stated plainly.
- **Persistence** — none. Reload is a blank slate; nothing is stored, nothing is shared.

## Product Decisions

- Severity is three rules, not a 0–100 score — a score implies precision the PoC can't
  justify, and a reviewer needs a read order, not a number.
- Privilege-escalation detection (`iam:PassRole`, `iam:CreatePolicyVersion`) deferred, to
  keep the rule set defensible rather than long.
- Before/after as grey vs red is the primary visual channel; severity lives in the panel,
  so the canvas encodes one thing only.
- Reach is "as asserted by the policy document", stated in the UI rather than hidden —
  a security reviewer will test this boundary and the tool should name it first.
- Review format for planning docs: markdown.

## What We're Building
Single HTML page, no build step, no server. Paste or load example → parse → three edge
kinds → prior vs planned reach → severity-tagged findings → click-to-highlight canvas.
One bundled real plan, generated by `terraform plan -refresh=false` against a committed
baseline state: no AWS calls, no apply, no credentials.

## Deferred From the POC
- CI mode posting findings as a PR comment — needs a runner and a token.
- Privilege-escalation rules — see Product Decisions.
- `for_each` / `count` expansion and child modules — root module only for now.
- Reading real remote state instead of the committed baseline.

## Possible Later Enhancements
GCP and Azure provider semantics. Resolving wildcard ARNs against a real account. A
shareable permalink that encodes the finding set rather than the plan.

## Non-Goals
- **Live AWS API enrichment** — needs credentials and breaks the static page.
- **Full IAM policy evaluation** (conditions, boundaries, SCPs, deny precedence) — its own
  project; the PoC states the limit instead of faking the depth.
- **Graph layout library** — hand-rolled layered SVG is smaller than the dependency.
- **Accounts, persistence, sharing** — nothing to prove within one paste.

## Open Questions
- Does the hand-rolled layered SVG layout stay readable at root-module size on video?
  Resolve during `5-build`, not before `4-spec`; fallback is capping rendered nodes and
  listing the remainder in the panel.
