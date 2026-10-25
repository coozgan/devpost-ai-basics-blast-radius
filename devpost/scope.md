---
doc: scope
status: approved
---

# Blast Radius

Paste a `terraform plan -json` and see what the change can actually reach — before vs after.

## The Unique Kernel
A Terraform plan tells you *what changes*. It never tells you *what that change can now touch*.
Blast Radius computes reach from the plan's own data on both sides of the diff and shows the
delta: a five-line policy addition that triples what a role can reach renders as a five-line
diff in review, and as a tripled graph here. The number a reviewer remembers is
"reached 2, now reaches 9", not the diff.

## Who It's For
Two people in one view, because they're often the same engineer an hour apart:
a reviewer on someone else's Terraform PR who needs a verdict — is this safe to approve? —
and the author pre-flighting their own change, who wants to poke at what they just widened.
Today both read the plan diff, recognize `aws_iam_role_policy` got bigger, and approve on
vibes because tracing the consequence by hand means opening the console.

## The Core Loop
Open the page. Paste plan JSON (or load the bundled real plan). The verdict lands at the
top — severity-tagged findings, each with a one-line reason. The graph below draws prior
reach in grey and new reach in red. Click any finding to highlight its path on the canvas;
click a node to see which rule or reference put it there. They come back on every plan whose
diff looks small but touches IAM or a security group.

## Inspiration & Identity
Graph-first canvas: the diagram is the product, findings sit in a side panel beside it.
Tooling an SRE already trusts — no marketing surface, no onboarding, paste and read.

## Why This Matters to the Learner
Nine years of multi-cloud and security work, and the gap is always the same: the review
artifact and the risk artifact are different documents, so reach gets assessed from memory.
Also a Devpost submission judged on Design, Innovation, and Presentation — which is why the
reach delta has to be *visible*, not just computed.

## What "Working" Looks Like
A real plan generated from a committed module, pasted in, producing a graph where the
CI role's new path to the S3 bucket lights up red, with a `critical` finding reading
"aws_iam_role.ci can now read every object in aws_s3_bucket.data (s3:GetObject on
arn:aws:s3:::br-demo-data/*)". The "oh, that's cool" beat: the plan says
`1 to add, 1 to change` and the counter says `reach 2 → 9`.

## The POC Boundary
In, and only this:
- Single-page web app, no build step, no server-side processing of the plan.
- Three edge kinds: resource reference edges (`configuration..expressions[].references`),
  IAM action → resource ARN, security-group rule → port → exposed resource.
- Prior vs planned reach, computed from `prior_state` and `planned_values` in the same file.
- Severity per finding (critical/high/low) with a one-line reason.
- One bundled real plan, generated here by `terraform plan -refresh=false` against a
  committed baseline state. No AWS calls, no apply, no credentials.

## Later
- CI mode that posts the same findings as a PR comment.
- Cross-module and `for_each`/count expansion beyond the root module.
- GCP and Azure provider semantics.
- Reading real remote state instead of a committed baseline.

## Explicitly Cut
- **Live AWS API enrichment** (resolving wildcards against real ARNs) — needs credentials,
  can't run in a static page, and would make the demo depend on an account.
- **Full IAM policy evaluation** (conditions, boundaries, SCPs, deny precedence) — a
  correct implementation is its own project; the PoC states reach as asserted by the
  policy document and says so.
- **Graph layout library** — a hand-rolled layered layout in SVG is smaller than the
  dependency and good enough for root-module sizes.
- **Persistence, accounts, sharing links** — nothing to prove, and the kernel is readable
  within one paste.
