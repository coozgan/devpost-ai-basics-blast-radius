terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-southeast-1"
}

# --- Data stores that already exist in the baseline state ---

resource "aws_s3_bucket" "data" {
  bucket = "br-demo-data"
}

resource "aws_secretsmanager_secret" "db" {
  name = "br-demo-db-credentials"
}

# --- The CI role: exists in baseline, gains reach in this plan ---

resource "aws_iam_role" "ci" {
  name = "br-demo-ci"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# The narrow read the team already reviewed and accepted.
resource "aws_iam_role_policy" "ci_read" {
  name = "br-demo-ci-read"
  role = aws_iam_role.ci.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.data.arn}/*"
    }]
  })
}

# The lines under review: looks like a small convenience, grants s3:* on everything.
resource "aws_iam_role_policy" "ci_admin" {
  name = "br-demo-ci-admin"
  role = aws_iam_role.ci.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:*", "secretsmanager:GetSecretValue"]
      Resource = "*"
    }]
  })
}

# --- Network: the app SG gains internet-facing ingress ---

resource "aws_security_group" "app" {
  name        = "br-demo-app"
  description = "App tier"

  ingress {
    description = "Postgres"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  ami                    = "ami-0b1b0b0b0b0b0b0b0"
  instance_type          = "t4g.micro"
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ci.name
}

resource "aws_iam_instance_profile" "ci" {
  name = "br-demo-ci"
  role = aws_iam_role.ci.name
}
