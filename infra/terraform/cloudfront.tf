data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# All three policies honour the origin's Cache-Control (min TTL 0) and use the default TTL only
# when the origin sends none. Nothing but Accept-Encoding (and, for the API, query strings) is part
# of the cache key, so no cookies or headers ever reach the origin.

# index.html (no-cache at the origin), SPA routes and small static files.
resource "aws_cloudfront_cache_policy" "web" {
  name        = "${local.name}-web"
  comment     = "Honour origin Cache-Control; 1h fallback"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Content-hashed Vite output. The origin sends max-age=31536000, immutable; the 1-day fallback
# keeps an accidental header-less 404 from being cached for a year.
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${local.name}-assets"
  comment     = "Hashed static assets; up to 1 year"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Immutable datasets carry a long s-maxage and an ETag; stale entries revalidate with If-None-Match.
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${local.name}-api"
  comment     = "API: honour origin Cache-Control; query strings in cache key"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = length(var.api_query_strings_allowlist) == 0 ? "all" : "whitelist"

      dynamic "query_strings" {
        for_each = length(var.api_query_strings_allowlist) == 0 ? [] : [1]

        content {
          items = var.api_query_strings_allowlist
        }
      }
    }
  }
}

# The app owns the Content-Security-Policy; only transport/browser hardening is set here.
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.name}-security"
  comment = "HSTS, nosniff, frame deny, referrer policy"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
      override = false
    }
  }
}

# Unknown SPA routes are not rewritten with a distribution-wide custom error response: it cannot be
# scoped per path and would turn API 404s into index.html. The origin does the SPA fallback instead.
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = var.cloudfront_price_class
  comment         = "${local.name} (Elastic Beanstalk origin)"
  aliases         = local.custom_domain ? [var.domain_name] : []

  origin {
    origin_id   = local.origin_id
    domain_name = aws_elastic_beanstalk_environment.this.cname

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.web.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.assets.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # Always reaches the origin so that deploy smoke tests see the real state.
  ordered_cache_behavior {
    path_pattern               = "/healthz"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.custom_certificate ? null : true
    acm_certificate_arn            = local.custom_certificate ? var.acm_certificate_arn : null
    ssl_support_method             = local.custom_certificate ? "sni-only" : null
    minimum_protocol_version       = local.custom_certificate ? "TLSv1.2_2021" : null
  }

  lifecycle {
    precondition {
      condition     = local.custom_domain == local.custom_certificate
      error_message = "domain_name and acm_certificate_arn must be set together (or both left empty)."
    }
  }
}
