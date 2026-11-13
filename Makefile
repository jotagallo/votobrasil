# VotoBrasil — comandos centrais do projeto. `make` (ou `make help`) lista tudo.
# Compatível com GNU Make 3.81 (padrão do macOS).
#
# Variáveis úteis (linha de comando ou ambiente):
#   CONFIRM=1            pula as confirmações dos alvos destrutivos (flush-raw, flush-all, flush-cdn…)
#   VOTOBR_UFS=SP,RJ     restringe o ETL a algumas UFs (repassada ao `npm run data:build`)
#   VOTOBR_MIN_MUNICIPAL_VOTERS=1000000   corte de eleitores das Câmaras Municipais (0 desliga)
#   VOTOBR_MAX_MUNICIPALITIES=2           limita o número de cidades (builds de desenvolvimento)
#   VOTOBR_RAW_DIR / VOTOBR_OUT_DIR   diretórios do ETL; os alvos de flush respeitam os mesmos valores
#   CLOUDFRONT_DISTRIBUTION_ID        usado por flush-cdn (senão vem do `terraform output`)

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
RAW_DIR := $(or $(VOTOBR_RAW_DIR),$(ROOT)/data/raw)
OUT_DIR := $(or $(VOTOBR_OUT_DIR),$(ROOT)/data/processed)
TF_DIR := $(ROOT)/infra/terraform

NPM ?= npm
COMPOSE ?= docker compose
TERRAFORM ?= terraform
AWS ?= aws

BUILD_ARTIFACTS := $(ROOT)/dist $(ROOT)/apps/api/dist $(ROOT)/apps/web/dist $(ROOT)/coverage \
	$(ROOT)/apps/api/coverage $(ROOT)/apps/web/coverage $(ROOT)/packages/etl/coverage \
	$(ROOT)/packages/shared/coverage $(ROOT)/.cache

# $(call confirm,mensagem) — pede "s" antes de continuar; CONFIRM=1 pula. Sem TTY, aborta.
define confirm
	@if [ "$(CONFIRM)" != "1" ]; then \
		printf '\033[33m%s\033[0m Continuar? [s/N] ' "$(1)"; \
		{ read -r ans </dev/tty; } 2>/dev/null || ans=""; \
		case "$$ans" in s|S|y|Y|sim|yes) ;; *) echo "Cancelado."; exit 1 ;; esac; \
	fi
endef

# $(call safe_rm,dir...) — rm -rf com trava contra caminhos vazios, "/" ou $HOME.
define safe_rm
	@for d in $(1); do \
		case "$$d" in ""|/|"$$HOME"|"$$HOME/") echo "Recusado: caminho inseguro '$$d'"; exit 1 ;; esac; \
		if [ -e "$$d" ]; then echo "  rm -rf $$d"; rm -rf "$$d"; fi; \
	done
endef

.PHONY: help
help: ## Lista os comandos disponíveis
	@awk 'BEGIN {FS = ":.*## "; printf "\nUso: make \033[36m<alvo>\033[0m [CONFIRM=1]\n"} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
		/^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo

##@ Setup

.PHONY: install
install: ## Instala dependências exatamente como no lockfile (npm ci)
	$(NPM) ci --no-audit --no-fund

.PHONY: env
env: ## Cria .env a partir de .env.example (não sobrescreve)
	@if [ -f .env ]; then echo ".env já existe, nada a fazer."; else cp .env.example .env && echo ".env criado."; fi

.PHONY: setup
setup: env install ## Primeiro uso: .env + dependências

##@ Desenvolvimento

.PHONY: dev
dev: ## API (:8080) e web (:5173) com hot-reload
	$(NPM) run dev

.PHONY: dev-api
dev-api: ## Só a API em modo desenvolvimento
	$(NPM) run dev:api

.PHONY: dev-web
dev-web: ## Só a web em modo desenvolvimento
	$(NPM) run dev:web

.PHONY: build
build: ## Compila shared, SPA e API (apps/*/dist)
	$(NPM) run build

.PHONY: start
start: ## Serve API + SPA juntas como em produção (requer `make build`)
	@test -f apps/api/dist/server.mjs || { echo "Rode 'make build' antes."; exit 1; }
	node apps/api/dist/server.mjs

.PHONY: bundle
bundle: build ## Gera dist/bundle.zip (API + SPA + dados) para o Elastic Beanstalk
	$(NPM) run bundle

##@ Qualidade

.PHONY: test
test: ## Testes de todos os pacotes
	$(NPM) test

.PHONY: typecheck
typecheck: ## Verificação de tipos
	$(NPM) run typecheck

.PHONY: lint
lint: ## ESLint
	$(NPM) run lint

.PHONY: format
format: ## Formata o código com Prettier
	$(NPM) run format

.PHONY: format-check
format-check: ## Confere a formatação sem alterar arquivos
	$(NPM) run format:check

.PHONY: check
check: format-check lint typecheck test build ## Mesmas verificações do CI (formato, lint, tipos, testes, build)

##@ Dados (ETL)

.PHONY: data
data: ## Baixa os dados oficiais (reaproveita data/raw) e gera data/processed
	$(NPM) run data:build

.PHONY: data-offline
data-offline: ## Gera data/processed só com o que já está em data/raw (sem rede)
	VOTOBR_OFFLINE=1 $(NPM) run data:build

.PHONY: data-validate
data-validate: ## Confere a consistência dos dados gerados
	$(NPM) run data:validate

.PHONY: data-refresh
data-refresh: flush-data data data-validate ## Regera os dados do zero (mantém os downloads) e valida

.PHONY: data-status
data-status: ## Mostra tamanho e versão dos dados locais
	@for d in "$(RAW_DIR)" "$(OUT_DIR)"; do \
		if [ -d "$$d" ]; then du -sh "$$d"; else echo "-	$$d (ausente)"; fi; \
	done
	@if [ -f "$(OUT_DIR)/meta.json" ]; then \
		node -e 'const m=require(process.argv[1]); console.log("dataVersion:", m.dataVersion ?? "?", "| gerado em:", m.generatedAt ?? "?")' "$(OUT_DIR)/meta.json"; \
	fi

##@ Flush (limpeza)

.PHONY: flush
flush: flush-data clean ## Apaga dados processados, caches e builds (mantém os downloads em data/raw)
	@echo "Flush concluído. Reinicie a API (cache em memória) e rode 'make data' para regerar."

.PHONY: flush-data
flush-data: ## Apaga só os dados processados (data/processed)
	$(call safe_rm,"$(OUT_DIR)")

.PHONY: flush-raw
flush-raw: ## Apaga os downloads do TSE/IBGE (data/raw, ~2 GB; próximo ETL baixa tudo de novo)
	$(call confirm,Isto apaga $(RAW_DIR) e força novo download completo (>1 GB).)
	$(call safe_rm,"$(RAW_DIR)")

.PHONY: clean
clean: ## Apaga builds, bundle, coverage e .cache
	$(call safe_rm,$(foreach p,$(BUILD_ARTIFACTS),"$(p)"))

.PHONY: flush-docker
flush-docker: ## Remove containers, volume de node_modules e imagens locais do Compose
	$(call confirm,Isto remove containers, volumes e imagens do projeto votobr no Docker.)
	$(COMPOSE) --profile dev --profile etl down --volumes --remove-orphans --rmi all

.PHONY: flush-all
flush-all: ## Reset total: dados (inclusive data/raw), builds, node_modules e Docker
	$(call confirm,Reset total: apaga data/raw, data/processed, builds, node_modules e recursos Docker.)
	@$(MAKE) --no-print-directory flush CONFIRM=1
	@$(MAKE) --no-print-directory flush-raw CONFIRM=1
	@if command -v docker >/dev/null 2>&1; then $(MAKE) --no-print-directory flush-docker CONFIRM=1 || true; fi
	$(call safe_rm,"$(ROOT)/node_modules" $(foreach w,apps/api apps/web packages/etl packages/shared,"$(ROOT)/$(w)/node_modules"))
	@echo "Reset concluído. Rode 'make install' e 'make data'."

.PHONY: flush-cdn
flush-cdn: ## Invalida todo o cache do CloudFront em produção (/*)
	$(call confirm,Isto invalida /* no CloudFront de produção.)
	@id="$${CLOUDFRONT_DISTRIBUTION_ID:-$$($(TERRAFORM) -chdir="$(TF_DIR)" output -raw cloudfront_distribution_id 2>/dev/null)}"; \
	if [ -z "$$id" ]; then echo "Defina CLOUDFRONT_DISTRIBUTION_ID ou rode 'make tf-init' com acesso ao state."; exit 1; fi; \
	inv="$$($(AWS) cloudfront create-invalidation --distribution-id "$$id" --paths '/*' --query Invalidation.Id --output text)" || exit 1; \
	echo "Invalidação $$inv criada; aguardando..."; \
	$(AWS) cloudfront wait invalidation-completed --distribution-id "$$id" --id "$$inv" && echo "CloudFront limpo."

##@ Docker

.PHONY: up
up: ## Imagem de produção em :8080 (dados montados de data/processed)
	$(COMPOSE) up --build app

.PHONY: up-dev
up-dev: ## Ambiente dev em container (API :8080, web :5173)
	$(COMPOSE) --profile dev up dev

.PHONY: up-etl
up-etl: ## Roda o ETL em container, gerando ./data/processed
	$(COMPOSE) --profile etl run --rm etl

.PHONY: down
down: ## Para e remove os containers (mantém volumes e imagens)
	$(COMPOSE) --profile dev --profile etl down --remove-orphans

.PHONY: logs
logs: ## Acompanha os logs dos containers
	$(COMPOSE) --profile dev --profile etl logs -f

##@ Infra (Terraform)

.PHONY: tf-init
tf-init: ## terraform init (backend via TF_BACKEND_BUCKET, TF_BACKEND_REGION; ver infra/README.md)
	@test -n "$(TF_BACKEND_BUCKET)" -a -n "$(TF_BACKEND_REGION)" || { echo "Defina TF_BACKEND_BUCKET e TF_BACKEND_REGION."; exit 1; }
	$(TERRAFORM) -chdir="$(TF_DIR)" init \
		-backend-config="bucket=$(TF_BACKEND_BUCKET)" \
		-backend-config="key=votobr/prod/terraform.tfstate" \
		-backend-config="region=$(TF_BACKEND_REGION)" \
		-backend-config="encrypt=true" \
		-backend-config="use_lockfile=true"

.PHONY: tf-check
tf-check: ## terraform fmt + validate sem backend (igual ao CI)
	$(TERRAFORM) -chdir="$(TF_DIR)" fmt -check -recursive
	$(TERRAFORM) -chdir="$(TF_DIR)" init -backend=false -input=false
	$(TERRAFORM) -chdir="$(TF_DIR)" validate

.PHONY: tf-plan
tf-plan: ## terraform plan
	$(TERRAFORM) -chdir="$(TF_DIR)" plan

.PHONY: tf-apply
tf-apply: ## terraform apply (pede confirmação do próprio Terraform)
	$(TERRAFORM) -chdir="$(TF_DIR)" apply

.PHONY: tf-output
tf-output: ## Mostra os outputs (valores para os secrets/vars do GitHub)
	$(TERRAFORM) -chdir="$(TF_DIR)" output
