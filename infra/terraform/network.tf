# The only inbound path to the instance is CloudFront. Direct hits on the EB CNAME or the
# public IP are dropped at the security group, and the API additionally checks x-origin-verify.
# The CloudFront prefix list counts as ~55 rules against the default 60-rule security group quota.
resource "aws_security_group" "origin" {
  name_prefix = "${local.name}-origin-"
  description = "HTTP from CloudFront origin-facing addresses only"
  vpc_id      = data.aws_vpc.default.id

  tags = {
    Name = "${local.name}-origin"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "cloudfront_http" {
  security_group_id = aws_security_group.origin.id
  description       = "HTTP from CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.origin.id
  description       = "Outbound for EB agent, SSM, CloudWatch and package mirrors"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
