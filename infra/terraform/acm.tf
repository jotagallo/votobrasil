resource "aws_acm_certificate" "site" {
  count    = local.create_acm_certificate ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# CloudFront only accepts an issued certificate. The CNAME lives at the site's DNS provider.
resource "aws_acm_certificate_validation" "site" {
  count    = local.create_acm_certificate ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [
    for record in aws_acm_certificate.site[0].domain_validation_options : record.resource_record_name
  ]
}
