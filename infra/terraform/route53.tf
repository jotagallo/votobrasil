# Only DNS hosting moves to AWS; the domain stays at its registrar, which must point its name
# servers to this zone (output route53_name_servers). Apply the zone first (docs/DEPLOY.md, Etapa 10)
# so that the delegation is in place before Terraform waits for the certificate.
resource "aws_route53_zone" "site" {
  count = local.manage_dns ? 1 : 0

  name    = var.domain_name
  comment = "${local.name} public DNS"
}

locals {
  acm_validation_options = {
    for option in flatten(aws_acm_certificate.site[*].domain_validation_options) : option.domain_name => option
  }
}

# Kept after issuance: ACM uses the same records for automatic renewal. Keyed by hostname, which is
# known at plan time (the certificate's validation options are not).
resource "aws_route53_record" "acm_validation" {
  for_each = local.manage_dns && local.create_acm_certificate ? toset(local.site_hostnames) : toset([])

  zone_id         = aws_route53_zone.site[0].zone_id
  name            = local.acm_validation_options[each.key].resource_record_name
  type            = local.acm_validation_options[each.key].resource_record_type
  records         = [local.acm_validation_options[each.key].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# ALIAS records work at the zone apex, where a CNAME is not allowed.
resource "aws_route53_record" "site" {
  for_each = local.manage_dns ? {
    for pair in setproduct(local.site_hostnames, ["A", "AAAA"]) : "${pair[0]} ${pair[1]}" => {
      name = pair[0]
      type = pair[1]
    }
  } : {}

  zone_id = aws_route53_zone.site[0].zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
