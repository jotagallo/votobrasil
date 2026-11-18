# Guia de deploy na AWS (primeira vez)

Este guia leva você de uma conta AWS vazia até o VotoBrasil no ar em uma URL `https://xxxx.cloudfront.net`, com deploy automático a cada merge na `main`. Foi escrito para quem **nunca montou uma infraestrutura automatizada**: cada etapa diz o que fazer, o que esperar e como saber que deu certo.

A referência técnica (em inglês) é o [`infra/README.md`](../infra/README.md); aqui está o passo a passo.

> **Leia antes de começar: o que foi e o que não foi testado**
>
> **Verificado sem acesso à AWS:** o CI valida `terraform fmt`/`validate` e constrói a imagem Docker; o pacote de deploy (`dist/bundle.zip`) foi gerado e o servidor rodou localmente em modo produção (proteção de origem, cabeçalhos de cache, `/healthz`); os SHAs das GitHub Actions, os ARNs das políticas gerenciadas e o nome do _solution stack_ Node.js 22 do Elastic Beanstalk conferem com a documentação da AWS.
>
> **Nunca aplicado em uma conta real:** o `terraform apply` completo, as permissões do papel de deploy do GitHub, a verificação de contas novas do CloudFront e o download dos dados do TSE/IBGE a partir dos servidores do GitHub. Por isso o roteiro tem um teste intermediário (Etapa 8) e a seção [Problemas comuns](#problemas-comuns) lista as falhas mais prováveis. É normal precisar de um ou dois ajustes na primeira vez.

## Visão geral

**O que é automático e o que não é.** O deploy da _aplicação_ é automático (merge na `main` → CI → deploy). Mudanças na _infraestrutura_ (arquivos `.tf`) **não** são aplicadas pelo pipeline: você roda `make tf-plan` e `make tf-apply` no seu Mac, de propósito, para que nenhuma credencial administrativa fique no GitHub. Os **dados oficiais** (download e ETL do TSE/IBGE) só são processados durante o Deploy, no GitHub, e apenas quando o cache deles não existe; não há nenhuma tarefa agendada (detalhes em _Operação do dia a dia_).

**O que você faz à mão (uma vez):** conta AWS com MFA e um usuário administrador; instalar as ferramentas; criar **um** bucket S3 (guarda o "estado" do Terraform); configurar o repositório no GitHub; opcionalmente, domínio e certificado.

**O que o Terraform cria sozinho (cerca de 35 recursos):** CloudFront; Elastic Beanstalk com 1 instância; bucket S3 dos pacotes de deploy; papéis IAM (instância, Elastic Beanstalk e o papel que o GitHub assume); regra de firewall que só aceita tráfego do CloudFront; alarme de saúde e orçamento por e-mail (opcionais).

```
Navegador ──HTTPS──► CloudFront (cache) ──HTTP + segredo──► Elastic Beanstalk (1 instância)
                                                              └─ API Fastify + SPA + dados

GitHub Actions ──OIDC (sem chaves)──► papel de deploy ──► S3 + Elastic Beanstalk + CloudFront
```

- **Custo:** cerca de **US$ 18/mês** (instância ≈ 12, disco ≈ 2, IPv4 ≈ 4, logs ≈ 0,5; CloudFront no nível gratuito). Detalhes em [`infra/README.md`](../infra/README.md).
- **Tempo (estimativa):** 2 a 3 horas na primeira vez, quase tudo esperando: `apply` de 15 a 25 min; primeiro deploy automático de cerca de 1 h, por causa do ETL.

**Roteiro**

1. Conta AWS e usuário administrador
2. Ferramentas no Mac
3. Credenciais no terminal e pré-checagens
4. Bucket do estado do Terraform
5. Criar a infraestrutura (`terraform apply`)
6. Primeiro deploy, manual
7. Configurar o GitHub
8. Testar o deploy automático (sem ETL)
9. Ligar o deploy automático
10. (Opcional) Domínio próprio
11. Checklist final

**Glossário em 1 minuto**

| Termo               | Significa                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Terraform           | Lê os arquivos `infra/terraform/*.tf` e cria/atualiza os recursos na AWS.                                            |
| Estado (_state_)    | Arquivo onde o Terraform anota o que já criou. Fica em um bucket S3 seu; não apague.                                 |
| Elastic Beanstalk   | Serviço que sobe a instância, instala o app e monitora a saúde.                                                      |
| CloudFront          | CDN: entrega HTTPS, guarda respostas em cache e é o único que consegue falar com a instância.                        |
| Bundle              | O `dist/bundle.zip`: API + SPA + dados processados. É o que vai para a instância.                                    |
| OIDC                | O GitHub prova à AWS "sou o repositório X, ambiente `production`" e recebe credenciais temporárias. Sem senha/chave. |
| Versão da aplicação | Um bundle registrado no Elastic Beanstalk com um rótulo (_version label_). Rollback = reimplantar um rótulo antigo.  |

## Etapa 1: Conta AWS e usuário administrador

1. **Crie a conta** em <https://aws.amazon.com> (e-mail, cartão e telefone). Contas criadas a partir de 15/07/2025 começam no plano **Free**, que é encerrado em até 6 meses (ou quando os créditos acabam) e restringe serviços. Para um site que deve ficar no ar, faça o upgrade para o plano **Paid** no console de _Billing_ (os créditos são mantidos).
2. **Ative MFA no usuário root:** console → nome da conta (canto superior direito) → _Security credentials_ → _Assign MFA device_. Depois disso, não use o root no dia a dia e nunca crie chaves de acesso para ele.
3. **Escolha a região** _US East (N. Virginia) us-east-1_ no seletor do console. Todo o guia assume `us-east-1`.
4. **Crie uma identidade administradora** para o terminal. Ela só será usada até a Etapa 8. Escolha uma opção:

   **Opção A (recomendada pela AWS): IAM Identity Center**, login SSO com credenciais temporárias.
   1. Console → _IAM Identity Center_ → _Enable_.
   2. _Users_ → _Add user_ (seu e-mail) e defina a senha pelo e-mail recebido.
   3. _Permission sets_ → _Create permission set_ → _Predefined_ → `AdministratorAccess`.
   4. _AWS accounts_ → marque sua conta → _Assign users or groups_ → seu usuário + o _permission set_.

   **Opção B (mais curta): usuário IAM com chave de acesso.**
   1. Console → _IAM_ → _Users_ → _Create user_ → nome `votobr-admin` (sem acesso ao console).
   2. _Attach policies directly_ → `AdministratorAccess` → _Create user_.
   3. Abra o usuário → _Security credentials_ → _Create access key_ → caso de uso _Command Line Interface (CLI)_. Guarde o _Access key ID_ e o _Secret access key_ (o segredo só aparece uma vez).
   4. **Apague essa chave no fim da Etapa 8**: a automação do GitHub nunca usa chaves.

**Como saber que deu certo:** depois da Etapa 3, `aws sts get-caller-identity` mostra o número da conta (12 dígitos).

## Etapa 2: Ferramentas no Mac

> **Dica para colar os comandos:** o terminal padrão do macOS (zsh) não aceita comentários (`# ...`) em comandos colados e trata o texto depois do `#` como argumentos. Rode uma vez `echo 'setopt interactive_comments' >> ~/.zshrc`, abra um terminal novo e só então cole os blocos deste guia.

```bash
brew install awscli gh
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
nvm install 22 && nvm use 22     # o .nvmrc do repositório pede Node 22
npm ci                           # na raiz do repositório, se ainda não instalou as dependências
gh auth login                    # se `gh auth status` disser que você não está logado
```

`brew install terraform` **não funciona mais** (a fórmula saiu do repositório principal do Homebrew); use o tap oficial da HashiCorp, como acima. O `Makefile` exige Terraform **1.11 ou maior** (usa `use_lockfile` para o bloqueio do estado).

**Como saber que deu certo:**

```bash
terraform version    # v1.11 ou maior
aws --version        # aws-cli/2.x
gh auth status       # logado em github.com
node -v              # v22.x
```

## Etapa 3: Credenciais no terminal e pré-checagens

Configure um perfil chamado `votobr`, conforme a opção escolhida na Etapa 1.

**Opção A (SSO):** siga as perguntas (URL do portal, região, conta, papel) e repita o `login` sempre que a sessão expirar.

```bash
aws configure sso --profile votobr
aws sso login --profile votobr
```

**Opção B (chave de acesso):** cole o _Access Key ID_ e o _Secret access key_; região `us-east-1`; formato `json`.

```bash
aws configure --profile votobr
```

Depois, em **cada terminal novo** (as variáveis `export` valem só para o terminal atual):

```bash
export AWS_PROFILE=votobr AWS_REGION=us-east-1
aws sts get-caller-identity
```

**Pré-checagens** (1 minuto; evitam dois erros comuns do `apply`):

```bash
# 1) Existe VPC padrão? O Elastic Beanstalk usa a VPC padrão. Deve imprimir vpc-xxxxxxxx.
aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text
# Se imprimir "None": aws ec2 create-default-vpc

# 2) A conta já tem o provedor OIDC do GitHub? Normalmente a lista vem vazia.
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text
# Se aparecer ...oidc-provider/token.actions.githubusercontent.com,
# use create_github_oidc_provider = false no terraform.tfvars (Etapa 5).
```

## Etapa 4: Bucket do estado do Terraform

O Terraform precisa de um lugar para guardar o estado **antes** de criar qualquer coisa, então este é o único recurso criado à mão. O bucket é privado, versionado e criptografado:

```bash
export TF_BACKEND_REGION=us-east-1
export TF_BACKEND_BUCKET="votobr-tfstate-$(aws sts get-caller-identity --query Account --output text)"

aws s3api create-bucket --bucket "$TF_BACKEND_BUCKET" --region "$TF_BACKEND_REGION"
aws s3api put-public-access-block --bucket "$TF_BACKEND_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$TF_BACKEND_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$TF_BACKEND_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

(Fora de `us-east-1`, acrescente `--create-bucket-configuration LocationConstraint=<região>` ao primeiro comando.)

**Como saber que deu certo:** `aws s3api get-bucket-versioning --bucket "$TF_BACKEND_BUCKET"` mostra `"Status": "Enabled"`.

> O estado contém o segredo que protege a origem (`ORIGIN_VERIFY_SECRET`). Nunca torne esse bucket público e nunca copie o arquivo de estado para o repositório.

## Etapa 5: Criar a infraestrutura (`terraform apply`)

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

Edite `infra/terraform/terraform.tfvars` (o arquivo é ignorado pelo git; mantenha os demais valores padrão):

```hcl
github_repository = "jotagallo/votobrasil"   # exatamente como no GitHub (maiúsculas contam)
alarm_email       = "voce@exemplo.com"        # recebe alerta de saúde e de gasto (opcional, recomendado)
# create_github_oidc_provider = false         # só se a pré-checagem 2 encontrou o provedor
```

Rode, com `TF_BACKEND_BUCKET` e `TF_BACKEND_REGION` exportados (Etapa 4):

```bash
make tf-init     # baixa os providers e conecta ao bucket do estado
make tf-plan     # mostra o que será criado; ainda não cria nada
make tf-apply    # confirme digitando yes
```

- O `plan` deve terminar com algo como `Plan: NN to add, 0 to change, 0 to destroy` (algumas dezenas de recursos).
- O `apply` leva **15 a 25 minutos**. As linhas `Still creating...` do ambiente Elastic Beanstalk e da distribuição CloudFront são normais.
- Se falhar no meio, leia o erro, corrija e rode `make tf-apply` de novo: é seguro, o Terraform continua de onde parou.

**Depois do apply**

1. `make tf-output` mostra os valores que você usará nas próximas etapas.
2. Se o `terraform init` alterou `infra/terraform/.terraform.lock.hcl`, faça commit dele depois: o arquivo registra os checksums dos providers.
3. Se informou `alarm_email`, a AWS envia um e-mail _AWS Notification - Subscription Confirmation_: clique em **Confirm subscription**, senão o alarme de saúde não avisa ninguém.

**Como saber que deu certo:** o `apply` termina com `Apply complete!` e, ao abrir a URL abaixo, aparece a **página de exemplo do Elastic Beanstalk** (ainda não é o VotoBrasil; ele só entra na Etapa 6).

```bash
curl -sI "$(terraform -chdir=infra/terraform output -raw site_url)" | head -3    # HTTP/2 200
```

## Etapa 6: Primeiro deploy, manual

Por que manual: o primeiro deploy automático precisa rodar o ETL no GitHub (cerca de 45 min de estimativa e cerca de 2,4 GB baixados do TSE/IBGE, nunca testado nos servidores do GitHub). Aqui você reaproveita os dados que já tem em `data/processed` e valida a infraestrutura isoladamente.

Defina as variáveis (cole de novo em terminais novos):

```bash
export AWS_PROFILE=votobr AWS_REGION=us-east-1
tfo() { terraform -chdir=infra/terraform output -raw "$1"; }
REPO=jotagallo/votobrasil
EB_APP=$(tfo eb_application_name)
EB_ENV=$(tfo eb_environment_name)
BUCKET=$(tfo artifacts_bucket)
SITE=$(tfo site_url)
```

Gere o pacote:

```bash
nvm use                 # Node 22
make data-status        # confirma que há dados em data/processed (senão: make data, ~45 min)
make bundle             # gera dist/bundle.zip (~11 MB)
```

Publique:

```bash
LABEL=manual-1
aws s3 cp dist/bundle.zip "s3://$BUCKET/$LABEL.zip"
aws elasticbeanstalk create-application-version \
  --application-name "$EB_APP" --version-label "$LABEL" \
  --source-bundle "S3Bucket=$BUCKET,S3Key=$LABEL.zip" \
  --no-auto-create-application
aws elasticbeanstalk update-environment \
  --environment-name "$EB_ENV" --version-label "$LABEL"
aws elasticbeanstalk wait environment-updated --environment-names "$EB_ENV"
make flush-cdn CONFIRM=1
```

O `wait` do AWS CLI desiste após cerca de 6,7 minutos (`Waiter EnvironmentUpdated failed: Max attempts exceeded`). Isso **não** cancela a atualização: repita o comando até ele terminar sem erro.

**Como saber que deu certo:**

```bash
aws elasticbeanstalk describe-environments --environment-names "$EB_ENV" \
  --query 'Environments[0].[Status,Health,VersionLabel]' --output text    # Ready Green manual-1
curl -s "$SITE/healthz"                                                   # {"status":"ok","dataVersion":"..."}
```

Abra `$SITE` no navegador: deve aparecer o VotoBrasil.

## Etapa 7: Configurar o GitHub

O workflow `Deploy` precisa de 1 segredo e 6 variáveis. Nenhum deles é uma credencial da AWS: o segredo é só o ARN do papel que o GitHub vai assumir por OIDC.

```bash
# 1) Ambiente "production", liberado apenas para a branch main
gh api -X PUT "repos/$REPO/environments/production" --input - <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" -f name=main -f type=branch

# 2) Segredo e variáveis do ambiente production (valores vindos do Terraform)
gh secret   set AWS_ROLE_ARN               --env production --repo "$REPO" --body "$(tfo deploy_role_arn)"
gh variable set AWS_REGION                 --env production --repo "$REPO" --body "$(tfo aws_region)"
gh variable set EB_APPLICATION             --env production --repo "$REPO" --body "$(tfo eb_application_name)"
gh variable set EB_ENVIRONMENT             --env production --repo "$REPO" --body "$(tfo eb_environment_name)"
gh variable set ARTIFACTS_BUCKET           --env production --repo "$REPO" --body "$(tfo artifacts_bucket)"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --env production --repo "$REPO" --body "$(tfo cloudfront_distribution_id)"

# 3) Variável do repositório (o job de build não usa ambiente, então SITE_URL não pode ficar no ambiente)
gh variable set SITE_URL --repo "$REPO" --body "$SITE"

# 4) Opcional: ID de medição do Google Analytics 4 (formato G-XXXXXXXXXX; veja docs/DEVELOPMENT.md)
gh variable set GA_MEASUREMENT_ID --repo "$REPO" --body "G-XXXXXXXXXX"
```

Prefere clicar? GitHub → repositório → _Settings_ → _Environments_ → _New environment_ `production` → _Deployment branches and tags_ → _Selected branches and tags_ → adicione `main`; depois _Add environment secret/variable_ com os nomes acima. As variáveis do repositório (`SITE_URL` e a opcional `GA_MEASUREMENT_ID`) ficam em _Settings_ → _Secrets and variables_ → _Actions_ → _Variables_. Sem `GA_MEASUREMENT_ID`, o site não carrega estatísticas (o aviso de cookies aparece mesmo assim).

**Opcional, recomendado:** no mesmo ambiente `production`, marque _Required reviewers_ e adicione você mesmo, para que cada deploy espere um clique de aprovação. **Não** marque _Prevent self-review_ (você é o único mantenedor).

**Como saber que deu certo:**

```bash
gh secret list   --env production --repo "$REPO"     # AWS_ROLE_ARN
gh variable list --env production --repo "$REPO"     # as 5 variáveis do ambiente
gh variable list --repo "$REPO"                       # SITE_URL (e GA_MEASUREMENT_ID, se definida)
```

## Etapa 8: Testar o deploy automático (sem ETL)

Aqui você descobre cedo se o papel de deploy do GitHub tem as permissões certas, sem esperar o ETL. Registre uma segunda versão (o mesmo `.zip` com outro rótulo) e peça ao workflow para publicá-la. O campo `rollback_to` é só o atalho que pula o build:

```bash
aws s3 cp dist/bundle.zip "s3://$BUCKET/manual-2.zip"
aws elasticbeanstalk create-application-version \
  --application-name "$EB_APP" --version-label manual-2 \
  --source-bundle "S3Bucket=$BUCKET,S3Key=manual-2.zip" \
  --no-auto-create-application

gh workflow run deploy.yml --repo "$REPO" --ref main -f rollback_to=manual-2
sleep 5
RUN_ID=$(gh run list --repo "$REPO" --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo "$REPO" --exit-status
```

O workflow assume o papel via OIDC, atualiza o Elastic Beanstalk para `manual-2`, espera ficar `Ready`/`Green`, invalida o CloudFront e testa `/healthz` pela URL pública. Se você ativou _Required reviewers_ na Etapa 7, abra a página da execução e clique em _Review deployments_ para aprovar.

**Como saber que deu certo:** a execução termina verde e `aws elasticbeanstalk describe-environments ... --query 'Environments[0].VersionLabel'` mostra `manual-2`.

**Se falhar**, veja em [Problemas comuns](#problemas-comuns): `Not authorized to perform sts:AssumeRoleWithWebIdentity` (confiança OIDC) e `AccessDenied` (permissão que faltou no papel de deploy). Os dois são corrigíveis em minutos e é exatamente para isso que esta etapa existe.

Se usou a Opção B na Etapa 1 (chave de acesso), **apague a chave agora**: IAM → _Users_ → `votobr-admin` → _Security credentials_ → _Delete_ (para voltar a mexer na infra, crie outra chave ou use SSO).

## Etapa 9: Ligar o deploy automático

```
merge em main
  └─► CI (formato, lint, testes, build, terraform validate, Docker, gitleaks)
        └─► Deploy
              ├─ build:  ETL (só se o cache de dados não existir) → bundle.zip     [sem acesso à AWS]
              └─ deploy: login OIDC → S3 → Elastic Beanstalk → invalida CloudFront → teste de fumaça
```

**Faça o merge só depois das Etapas 7 e 8.** Todo merge na `main` dispara o Deploy; se o ambiente `production` ainda não estiver configurado, o workflow gasta cerca de 45 min de ETL e só então falha em `Check configuration`.

1. Faça commit e push das alterações pendentes na `dev`.
2. Abra o pull request e espere o CI ficar verde:

   ```bash
   git push origin dev
   gh pr create --repo "$REPO" --base main --head dev --title "Primeira versão deployável" --body "Primeiro deploy automático."
   ```

3. Faça o merge (pela interface ou com `gh pr merge`) e acompanhe:

   ```bash
   gh run list --repo "$REPO" --limit 5        # CI e, depois, Deploy
   gh run watch <id-do-Deploy> --repo "$REPO" --exit-status
   ```

O **primeiro** Deploy leva cerca de 1 h (ETL: cerca de 2,4 GB do TSE/IBGE). O cache de dados é salvo no fim do job `build`; os deploys seguintes levam cerca de 10 a 15 min (estimativa), enquanto `packages/etl/**` e `data/VERSION` não mudarem e o GitHub não apagar o cache (isso acontece após 7 dias sem nenhum Deploy).

**Pull requests do Dependabot** (situação quando este guia foi escrito): o merge de qualquer um deles na `main` também dispara um deploy.

- #3 (vitest 5.1.0) e #5 (TypeScript 7.0.2) **falham no CI**: não faça merge.
- #2 (provider AWS 6.x) passa no `terraform validate`, mas só vale a pena depois do primeiro `apply` bem-sucedido, e rodando `make tf-plan` antes para ler o que muda.
- Os demais (#1, #4, #6) estão verdes.

**Como saber que deu certo:** o Deploy termina verde, `aws elasticbeanstalk describe-environments ... --query 'Environments[0].VersionLabel'` mostra um rótulo `<sha>-<número>` e `$SITE/healthz` responde `ok`.

## Etapa 10: Domínio próprio (opcional)

1. Peça o certificado **em `us-east-1`** (exigência do CloudFront) e anote o ARN retornado:

   ```bash
   aws acm request-certificate --region us-east-1 --domain-name votobrasil.exemplo.org --validation-method DNS
   ```

2. Veja o registro CNAME de validação, crie-o no seu provedor de DNS e espere o certificado ser emitido:

   ```bash
   aws acm describe-certificate --region us-east-1 --certificate-arn <ARN> \
     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   aws acm wait certificate-validated --region us-east-1 --certificate-arn <ARN>
   ```

3. No `terraform.tfvars`, acrescente `domain_name = "votobrasil.exemplo.org"` e `acm_certificate_arn = "<ARN>"` (os dois juntos) e rode `make tf-apply`.
4. No seu DNS, crie um CNAME de `votobrasil.exemplo.org` para o output `cloudfront_domain_name`. Domínios "raiz" (sem subdomínio) exigem ALIAS/ANAME no provedor; sem isso, use um subdomínio.
5. Atualize `SITE_URL` e faça um novo deploy (qualquer merge na `main`) para que as tags canônicas e Open Graph usem o domínio novo:

   ```bash
   gh variable set SITE_URL --repo "$REPO" --body "https://votobrasil.exemplo.org"
   ```

## Etapa 11: Checklist final

- [ ] `$SITE` abre o VotoBrasil e `$SITE/healthz` responde `{"status":"ok",...}`.
- [ ] A origem está protegida: `curl -m 5 "http://$(tfo eb_environment_cname)/healthz"` **dá timeout** (só o CloudFront alcança a instância). Se responder, o grupo de segurança está aberto demais.
- [ ] Se informou `alarm_email`: e-mail do SNS confirmado (Etapa 5) e orçamento `votobr-prod-monthly` visível em _Billing_ → _Budgets_ (avisa a 80% e 100% de US$ 25 de gasto da **conta inteira**).
- [ ] Um deploy automático terminou verde (Etapa 9).
- [ ] O aviso de cookies aparece em `$SITE` (janela anônima). Se definiu `GA_MEASUREMENT_ID`: depois do “Entendi” (sem Do Not Track), o acesso surge em _Relatórios_ → _Tempo real_ do Google Analytics.
- [ ] O ambiente `production` do GitHub só aceita a branch `main`.
- [ ] Chave de acesso do administrador apagada (Opção B) e MFA ativo no root.
- [ ] `git status` não lista `terraform.tfvars` nem arquivos `.tfstate`.

## Operação do dia a dia

**Publicar uma mudança:** merge na `main`. O pipeline cuida do resto.

**Rollback:** _Actions_ → _Deploy_ → _Run workflow_ (branch `main`) → `rollback_to` com um rótulo existente (formato `<sha>-<número>`). Para listar os rótulos mais recentes:

```bash
aws elasticbeanstalk describe-application-versions --application-name "$EB_APP" \
  --query 'ApplicationVersions[].[DateCreated,VersionLabel]' --output text | sort -r | head
```

Os pacotes ficam 30 dias no S3 e no máximo 25 versões no Elastic Beanstalk; para algo mais antigo, reverta o commit.

**Mudar a infraestrutura:** edite os `.tf`, abra um PR (o CI roda `fmt` e `validate`), faça o merge e então rode `make tf-plan` e `make tf-apply` no seu Mac.

**Dados oficiais (ETL):** as eleições já aconteceram, então os dados não mudam e **não há atualização agendada**. O download do TSE/IBGE e o ETL rodam **somente no Deploy**, no job `build` do GitHub Actions, e apenas quando o cache dos dados não existe. A instância do Elastic Beanstalk nunca baixa nada do TSE: só os dados processados (cerca de 10 MB) vão dentro do bundle; os cerca de 2,4 GB de downloads ficam no GitHub.

- **Quando o ETL roda de novo no Deploy:** quando algo em `packages/etl/` ou o arquivo `data/VERSION` muda, ou quando o GitHub apaga o cache (7 dias sem nenhum Deploy). Nesses casos o Deploy leva cerca de 1 h (estimativa) em vez de 10 a 15 min.
- **Refazer os dados na produção:** edite `data/VERSION` (por exemplo, de `1` para `2`) e faça commit na `main`.
- **Refazer os dados no seu Mac:** `make data-refresh` (apaga `data/processed`, regera e valida; os downloads em `data/raw` são mantidos). Não afeta a produção: o Deploy sempre usa o ETL dele.
- **Testar o ETL no GitHub sem publicar:** _Actions_ → _Data refresh_ → _Run workflow_ (só manual; nunca faz deploy).

**Por que o ETL não roda na instância** (como _hook_ do Elastic Beanstalk): o hook certo seria o `predeploy`; o `postdeploy` roda depois que a nova versão já está no ar, ou seja, sem dados. Mas a `t4g.small` (2 GB de RAM, CPU com créditos) teria de baixar e descompactar vários GB ao lado da API no ar; o tempo máximo de um comando no Elastic Beanstalk é 3600 s, um teto rígido para um ETL que nunca foi cronometrado; o hook rodaria de novo a cada troca de instância (inclusive nas atualizações de plataforma gerenciadas, janela de domingo); e cada tentativa de depurar custaria um ETL inteiro.

**Diagnóstico rápido** (quando algo parecer errado):

```bash
aws elasticbeanstalk describe-environments --environment-names "$EB_ENV" \
  --query 'Environments[0].[Status,Health,HealthStatus,VersionLabel]' --output text
aws elasticbeanstalk describe-events --environment-name "$EB_ENV" --max-items 20 \
  --query 'Events[].[EventDate,Severity,Message]' --output text
aws logs describe-log-groups --log-group-name-prefix /aws/elasticbeanstalk \
  --query 'logGroups[].logGroupName' --output text
aws logs tail <nome-do-grupo> --since 30m        # os logs ficam 7 dias no CloudWatch
```

**Shell na instância (não há SSH):**

```bash
brew install --cask session-manager-plugin       # uma vez
ID=$(aws elasticbeanstalk describe-environment-resources --environment-name "$EB_ENV" \
  --query 'EnvironmentResources.Instances[0].Id' --output text)
aws ssm start-session --target "$ID"
```

Dentro da instância, os logs costumam ficar em `/var/log/web.stdout.log` (aplicação) e `/var/log/eb-engine.log` (deploy).

**Custos:** o orçamento avisa por e-mail. Para ver o detalhe, _Billing_ → _Cost Explorer_. A instância e o IPv4 público respondem pela maior parte da conta.

**Destruir tudo:**

```bash
terraform -chdir=infra/terraform destroy     # a remoção do CloudFront leva vários minutos
```

O bucket de estado **não** é removido (é seu). Esvazie-o (console → _Empty_, por causa do versionamento) e apague-o por último.

**Cuidados:** nunca faça commit de `terraform.tfvars`, `.env` ou `*.tfstate` (o `.gitignore` já os ignora e o CI roda gitleaks). A distribuição CloudFront e o Elastic Beanstalk conhecem o segredo de origem: restrinja quem pode ler o estado e descrever esses recursos.

## Problemas comuns

Em qualquer erro do `apply`, é seguro rodar `make tf-apply` de novo depois de corrigir: o Terraform retoma de onde parou.

**Terraform e conta AWS**

- **`brew install terraform` → `No available formula`.** O Terraform saiu do repositório principal do Homebrew. Use `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`.
- **`make tf-init` reclama de `use_lockfile` ou de versão.** Terraform antigo. `brew upgrade hashicorp/tap/terraform` (precisa de 1.11 ou maior).
- **`ExpiredToken`, `Unable to locate credentials` ou _SSO session has expired_.** Credenciais temporárias vencidas ou terminal novo. `aws sso login --profile votobr` e `export AWS_PROFILE=votobr`.
- **`BucketAlreadyExists` ao criar o bucket do estado.** O nome é global. Use outro sufixo em `TF_BACKEND_BUCKET` e refaça a Etapa 4.
- **`Error acquiring the state lock`.** Uma execução anterior foi interrompida. Confirme que nada está rodando e use `terraform -chdir=infra/terraform force-unlock <ID-mostrado-no-erro>`.
- **`EntityAlreadyExists` para `token.actions.githubusercontent.com`.** A conta já tem o provedor OIDC. Coloque `create_github_oidc_provider = false` no `terraform.tfvars` e rode `make tf-apply`.
- **`No default VPC` ou `VPCIdNotSpecified`.** A VPC padrão foi apagada. `aws ec2 create-default-vpc` e rode de novo.
- **CloudFront: `Your account must be verified before you can add new CloudFront resources`.** Contas novas às vezes precisam de verificação manual. Abra um caso no _AWS Support Center_ (categoria _Account and billing_) colando essa mensagem e rode `make tf-apply` quando liberarem. O `apply` cria o que não depende do CloudFront e falha nessa peça; o que faltar sai na repetição.
- **O `apply` falha ou estoura o tempo em `aws_elastic_beanstalk_environment` (20 min, saúde `Red`).** Veja o motivo em `aws elasticbeanstalk describe-events --environment-name <nome> --max-items 30` (a instância não subiu, permissão, limite de contas novas...). Corrija e rode `make tf-apply`: o Terraform recria o ambiente que ficou marcado como falho.

**Deploy pelo GitHub**

- **`Check configuration` falha com `X is empty`.** Falta uma variável. Repita a Etapa 7; todas ficam no ambiente `production`, exceto `SITE_URL`, que é do repositório.
- **`Not authorized to perform sts:AssumeRoleWithWebIdentity`.** A confiança do papel não bate com o job. Confira: o ambiente se chama `production`; `github_repository` no `terraform.tfvars` é exatamente `jotagallo/votobrasil` (maiúsculas contam); o job rodou na `main`; o provedor OIDC existe. Corrigiu o `tfvars`? `make tf-apply`.
- **`Branch "..." is not allowed to deploy to production due to environment protection rules`.** O ambiente só aceita a `main`; rode o workflow com `--ref main` (ou _Use workflow from: main_) e confira a política de branches da Etapa 7.
- **`AccessDenied` / `is not authorized to perform: <ação>` durante o deploy.** As permissões do papel de deploy (`infra/terraform/github_oidc.tf`) seguem o princípio do menor privilégio e nunca foram testadas na AWS real; o Elastic Beanstalk pode exigir uma ação que não foi prevista. Leia a ação no log do job (ou em CloudTrail → _Event history_, filtrando por erros), acrescente-a ao papel em `github_oidc.tf`, rode `make tf-apply` e refaça o job com `gh run rerun <id> --failed --repo "$REPO"`. Último recurso, **temporário**: anexar ao papel a política gerenciada `AdministratorAccess-AWSElasticBeanstalk` (a confiança já é restrita ao ambiente `production` na `main`, mas prefira a permissão mínima).
- **O Deploy rodou 45 min de ETL e falhou em `Check configuration`.** Foi um merge antes da Etapa 7. Configure o GitHub e use `gh run rerun <id> --failed`: o bundle do job `build` é reaproveitado (fica 7 dias).
- **O ETL falha no GitHub (download do TSE/IBGE).** Pode ser oscilação das fontes: refaça a execução. Se persistir, publique manualmente como na Etapa 6; o site no ar não é afetado por um Deploy que falhou antes de chegar à AWS.
- **O job `build` é cancelado por tempo (90 min).** O ETL no GitHub ficou mais lento que a estimativa (ele nunca foi cronometrado lá). Aumente `timeout-minutes` do job `build` em `.github/workflows/deploy.yml` (o GitHub aceita até 360) e refaça a execução; o cache só é salvo quando o job termina com sucesso, então uma execução cancelada recomeça do zero.
- **O Deploy refaz o ETL a cada execução.** O cache dos dados não está sendo salvo. Depois do primeiro Deploy bem-sucedido, _Actions_ → _Caches_ deve listar uma entrada `data-…`. O job `build` declara `cache-mode: write` porque, desde 06/2026, o GitHub dá só leitura de cache a execuções disparadas por `workflow_run` (como o Deploy); o GitHub marca essa execução com um aviso por causa disso, e é esperado.
- **`Waiter EnvironmentUpdated failed: Max attempts exceeded`.** O `wait` do AWS CLI desiste após cerca de 6,7 min. O `deploy.yml` já trata isso (avisa e continua verificando por até 10 min); em comandos manuais, repita o `wait`.

**Depois de no ar**

- **O site responde `403` pelo CloudFront.** O segredo de origem diverge entre CloudFront e instância (alteração manual fora do Terraform ou rotação do segredo em andamento: espere alguns minutos). `make tf-plan` mostra a diferença; `make tf-apply` realinha os dois lados.
- **`502`/`503`/`504` por cerca de 1 minuto durante um deploy.** Esperado: há uma única instância. O CloudFront continua servindo o que está em cache.
- **Deploy concluído, mas o navegador mostra a versão antiga.** Cache do CloudFront ou do navegador. `make flush-cdn CONFIRM=1` e recarregue com Cmd+Shift+R (o Deploy já invalida `/*` ao terminar).
- **Saúde `Degraded`/`Severe` depois de um deploy.** `aws elasticbeanstalk describe-events` e os logs (seção _Diagnóstico rápido_). Se for um bundle ruim, faça rollback com `rollback_to`.
