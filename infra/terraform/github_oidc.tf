data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  # With a job-level `environment:`, GitHub puts the environment (not the branch) in the sub claim.
  # Restrict the branches that may deploy through the environment's deployment branch policy.
  github_subjects = concat(
    ["repo:${var.github_repository}:environment:${var.github_environment}"],
    var.github_additional_subjects,
  )
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-github-deploy"
  description          = "Assumed by GitHub Actions (OIDC) to deploy ${var.github_repository}"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  max_session_duration = 3600
}

# Elastic Beanstalk performs UpdateEnvironment with the caller's credentials against CloudFormation,
# Auto Scaling and EC2, so those services need a pragmatic (partly read-only, partly name-scoped)
# grant. If a deploy fails with AccessDenied, read the denied action from CloudTrail and extend the
# statements below instead of attaching AdministratorAccess-AWSElasticBeanstalk.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "UploadBundle"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }

  statement {
    sid       = "ListBundleBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts.arn]
  }

  statement {
    sid       = "BeanstalkWrite"
    actions   = ["elasticbeanstalk:CreateApplicationVersion", "elasticbeanstalk:UpdateEnvironment"]
    resources = [local.eb_application_arn, local.eb_app_versions_arn, local.eb_environment_arn]
  }

  # Read-only; several Describe* actions do not support resource-level scoping.
  statement {
    sid = "BeanstalkRead"
    actions = [
      "elasticbeanstalk:DescribeApplicationVersions",
      "elasticbeanstalk:DescribeConfigurationSettings",
      "elasticbeanstalk:DescribeEnvironmentResources",
      "elasticbeanstalk:DescribeEnvironments",
      "elasticbeanstalk:DescribeEvents",
    ]
    resources = ["*"]
  }

  # EB keeps its own per-account bucket for environment templates and staged versions.
  statement {
    sid       = "BeanstalkManagedBucket"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:GetBucketLocation"]
    resources = [local.eb_default_bucket, "${local.eb_default_bucket}/*"]
  }

  statement {
    sid = "UnderlyingServicesRead"
    actions = [
      "autoscaling:Describe*",
      "cloudformation:Describe*",
      "cloudformation:GetTemplate",
      "cloudformation:ListStackResources",
      "ec2:Describe*",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "UnderlyingStackUpdate"
    actions   = ["cloudformation:UpdateStack"]
    resources = ["arn:${local.partition}:cloudformation:${local.region}:${local.account_id}:stack/awseb-*/*"]
  }

  statement {
    sid = "UnderlyingAutoScalingUpdate"
    actions = [
      "autoscaling:UpdateAutoScalingGroup",
      "autoscaling:SetDesiredCapacity",
      "autoscaling:SuspendProcesses",
      "autoscaling:ResumeProcesses",
    ]
    resources = ["arn:${local.partition}:autoscaling:${local.region}:${local.account_id}:autoScalingGroup:*:autoScalingGroupName/awseb-*"]
  }

  statement {
    sid       = "PassBeanstalkRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.instance.arn, aws_iam_role.service.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["elasticbeanstalk.amazonaws.com", "ec2.amazonaws.com", "autoscaling.amazonaws.com"]
    }
  }

  statement {
    sid       = "InvalidateCdn"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.this.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
