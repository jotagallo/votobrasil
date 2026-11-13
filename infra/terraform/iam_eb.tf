data "aws_iam_policy_document" "instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "service_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["elasticbeanstalk.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = ["elasticbeanstalk"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-eb-instance"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json
}

resource "aws_iam_role_policy_attachment" "instance_web_tier" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AWSElasticBeanstalkWebTier"
}

# Shell access through Session Manager instead of SSH keys and an open port 22.
resource "aws_iam_role_policy_attachment" "instance_ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# AWSElasticBeanstalkWebTier only covers the default elasticbeanstalk-* buckets.
data "aws_iam_policy_document" "instance_artifacts" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }
}

resource "aws_iam_role_policy" "instance_artifacts" {
  name   = "read-app-bundles"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance_artifacts.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-eb-instance"
  role = aws_iam_role.instance.name
}

resource "aws_iam_role" "service" {
  name               = "${local.name}-eb-service"
  assume_role_policy = data.aws_iam_policy_document.service_assume.json
}

resource "aws_iam_role_policy_attachment" "service_enhanced_health" {
  role       = aws_iam_role.service.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth"
}

resource "aws_iam_role_policy_attachment" "service_managed_updates" {
  role       = aws_iam_role.service.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy"
}

# Lets the application version lifecycle rule delete old versions together with their S3 bundles.
data "aws_iam_policy_document" "service_appversion_cleanup" {
  statement {
    actions   = ["elasticbeanstalk:DeleteApplicationVersion"]
    resources = [local.eb_app_versions_arn]
  }

  statement {
    actions   = ["s3:DeleteObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }
}

resource "aws_iam_role_policy" "service_appversion_cleanup" {
  name   = "appversion-lifecycle-cleanup"
  role   = aws_iam_role.service.id
  policy = data.aws_iam_policy_document.service_appversion_cleanup.json
}
