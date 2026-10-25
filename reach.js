// Blast Radius — reach analysis over a Terraform plan JSON.
// Pure: no DOM, no I/O. See devpost/spec.md > Components.

const DATA_STORES = new Set([
  "aws_s3_bucket", "aws_db_instance", "aws_rds_cluster", "aws_dynamodb_table",
  "aws_ebs_volume", "aws_secretsmanager_secret", "aws_ssm_parameter",
  "aws_efs_file_system", "aws_redshift_cluster", "aws_elasticache_cluster",
]);
const PRINCIPALS = new Set(["aws_iam_role", "aws_iam_user"]);
const ANY_CIDR = new Set(["0.0.0.0/0", "::/0"]);
const INTERNET = "internet";

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Resource list of one "world" (prior or planned), keyed by address. */
function worldOf(resources) {
  const byAddr = new Map();
  for (const r of resources || []) byAddr.set(r.address, { ...r, values: r.values || {} });
  return byAddr;
}

/** An IAM Resource pattern matches a concrete ARN. Prefix/wildcard only — see
 *  spec.md > What Was Simplified and Why. Conditions are not evaluated. */
function arnMatches(pattern, arn) {
  if (!pattern || !arn) return false;
  if (pattern === "*") return true;
  if (pattern.replace(/\/\*$/, "") === arn) return true; // bucket/* names the bucket
  const rx = new RegExp("^" + pattern.split("*").map(escapeRx).join(".*") + "$");
  return rx.test(arn);
}
const escapeRx = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** The service prefix of an action ("s3:*" -> "s3") must match the ARN's service
 *  ("arn:aws:s3:::bucket" -> "s3"), otherwise a Resource:"*" grant edges to everything. */
function serviceOfArn(arn) {
  return (arn || "").split(":")[2] || "";
}
const ARN_SERVICE_ALIASES = { secretsmanager: "secretsmanager", ssm: "ssm", rds: "rds" };
function actionAppliesTo(actions, arn) {
  const svc = ARN_SERVICE_ALIASES[serviceOfArn(arn)] ?? serviceOfArn(arn);
  return actions.some((a) => {
    if (a === "*") return true;
    const prefix = a.split(":")[0];
    return prefix === "*" || prefix === svc;
  });
}

function parsePolicy(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Reference edges from the config graph, kept only where both ends exist in `world`.
 *  Config describes the planned configuration, so restricting endpoints to the prior
 *  world is how prior reference edges are inferred. Stated in caveats. */
function referenceEdges(plan, world) {
  const out = [];
  for (const r of plan.configuration?.root_module?.resources || []) {
    if (!world.has(r.address)) continue;
    for (const [attr, expr] of Object.entries(r.expressions || {})) {
      for (const ref of expr?.references || []) {
        const target = toAddress(ref, world);
        if (!target || target === r.address) continue;
        out.push({
          from: r.address, to: target, kind: "reference",
          label: attr,
          source: `configuration > ${r.address} > expressions.${attr}.references`,
        });
      }
    }
  }
  return dedupe(out);
}

/** "aws_s3_bucket.data.arn" -> "aws_s3_bucket.data" (only if that address exists). */
function toAddress(ref, world) {
  const parts = ref.split(".");
  for (let n = parts.length; n >= 2; n--) {
    const candidate = parts.slice(0, n).join(".");
    if (world.has(candidate)) return candidate;
  }
  return null;
}

/** IAM edges: an inline role policy grants actions on resources, so the role reaches them. */
function iamEdges(world, caveats) {
  const out = [];
  const roleByName = new Map();
  for (const [addr, r] of world) {
    if (PRINCIPALS.has(r.type)) roleByName.set(r.values.name ?? r.values.id, addr);
  }

  for (const [addr, r] of world) {
    if (r.type !== "aws_iam_role_policy" && r.type !== "aws_iam_policy") continue;
    const doc = parsePolicy(r.values.policy);
    if (!doc) {
      caveats.push(`Could not parse the policy document on ${addr}; its grants are not in the graph.`);
      continue;
    }
    const holder = roleByName.get(r.values.role) ?? r.values.role;
    if (!world.has(holder)) continue;

    asArray(doc.Statement).forEach((st, i) => {
      if ((st.Effect || "Allow") !== "Allow") return;
      const actions = asArray(st.Action);
      for (const pattern of asArray(st.Resource)) {
        for (const [tAddr, t] of world) {
          if (tAddr === holder || !t.values.arn) continue;
          if (!arnMatches(pattern, t.values.arn)) continue;
          if (!actionAppliesTo(actions, t.values.arn)) continue;
          out.push({
            from: holder, to: tAddr, kind: "iam", grant: true,
            label: actions.join(", "),
            actions, resourcePattern: pattern, via: addr,
            source: `${addr} > policy > Statement[${i}]`,
          });
        }
      }
    });
  }
  return dedupe(out);
}

/** Security-group edges: open ingress makes everything using that group reachable. */
function sgEdges(world) {
  const out = [];
  for (const [sgAddr, sg] of world) {
    if (sg.type !== "aws_security_group") continue;
    const attached = [...world].filter(([, r]) =>
      asArray(r.values.vpc_security_group_ids).includes(sg.values.id) ||
      asArray(r.values.security_groups).includes(sg.values.id));

    asArray(sg.values.ingress).forEach((rule, i) => {
      const open = asArray(rule.cidr_blocks).concat(asArray(rule.ipv6_cidr_blocks))
        .filter((c) => ANY_CIDR.has(c));
      const cidrs = open.length ? open : asArray(rule.cidr_blocks);
      if (!cidrs.length) return;
      const port = rule.from_port === rule.to_port
        ? `${rule.from_port}` : `${rule.from_port}-${rule.to_port}`;
      for (const [tAddr] of attached) {
        out.push({
          from: open.length ? INTERNET : `cidr:${cidrs[0]}`,
          to: tAddr, kind: "network",
          label: `${rule.protocol}/${port} from ${cidrs.join(", ")}`,
          openToWorld: open.length > 0, port, cidrs,
          source: `${sgAddr} > ingress[${i}]`,
        });
      }
    });
  }
  return dedupe(out);
}

/** An instance assumes its instance profile's role, so it reaches what the role reaches. */
function instanceProfileEdges(world) {
  const out = [];
  const profileByName = new Map();
  for (const [addr, r] of world) {
    if (r.type === "aws_iam_instance_profile") profileByName.set(r.values.name ?? r.values.id, addr);
  }
  const roleByName = new Map();
  for (const [addr, r] of world) {
    if (PRINCIPALS.has(r.type)) roleByName.set(r.values.name ?? r.values.id, addr);
  }
  for (const [addr, r] of world) {
    const profName = r.values.iam_instance_profile;
    if (!profName) continue;
    const profAddr = profileByName.get(profName);
    if (!profAddr) continue;
    const roleAddr = roleByName.get(world.get(profAddr).values.role);
    if (!roleAddr) continue;
    out.push({
      from: addr, to: roleAddr, kind: "assume",
      label: "instance profile",
      source: `${addr} > iam_instance_profile -> ${profAddr} > role`,
    });
  }
  return dedupe(out);
}

const edgeKey = (e) => `${e.from}|${e.to}|${e.kind}|${e.label}`;
function dedupe(edges) {
  const seen = new Map();
  for (const e of edges) if (!seen.has(edgeKey(e))) seen.set(edgeKey(e), e);
  return [...seen.values()];
}

/** Every (principal, resource) pair reachable by walking edges from each principal. */
function reachPairs(edges, roots) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  }
  const pairs = new Map(); // "root->target" -> first edge that got us there
  for (const root of roots) {
    const queue = [[root, null]];
    const seen = new Set([root]);
    while (queue.length) {
      const [node, firstEdge] = queue.shift();
      for (const e of adj.get(node) || []) {
        if (seen.has(e.to)) continue;
        // An IAM grant belongs to its holder. Reaching the holder over the network
        // does not re-grant it to the caller; the chain is reported separately.
        if (e.grant && node !== root) continue;
        seen.add(e.to);
        const key = `${root}->${e.to}`;
        const existing = pairs.get(key);
        const broader = !existing || (e.kind === "iam" &&
          ((e.actions || []).some((a) => a.includes("*")) || e.resourcePattern === "*") &&
          !((existing.hop.actions || []).some((a) => a.includes("*")) || existing.hop.resourcePattern === "*"));
        if (broader) pairs.set(key, { root, target: e.to, edge: firstEdge || e, hop: e });
        queue.push([e.to, firstEdge || e]);
      }
    }
  }
  return pairs;
}

function rootsOf(world, edges) {
  const roots = [...world].filter(([, r]) => PRINCIPALS.has(r.type)).map(([a]) => a);
  if (edges.some((e) => e.from === INTERNET)) roots.push(INTERNET);
  return roots;
}

function edgesFor(plan, world, caveats) {
  return dedupe([
    ...referenceEdges(plan, world),
    ...iamEdges(world, caveats),
    ...sgEdges(world),
    ...instanceProfileEdges(world),
  ]);
}

/** Severity: the first rule that matches. See prd.md > Severity — three rules. */
function severityFor(pair, world) {
  const e = pair.hop;
  if (e.kind === "iam") {
    const wildcardAction = (e.actions || []).some((a) => a.includes("*"));
    const wildcardResource = (e.resourcePattern || "").includes("*") &&
      e.resourcePattern.replace(/\/\*$/, "") !== world.get(pair.target)?.values?.arn;
    if (wildcardAction || e.resourcePattern === "*") {
      return { severity: "critical", rule: "wildcard in IAM Action or Resource" };
    }
    if (wildcardResource) return { severity: "critical", rule: "wildcard in IAM Action or Resource" };
  }
  if (e.kind === "network" && e.openToWorld) {
    return { severity: "critical", rule: "new ingress from 0.0.0.0/0" };
  }
  if (DATA_STORES.has(world.get(pair.target)?.type)) {
    return { severity: "high", rule: "new path to a data store" };
  }
  return { severity: "low", rule: "newly reachable" };
}

const ORDER = { critical: 0, high: 1, low: 2 };

/** Was the planned grant broader than the prior one for the same pair? */
function widened(before, after) {
  if (!before || !after || before.kind !== "iam" || after.kind !== "iam") return null;
  const wildNow = (after.actions || []).some((a) => a.includes("*")) || after.resourcePattern === "*";
  const wildBefore = (before.actions || []).some((a) => a.includes("*")) || before.resourcePattern === "*";
  if (wildNow && !wildBefore) return "wildcard in IAM Action or Resource";
  const gained = (after.actions || []).filter((a) => !(before.actions || []).includes(a));
  if (gained.length) return "additional IAM actions on a path that already existed";
  if (before.resourcePattern !== after.resourcePattern &&
      after.resourcePattern.includes("*")) return "broader IAM Resource pattern";
  return null;
}

function describe(pair, world, sev) {
  const e = pair.hop;
  const target = pair.target;
  const subject = pair.root === INTERNET ? "The public internet" : pair.root;
  if (e.kind === "iam") {
    return `${subject} can now ${e.actions.join(", ")} on ${target} (${e.resourcePattern})`;
  }
  if (e.kind === "network") {
    return `${subject} can now reach ${target} on ${e.label}`;
  }
  if (e.kind === "assume") {
    return `${subject} can now assume the role attached to ${target}`;
  }
  return `${subject} can now reach ${target} via ${e.label}`;
}

/**
 * Analyze a `terraform show -json <planfile>` document.
 * @throws {Error} with a named message when the input is not a Terraform plan.
 */
export function analyze(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Not a Terraform plan: expected a JSON object.");
  }
  if (!plan.format_version || !plan.planned_values) {
    throw new Error("Not a Terraform plan: expected format_version and planned_values. " +
      "Generate it with `terraform show -json <planfile>`.");
  }

  const caveats = [
    "Reach is as asserted by the policy documents in this plan. IAM conditions, " +
    "permission boundaries, SCPs and explicit denies are not evaluated.",
    "Root module only: child modules and for_each/count expansion are not followed.",
  ];

  const planned = worldOf(plan.planned_values?.root_module?.resources);
  const prior = worldOf(plan.prior_state?.values?.root_module?.resources);
  const hasPrior = prior.size > 0;
  if (!hasPrior) {
    caveats.push("This plan has no prior state, so every path below is new by definition.");
  }

  const plannedEdges = edgesFor(plan, planned, caveats);
  const priorEdges = hasPrior ? edgesFor(plan, prior, []) : [];

  const plannedPairs = reachPairs(plannedEdges, rootsOf(planned, plannedEdges));
  const priorPairs = reachPairs(priorEdges, rootsOf(prior, priorEdges));

  const findings = [];
  for (const [key, pair] of plannedPairs) {
    const was = priorPairs.get(key);
    if (was) {
      // The path existed. Report it only if this plan made it broader — the kernel:
      // a five-line policy change that widens an already-approved edge.
      const rule = widened(was.hop, pair.hop);
      if (!rule) continue;
      const sev = rule.startsWith("wildcard") ? "critical"
        : DATA_STORES.has(planned.get(pair.target)?.type) ? "high" : "low";
      findings.push({
        id: key, root: pair.root, target: pair.target,
        severity: sev, rule, widened: true,
        text: `${pair.root} already reached ${pair.target} (${(was.hop.actions || [was.hop.label]).join(", ")}) ` +
              `and can now ${(pair.hop.actions || [pair.hop.label]).join(", ")} on ${pair.hop.resourcePattern || pair.target}`,
        source: pair.hop.source, kind: pair.hop.kind, unknown: false,
      });
      continue;
    }
    const sev = severityFor(pair, planned);
    findings.push({
      id: key,
      root: pair.root,
      target: pair.target,
      severity: sev.severity,
      rule: sev.rule,
      text: describe(pair, planned, sev),
      source: pair.hop.source,
      kind: pair.hop.kind,
      widened: false,
      unknown: pair.hop.unknown === true,
    });
  }
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));

  const priorNodes = new Set([...priorPairs.values()].map((p) => p.target));
  const changed = new Set((plan.resource_changes || [])
    .filter((c) => !c.change.actions.every((a) => a === "no-op"))
    .map((c) => c.address));

  const nodes = [...new Set([...planned.keys(), ...prior.keys(),
    ...plannedEdges.filter((e) => e.from === INTERNET).map(() => INTERNET)])]
    .map((address) => ({
      address,
      type: planned.get(address)?.type ?? prior.get(address)?.type ?? "internet",
      isPrincipal: PRINCIPALS.has(planned.get(address)?.type ?? prior.get(address)?.type) || address === INTERNET,
      inPrior: prior.has(address) || (address === INTERNET && priorEdges.some((e) => e.from === INTERNET)),
      reachedBefore: priorNodes.has(address),
      changed: changed.has(address),
    }));

  return {
    counts: {
      prior: hasPrior ? priorPairs.size : null,
      planned: plannedPairs.size,
      delta: hasPrior ? plannedPairs.size - priorPairs.size : null,
      newFindings: findings.length,
    },
    nodes,
    edges: plannedEdges,
    priorEdges,
    findings,
    caveats,
    hasPrior,
  };
}

export const _internals = { arnMatches, toAddress, reachPairs, severityFor };
