---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [x] **1. Paste a plan and get real findings out of it**
  Becomes usable: `analyze(plan)` turns a real `terraform show -json` document into reach
  counts, edges, and severity-tagged findings, provable from the command line.
  Why now: the kernel is the reach delta, so it is built first — a canvas over a wrong
  analyzer is a failed build.
  PRD ref: `prd.md > Reach computation — three edge kinds`, `prd.md > Severity — three rules, nothing more`
  Spec ref: `spec.md > Components` (`reach.js`), `spec.md > File Structure`
  Build: `demo/main.tf` + `demo/seed_state.py` baseline, generate `demo/plan.json`, write
  `reach.js` with reference/IAM/SG/assume edges, prior-vs-planned BFS, three severity rules.
  Verify (mechanical): `node --test` — 10 assertions pass against the committed plan.
  Learner check: read the printed findings and confirm the critical ones are the ones a
  reviewer should actually be told about.
  Commit: `Add reach analysis over terraform plan JSON`

- [ ] **2. The graph on screen, before vs after**
  Becomes usable: open the page, load the example, see the canvas with grey prior reach and
  red new reach, and the counter showing the delta.
  Why now: makes the kernel visible, and resolves the one open build risk (hand-rolled layout
  readability) with a screenshot rather than an assertion.
  PRD ref: `prd.md > The Core Journey`, `prd.md > The reach delta`, `prd.md > Screens and Layout`
  Spec ref: `spec.md > Components` (`index.html`), `spec.md > Look and Feel`
  Build: `index.html` with paste box, example button, layered SVG canvas, reach counter.
  Verify (mechanical): serve locally, load the example, screenshot the rendered canvas and
  confirm nodes/edges are legible and unoverlapped at example size.
  Commit: `Render the reach graph with before/after encoding`

- [ ] **3. Findings panel, click to trace a path**
  Becomes usable: severity-sorted findings beside the canvas; clicking one highlights its
  path and dims the rest; clicking a node names what created each inbound edge.
  Why now: closes the core loop — a reviewer can point at the thing, which is the whole claim.
  PRD ref: `prd.md > The Core Journey` (steps 4-6), `prd.md > Severity — three rules, nothing more`
  Spec ref: `spec.md > Components` (`index.html`), `spec.md > The Core Journey Through the System`
  Build: findings panel, selection state, highlight/dim, node popover with edge provenance.
  Verify (mechanical): screenshot with a finding selected; confirm only its path is lit.
  Commit: `Add findings panel with path highlighting`

- [ ] **4. Honest edges and honest errors**
  Becomes usable: malformed and non-plan input produce named errors without destroying a
  previous result; caveats about unevaluated IAM semantics are visible on screen.
  Why now: these are the states a judge or reviewer will poke at first.
  PRD ref: `prd.md > States and Boundaries`, `prd.md > Parsing and provenance`
  Spec ref: `spec.md > Important Failure Modes`
  Build: error rendering in the panel, caveat footer, node cap fallback if layout needs it.
  Verify (mechanical): paste `{`, paste `{"a":1}`, confirm both named errors and an intact canvas.
  Commit: `Handle bad input and surface analysis caveats`

- [ ] **5. Repo ready for a stranger**
  Becomes usable: someone can clone, run the test, serve the page, and understand what is
  real versus simplified.
  Why now: hackathon requires a public repo with a detectable OSS license; the README is
  also where the synthetic baseline state gets disclosed.
  PRD ref: `prd.md > What We're Building`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`, `spec.md > What Was Simplified and Why`
  Build: `README.md`, `LICENSE` (MIT), run instructions, disclosure of the synthetic state.
  Verify (mechanical): fresh-eyes read of the README against the actual commands.
  Commit: `Add README and MIT license`

## Hands-on Checkpoints

- [ ] **After slice 2** — Joshua looks at the rendered canvas screenshot and says whether the
  layout reads well enough for a 1080p screen recording, or whether the node cap is needed.
  This is the investigation recorded in `spec.md > Decisions and Open Issues`.
- [ ] **After slice 4** — Joshua runs the whole core journey in a browser and gives feedback
  before the repo is packaged and the video is recorded.

## Revisions

_Appended as they happen._

- Slice 1: three bugs found by running the analyzer against the real plan rather than trusting
  it. (a) A `Resource: "*"` grant edged to every resource including security groups and
  instance profiles — fixed by requiring the action's service prefix to match the target ARN's
  service. (b) The `internet` node inherited the CI role's IAM grants through BFS, claiming the
  public internet could call `s3:*` — fixed by marking IAM edges as grants that only apply from
  their holder, so the network path and the assume chain are reported instead. (c) The kernel
  finding was suppressed: the CI role already reached the bucket via `s3:GetObject`, so the new
  `s3:*` grant counted as "not new reach" — fixed by reporting widened pre-existing edges, which
  is the finding the whole project exists to show.
