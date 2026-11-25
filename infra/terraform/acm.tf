resource "aws_acm_certificate" "site" {
  count    = local.create_acm_certificate ? 1 : 0
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = local.redirect_www ? [local.www_domain] : []
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# CloudFront only accepts an issued certificate. The validation CNAMEs live in Route 53 with
# manage_dns, otherwise at the site's DNS provider.
resource "aws_acm_certificate_validation" "site" {
  count    = local.create_acm_certificate ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site[0].arn
  validation_record_fqdns = local.manage_dns ? [
    for record in aws_route53_record.acm_validation : record.fqdn
    ] : [
    for record in aws_acm_certificate.site[0].domain_validation_options : record.resource_record_name
  ]
}
