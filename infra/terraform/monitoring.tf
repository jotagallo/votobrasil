resource "aws_sns_topic" "alerts" {
  count = local.alerts_enabled ? 1 : 0
  name  = "${local.name}-alerts"
}

# The recipient must click the confirmation link AWS emails after apply.
resource "aws_sns_topic_subscription" "email" {
  count     = local.alerts_enabled ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# EnvironmentHealth: 0 Ok, 1 Info, 5 Unknown, 10 No data, 15 Warning, 20 Degraded, 25 Severe.
resource "aws_cloudwatch_metric_alarm" "environment_health" {
  count               = local.alerts_enabled ? 1 : 0
  alarm_name          = "${local.name}-eb-environment-health"
  alarm_description   = "Elastic Beanstalk environment ${local.name} is degraded or severe"
  namespace           = "AWS/ElasticBeanstalk"
  metric_name         = "EnvironmentHealth"
  dimensions          = { EnvironmentName = aws_elastic_beanstalk_environment.this.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 20
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# Account-wide budget: includes everything billed to the AWS account, not just this project.
resource "aws_budgets_budget" "monthly" {
  count        = local.alerts_enabled ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }
}
