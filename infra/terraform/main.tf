data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

# arm64 (Graviton) instance families end the generation digits with "g", e.g. t4g, m7g, c6gd.
locals {
  name               = "${var.project}-${var.environment}"
  architecture       = can(regex("^[a-z]+[0-9]+g[a-z]*\\.", var.instance_type)) ? "arm64" : "x86_64"
  custom_domain      = var.domain_name != ""
  custom_certificate = var.acm_certificate_arn != ""
  alerts_enabled     = var.alarm_email != ""
  partition          = data.aws_partition.current.partition
  account_id         = data.aws_caller_identity.current.account_id
  region             = data.aws_region.current.name
  origin_id          = "eb-${local.name}"

  eb_application_arn  = "arn:${local.partition}:elasticbeanstalk:${local.region}:${local.account_id}:application/${local.name}"
  eb_environment_arn  = "arn:${local.partition}:elasticbeanstalk:${local.region}:${local.account_id}:environment/${local.name}/${local.name}"
  eb_app_versions_arn = "arn:${local.partition}:elasticbeanstalk:${local.region}:${local.account_id}:applicationversion/${local.name}/*"
  eb_default_bucket   = "arn:${local.partition}:s3:::elasticbeanstalk-${local.region}-${local.account_id}"
}

# Latest Node.js 22 platform on Amazon Linux 2023. One platform covers x86_64 and arm64;
# the architecture is selected through the instance type. Keep the major in sync with .nvmrc.
data "aws_elastic_beanstalk_solution_stack" "node" {
  most_recent = true
  name_regex  = "^64bit Amazon Linux 2023 (.*) running Node.js 22$"
}

# Default VPC with public subnets: no NAT gateway or load balancer to pay for.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "random_id" "suffix" {
  byte_length = 3
}

# Shared secret between CloudFront (custom origin header) and the API (ORIGIN_VERIFY_SECRET).
# Lives only in Terraform state and in the EB/CloudFront configuration, never in the repo.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}
