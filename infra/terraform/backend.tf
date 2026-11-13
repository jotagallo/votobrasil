# Partial configuration: nothing account-specific lives in the repo.
# Supply the values at init time, e.g.:
#
#   terraform init \
#     -backend-config="bucket=<state-bucket>" \
#     -backend-config="key=votobr/prod/terraform.tfstate" \
#     -backend-config="region=<state-bucket-region>" \
#     -backend-config="encrypt=true" \
#     -backend-config="use_lockfile=true"   # Terraform >= 1.11; older: dynamodb_table=<lock-table>
#
# See infra/README.md ("Bootstrap") for creating the state bucket.
terraform {
  backend "s3" {}
}
