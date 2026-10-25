// Blast Radius — the one runnable check. `node --test`
// Asserts reach analysis against the committed example plan (spec.md > Components).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze, _internals } from "./reach.js";

const plan = JSON.parse(readFileSync(new URL("./demo/plan.json", import.meta.url), "utf8"));
const result = analyze(plan);
const find = (pred) => result.findings.filter(pred);

test("the example plan widens reach, and the counter can say so", () => {
  assert.equal(result.hasPrior, true, "example plan must carry prior_state");
  assert.ok(result.counts.prior >= 1);
  assert.ok(result.counts.planned > result.counts.prior, "the plan must widen reach");
  assert.equal(result.counts.delta, result.counts.planned - result.counts.prior);
});

test("the kernel: a widened existing edge is reported, not silently kept", () => {
  const widened = find((f) => f.widened);
  assert.ok(widened.length >= 1, "a pre-existing path that got broader must be reported");
  const bucket = widened.find((f) => f.target === "aws_s3_bucket.data");
  assert.ok(bucket, "ci role already reached the bucket; the s3:* grant must still surface");
  assert.equal(bucket.severity, "critical");
  assert.match(bucket.text, /already reached/);
});

test("severity rules fire, one tag per finding, correctly ordered", () => {
  const order = { critical: 0, high: 1, low: 2 };
  const seq = result.findings.map((f) => order[f.severity]);
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b), "findings must be severity-sorted");
  for (const f of result.findings) {
    assert.ok(["critical", "high", "low"].includes(f.severity));
    assert.ok(f.rule && f.rule.length > 0, "every finding names the rule that fired");
  }
  assert.ok(find((f) => f.rule === "new ingress from 0.0.0.0/0").length >= 1);
  assert.ok(find((f) => f.rule.startsWith("wildcard")).length >= 1);
});

test("open ingress is attributed to the internet, reaching the instance", () => {
  const net = find((f) => f.kind === "network" && f.root === "internet");
  assert.ok(net.length >= 1);
  assert.ok(net.some((f) => f.target === "aws_instance.app" && /tcp\/5432/.test(f.text)));
});

test("an IAM grant is not re-granted to whoever reaches its holder", () => {
  // The internet reaches aws_instance.app -> the CI role, but does not thereby
  // hold the role's s3:* permission. That would overclaim.
  const bogus = find((f) => f.root === "internet" && f.kind === "iam");
  assert.equal(bogus.length, 0, "network reach must not inherit IAM grants");
});

test("a Resource:* grant does not edge to unrelated services", () => {
  // s3:* / secretsmanager:GetSecretValue must not reach a security group.
  const nonsense = find((f) => f.kind === "iam" && f.target === "aws_security_group.app");
  assert.equal(nonsense.length, 0, "action service prefix must match the target ARN service");
});

test("the policy-evaluation limit is stated, not hidden", () => {
  assert.ok(result.caveats.some((c) => /conditions/i.test(c) && /boundaries/i.test(c)));
  assert.ok(result.caveats.some((c) => /root module only/i.test(c)));
});

test("bad input fails with a named error, never a TypeError", () => {
  assert.throws(() => analyze(null), /Not a Terraform plan/);
  assert.throws(() => analyze({ hello: "world" }), /expected format_version and planned_values/);
  assert.throws(() => analyze({ format_version: "1.2" }), /expected format_version and planned_values/);
});

test("ARN matching handles exact, bucket-prefix and wildcard patterns", () => {
  const { arnMatches } = _internals;
  assert.equal(arnMatches("*", "arn:aws:s3:::b"), true);
  assert.equal(arnMatches("arn:aws:s3:::b/*", "arn:aws:s3:::b"), true);
  assert.equal(arnMatches("arn:aws:s3:::b", "arn:aws:s3:::b"), true);
  assert.equal(arnMatches("arn:aws:s3:::other", "arn:aws:s3:::b"), false);
  assert.equal(arnMatches("arn:aws:iam::*:role/ci", "arn:aws:iam::111122223333:role/ci"), true);
});

test("a plan with no prior state still analyzes, and says why", () => {
  const greenfield = { ...plan, prior_state: undefined };
  const r = analyze(greenfield);
  assert.equal(r.hasPrior, false);
  assert.equal(r.counts.prior, null, "no prior state means no before-count to show");
  assert.ok(r.caveats.some((c) => /no prior state/i.test(c)));
  assert.ok(r.findings.length > 0);
});
