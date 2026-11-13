variable "aws_region" {
  description = "Region for every resource except CloudFront/ACM, which are global (certificates must be in us-east-1). us-east-1 is the cheapest region; sa-east-1 (Sao Paulo) lowers origin latency but costs roughly 40-60% more for EC2/EBS."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Short lowercase name used as a prefix for every resource."
  type        = string
  default     = "votobr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.project))
    error_message = "project must be 2-20 chars: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,11}$", var.environment))
    error_message = "environment must be 2-12 chars: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "instance_type" {
  description = "EC2 instance type of the single Elastic Beanstalk instance. Graviton (arm64, e.g. t4g.small) is ~20% cheaper than the x86 equivalent; x86 types also work."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume (gp3) size. Must fit the unzipped bundle (processed datasets) a few times over, since EB keeps the previous version on disk."
  type        = number
  default     = 20
}

variable "github_repository" {
  description = "GitHub repository allowed to deploy, as owner/repo."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/repo."
  }
}

variable "github_environment" {
  description = "GitHub Actions environment name the deploy job runs in; the OIDC subject claim is bound to it."
  type        = string
  default     = "production"
}

variable "github_additional_subjects" {
  description = "Extra OIDC subject claims allowed to assume the deploy role, e.g. [\"repo:owner/repo:ref:refs/heads/main\"] for jobs that run without a GitHub environment. Leave empty unless needed."
  type        = list(string)
  default     = []
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set to false if the account already has one (only one per URL is allowed per account); it is then looked up instead."
  type        = bool
  default     = true
}

variable "domain_name" {
  description = "Optional custom domain served by CloudFront (e.g. votobr.example.org). Requires acm_certificate_arn. DNS is not managed here: create a CNAME to the cloudfront_domain_name output."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN for domain_name. Must be issued in us-east-1 (CloudFront requirement). Empty uses the default *.cloudfront.net certificate."
  type        = string
  default     = ""

  validation {
    condition     = var.acm_certificate_arn == "" || can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[A-Za-z0-9-]+$", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be an ACM certificate ARN in us-east-1."
  }
}

variable "cloudfront_price_class" {
  description = "PriceClass_100 = North America + Europe, PriceClass_200 adds Asia/Middle East/Africa, PriceClass_All adds South America. Defaults to PriceClass_All because Brazilian users are only served from local edge locations (lower latency) with it; the extra cost is negligible within the free tier."
  type        = string
  default     = "PriceClass_All"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

variable "api_query_strings_allowlist" {
  description = "Query string names that form the cache key for /api/*. Empty means all query strings (every distinct URL is cached separately); set an allowlist once the API parameters are stable to stop cache-busting requests from reaching the origin."
  type        = list(string)
  default     = []
}

variable "alarm_email" {
  description = "Email for budget and environment-health alerts. Empty disables the budget, alarm and SNS topic."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly AWS account cost budget in USD; alerts at 80% and 100% when alarm_email is set."
  type        = number
  default     = 25
}
