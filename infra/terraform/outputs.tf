output "cloudfront_domain_name" {
  description = "Public entry point. Point a CNAME here when using domain_name."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (CLOUDFRONT_DISTRIBUTION_ID in GitHub)."
  value       = aws_cloudfront_distribution.this.id
}

output "site_url" {
  description = "Public URL of the site (SITE_URL in GitHub)."
  value       = local.custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "eb_application_name" {
  description = "Elastic Beanstalk application name (EB_APPLICATION in GitHub)."
  value       = aws_elastic_beanstalk_application.this.name
}

output "eb_environment_name" {
  description = "Elastic Beanstalk environment name (EB_ENVIRONMENT in GitHub)."
  value       = aws_elastic_beanstalk_environment.this.name
}

output "eb_environment_cname" {
  description = "Origin hostname behind CloudFront (not reachable directly: security group + origin secret)."
  value       = aws_elastic_beanstalk_environment.this.cname
}

output "artifacts_bucket" {
  description = "S3 bucket for application bundles (ARTIFACTS_BUCKET in GitHub)."
  value       = aws_s3_bucket.artifacts.bucket
}

output "deploy_role_arn" {
  description = "IAM role assumed by GitHub Actions through OIDC (AWS_ROLE_ARN in GitHub)."
  value       = aws_iam_role.deploy.arn
}

output "aws_region" {
  description = "Region of the Elastic Beanstalk environment (AWS_REGION in GitHub)."
  value       = var.aws_region
}
