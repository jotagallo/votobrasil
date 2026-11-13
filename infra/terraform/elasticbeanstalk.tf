resource "aws_elastic_beanstalk_application" "this" {
  name        = local.name
  description = "VotoBrasil API and static web app (single bundle)"

  # EB caps an account at 1000 application versions; every deploy creates one.
  appversion_lifecycle {
    service_role          = aws_iam_role.service.arn
    max_count             = 25
    delete_source_from_s3 = true
  }

  depends_on = [aws_iam_role_policy.service_appversion_cleanup]
}

resource "aws_elastic_beanstalk_environment" "this" {
  name                   = local.name
  application            = aws_elastic_beanstalk_application.this.name
  solution_stack_name    = data.aws_elastic_beanstalk_solution_stack.node.name
  cname_prefix           = "${local.name}-${random_id.suffix.hex}"
  tier                   = "WebServer"
  wait_for_ready_timeout = "20m"

  # SingleInstance: one EC2 instance, no load balancer. Instance replacement and deploys cause a
  # short outage that CloudFront masks for cacheable responses.
  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "EnvironmentType"
    value     = "SingleInstance"
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "ServiceRole"
    value     = aws_iam_role.service.arn
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment:proxy"
    name      = "ProxyServer"
    value     = "nginx"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MinSize"
    value     = "1"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MaxSize"
    value     = "1"
  }

  setting {
    namespace = "aws:ec2:instances"
    name      = "InstanceTypes"
    value     = var.instance_type
  }

  setting {
    namespace = "aws:ec2:instances"
    name      = "SupportedArchitectures"
    value     = local.architecture
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "IamInstanceProfile"
    value     = aws_iam_instance_profile.instance.name
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "SecurityGroups"
    value     = aws_security_group.origin.id
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "DisableIMDSv1"
    value     = "true"
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "RootVolumeType"
    value     = "gp3"
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "RootVolumeSize"
    value     = tostring(var.root_volume_size_gb)
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "VPCId"
    value     = data.aws_vpc.default.id
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "Subnets"
    value     = join(",", data.aws_subnets.default.ids)
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "AssociatePublicIpAddress"
    value     = "true"
  }

  setting {
    namespace = "aws:elasticbeanstalk:healthreporting:system"
    name      = "SystemType"
    value     = "enhanced"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application"
    name      = "Application Healthcheck URL"
    value     = "/healthz"
  }

  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs"
    name      = "StreamLogs"
    value     = "true"
  }

  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs"
    name      = "DeleteOnTerminate"
    value     = "true"
  }

  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs"
    name      = "RetentionInDays"
    value     = "7"
  }

  # Minor/patch platform updates (OS patches, Node.js 22.x) in a low-traffic window (Sunday 04:00 BRT).
  setting {
    namespace = "aws:elasticbeanstalk:managedactions"
    name      = "ManagedActionsEnabled"
    value     = "true"
  }

  setting {
    namespace = "aws:elasticbeanstalk:managedactions"
    name      = "PreferredStartTime"
    value     = "Sun:07:00"
  }

  setting {
    namespace = "aws:elasticbeanstalk:managedactions:platformupdate"
    name      = "UpdateLevel"
    value     = "minor"
  }

  setting {
    namespace = "aws:elasticbeanstalk:managedactions:platformupdate"
    name      = "InstanceRefreshEnabled"
    value     = "false"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "NODE_ENV"
    value     = "production"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "LOG_LEVEL"
    value     = "info"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "TRUST_PROXY_HOPS"
    value     = "2" # CloudFront + the EB nginx proxy; makes rate limiting see the viewer IP
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "ORIGIN_VERIFY_SECRET"
    value     = random_password.origin_verify.result
  }

  # Managed updates move the platform forward on their own; Terraform must not fight them.
  lifecycle {
    ignore_changes = [solution_stack_name]
  }

  depends_on = [
    aws_iam_role_policy_attachment.instance_web_tier,
    aws_iam_role_policy_attachment.instance_ssm,
    aws_iam_role_policy.instance_artifacts,
    aws_iam_role_policy_attachment.service_enhanced_health,
    aws_iam_role_policy_attachment.service_managed_updates,
    aws_vpc_security_group_ingress_rule.cloudfront_http,
    aws_vpc_security_group_egress_rule.all,
  ]
}
