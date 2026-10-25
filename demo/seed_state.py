"""Build the baseline 'before' state for the Blast Radius example plan.

The baseline is the world a team already reviewed and accepted:
  - s3 bucket, Secrets Manager secret, CI role
  - the narrow ci_read policy (s3:GetObject on one bucket prefix)
  - an app security group reachable only from the office CIDR
  - the app instance and its instance profile

The plan under review then adds `aws_iam_role_policy.ci_admin` (s3:* on *) and
widens both SG ingress rules to 0.0.0.0/0. That is the reach delta the tool measures.

Synthetic state: well-formed, but no AWS account was contacted. `terraform plan
-refresh=false` reads it without making a single API call. Disclosed in the README.
"""
import json

AWS = 'provider["registry.terraform.io/hashicorp/aws"]'
OFFICE = "203.0.113.0/24"


def ingress(desc, port, cidr):
    return {
        "description": desc,
        "from_port": port,
        "to_port": port,
        "protocol": "tcp",
        "cidr_blocks": [cidr],
        "ipv6_cidr_blocks": [],
        "prefix_list_ids": [],
        "security_groups": [],
        "self": False,
    }


def res(type_, name, attrs):
    return {
        "mode": "managed",
        "type": type_,
        "name": name,
        "provider": AWS,
        "instances": [{"schema_version": 0, "attributes": attrs}],
    }


state = {
    "version": 4,
    "terraform_version": "1.13.1",
    "serial": 1,
    "lineage": "blast-radius-demo",
    "outputs": {},
    "resources": [
        res("aws_s3_bucket", "data", {
            "bucket": "br-demo-data",
            "arn": "arn:aws:s3:::br-demo-data",
            "id": "br-demo-data",
            "tags": {}, "tags_all": {},
        }),
        res("aws_secretsmanager_secret", "db", {
            "name": "br-demo-db-credentials",
            "arn": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:br-demo-db-credentials",
            "id": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:br-demo-db-credentials",
            "tags": {}, "tags_all": {},
        }),
        res("aws_iam_role", "ci", {
            "name": "br-demo-ci",
            "id": "br-demo-ci",
            "arn": "arn:aws:iam::111122223333:role/br-demo-ci",
            "assume_role_policy": json.dumps({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"Service": "ec2.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                }],
            }),
            "path": "/", "max_session_duration": 3600,
            "force_detach_policies": False,
            "inline_policy": [], "tags": {}, "tags_all": {},
        }),
        # The narrow policy that already existed and was accepted.
        res("aws_iam_role_policy", "ci_read", {
            "id": "br-demo-ci:br-demo-ci-read",
            "name": "br-demo-ci-read",
            "role": "br-demo-ci",
            "policy": json.dumps({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Action": ["s3:GetObject"],
                    "Resource": "arn:aws:s3:::br-demo-data/*",
                }],
            }),
        }),
        # Before: office-only access. The plan widens this to 0.0.0.0/0.
        res("aws_security_group", "app", {
            "id": "sg-0bd0d0c0ffee0001",
            "name": "br-demo-app",
            "description": "App tier",
            "arn": "arn:aws:ec2:ap-southeast-1:111122223333:security-group/sg-0bd0d0c0ffee0001",
            "ingress": [ingress("Postgres", 5432, OFFICE), ingress("SSH", 22, OFFICE)],
            "egress": [],
            "revoke_rules_on_delete": False,
            "tags": {}, "tags_all": {},
        }),
        res("aws_iam_instance_profile", "ci", {
            "id": "br-demo-ci",
            "name": "br-demo-ci",
            "role": "br-demo-ci",
            "arn": "arn:aws:iam::111122223333:instance-profile/br-demo-ci",
            "path": "/", "tags": {}, "tags_all": {},
        }),
        res("aws_instance", "app", {
            "id": "i-0ffee0ffee0ffee01",
            "ami": "ami-0b1b0b0b0b0b0b0b0",
            "instance_type": "t4g.micro",
            "arn": "arn:aws:ec2:ap-southeast-1:111122223333:instance/i-0ffee0ffee0ffee01",
            "vpc_security_group_ids": ["sg-0bd0d0c0ffee0001"],
            "iam_instance_profile": "br-demo-ci",
            "tags": {}, "tags_all": {},
        }),
    ],
}

with open("terraform.tfstate", "w") as fh:
    json.dump(state, fh, indent=1)
print(f"seeded {len(state['resources'])} baseline resources")
