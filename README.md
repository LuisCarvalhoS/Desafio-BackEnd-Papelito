# Papelito Middleware — Salesforce Integration

Middleware REST desenvolvido como solução para o **Desafio Técnico: Backend Salesforce Integration Specialist**. Atua como camada intermediária entre um e-commerce e o Salesforce: recebe pedidos via API, persiste no PostgreSQL e realiza a sincronização de forma assíncrona com retry automático.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Decisões Técnicas](#decisões-técnicas)
- [Pré-requisitos](#pré-requisitos)
- [Executando com Docker (recomendado)](#executando-com-docker-recomendado)
- [Executando Localmente](#executando-localmente)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Endpoints da API](#endpoints-da-api)
- [Rodando os Testes](#rodando-os-testes)
- [Comportamento do Mock Salesforce](#comportamento-do-mock-salesforce)

---

## Visão Geral

```
E-commerce  →  POST /v1/orders  →  Middleware  →  (background) Salesforce
                                       ↓
                                  PostgreSQL
```

O fluxo é **fire-and-forget**: o `POST` retorna `HTTP 201` com `salesforce_status: PENDING` imediatamente. A sincronização com o Salesforce acontece em background, com até 3 tentativas e backoff exponencial. O resultado final (SYNCED ou FAILED) é consultável via `GET /v1/orders/:id`.

---

## Decisões Técnicas

### NestJS

Escolhido pela **maturidade e escalabilidade** que o framework oferece. A arquitetura modular (AuthModule, DatabaseModule, SalesforceModule, OrdersModule) facilita o crescimento da aplicação sem acoplamento entre domínios. A injeção de dependência nativa simplifica testes unitários e a troca de implementações concretas. O NestJS também possui suporte de primeira classe a TypeScript, Passport/JWT, pipes de validação e filtros de exceção globais — todos utilizados neste projeto.

### Docker

O ambiente é totalmente containerizado para garantir **paridade entre máquinas de desenvolvimento, CI e produção**. Qualquer membro do time sobe o projeto com um único comando (`docker compose up`), sem necessidade de instalar PostgreSQL, configurar variáveis globais ou lidar com diferenças de versão de Node. O `docker-compose.yml` define healthcheck no banco para garantir que a aplicação só sobe após o PostgreSQL estar pronto.

### Prisma ORM

Escolhido pela **produtividade na manipulação do banco**. O schema declarativo (`schema.prisma`) serve como fonte única de verdade para modelos, tipos e migrações. O Prisma Client gerado é totalmente tipado, eliminando erros de query em tempo de execução e tornando o autocomplete do editor confiável. O tratamento de erros específicos do banco (ex: `P2002` para violação de unique constraint) é direto e bem documentado.

### Autenticação JWT

Implementada via `@nestjs/passport` + `@nestjs/jwt`. O segredo e o tempo de expiração são lidos via `ConfigService` (nunca `process.env` diretamente), garantindo que as configurações sejam centralizadas e testáveis.

### Sync Assíncrono com Retry

O `OrdersService` persiste o pedido e retorna `PENDING` imediatamente. O método `syncWithSalesforce()` roda em background (fire-and-forget) com até 3 tentativas e backoff exponencial (1s, 2s + jitter). Em caso de falha total, o pedido é marcado como `FAILED` com a mensagem de erro registrada.

---

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/)
- (Somente para execução local) Node.js 20+ e npm

---

## Executando com Docker (recomendado)

### 1. Clone o repositório e entre na pasta

```bash
git clone <url-do-repositorio>
cd papelito-middleware
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` e defina pelo menos o `JWT_SECRET`:

```env
JWT_SECRET=uma_chave_secreta_forte_aqui
```

### 3. Suba os containers

```bash
docker compose up --build
```

A aplicação estará disponível em `http://localhost:3000`.
O PostgreSQL ficará exposto em `localhost:5432`.

### 4. Execute as migrations do banco

```bash
docker exec papelito-middleware-app-1 npx prisma migrate deploy
```

> Na primeira execução, as tabelas serão criadas automaticamente.

### Parar os containers

```bash
docker compose down
```

Para remover também os dados do banco:

```bash
docker compose down -v
```

---

## Executando Localmente

### 1. Instale as dependências

```bash
npm install
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Ajuste o `DATABASE_URL` para apontar para um PostgreSQL local:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/papelito?schema=public"
JWT_SECRET=uma_chave_secreta_forte_aqui
```

### 3. Execute as migrations

```bash
npx prisma migrate deploy
```

### 4. Inicie a aplicação

```bash
# modo desenvolvimento (hot reload)
npm run start:dev

# modo produção
npm run build && npm run start:prod
```

---

## Variáveis de Ambiente

| Variável          | Descrição                                                  | Padrão  |
| ----------------- | ---------------------------------------------------------- | ------- |
| `PORT`            | Porta HTTP da aplicação                                    | `3000`  |
| `DATABASE_URL`    | Connection string do PostgreSQL                            | —       |
| `JWT_SECRET`      | Chave secreta para assinatura dos tokens JWT               | —       |
| `JWT_EXPIRES_IN`  | Tempo de expiração do token JWT                            | `3600s` |
| `SALESFORCE_FAIL` | Define `true` para forçar 100% de falha no mock Salesforce | `false` |

---

## Endpoints da API

### Autenticação

#### `POST /auth/login`

Retorna um token JWT. Credenciais fixas de demonstração: `admin` / `admin`.

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

**Resposta:**

```json
{ "access_token": "eyJhbGci..." }
```

---

### Pedidos

#### `POST /v1/orders` — Criar pedido _(requer JWT)_

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "external_id": "PED-001",
    "total": 150.00,
    "customer": {
      "name": "João Silva",
      "email": "joao@exemplo.com",
      "document": "123.456.789-00"
    },
    "items": [
      { "sku": "PROD-A", "quantity": 2, "price": 50.00 },
      { "sku": "PROD-B", "quantity": 1, "price": 50.00 }
    ]
  }'
```

**Resposta `201 Created`:**

```json
{
  "id": 1,
  "external_id": "PED-001",
  "total": 150,
  "salesforce_status": "PENDING",
  "salesforce_id": null,
  "error_message": null,
  "created_at": "2026-03-24T00:00:00.000Z",
  "customer": {
    "id": 1,
    "name": "João Silva",
    "email": "joao@exemplo.com",
    "document": "123.456.789-00"
  },
  "items": [
    { "id": 1, "sku": "PROD-A", "quantity": 2, "price": 50 },
    { "id": 2, "sku": "PROD-B", "quantity": 1, "price": 50 }
  ]
}
```

| Código | Situação                                              |
| ------ | ----------------------------------------------------- |
| `201`  | Pedido criado com sucesso                             |
| `400`  | Payload inválido (campos faltando ou com tipo errado) |
| `401`  | Token JWT ausente ou inválido                         |
| `409`  | `external_id` já cadastrado                           |

---

#### `GET /v1/orders/:id` — Consultar pedido _(público)_

```bash
curl http://localhost:3000/v1/orders/1
```

**Resposta `200 OK` — após sincronização bem-sucedida:**

```json
{
  "id": 1,
  "salesforce_status": "SYNCED",
  "salesforce_id": "SF-3a7b1c2d",
  ...
}
```

**Resposta `200 OK` — após falha na sincronização:**

```json
{
  "id": 1,
  "salesforce_status": "FAILED",
  "salesforce_id": null,
  "error_message": "Salesforce sync failed after 3 attempts: Salesforce API error: 500 Internal Server Error",
  ...
}
```

| Código | Situação          |
| ------ | ----------------- |
| `200`  | Pedido encontrado |
| `404`  | Pedido não existe |

---

## Rodando os Testes

### Testes unitários

```bash
npm run test
```

Cobre: `SalesforceService` (retry, backoff, falha aleatória, SALESFORCE_FAIL), `OrdersService` (fluxo PENDING, SYNCED, FAILED, duplicata, 404) e `JwtStrategy`.

### Testes E2E

> Requer PostgreSQL rodando em `localhost:5432` (via `docker compose up db`).

```bash
npm run test:e2e
```

Cobre o fluxo completo: login → criar pedido (PENDING) → aguardar sync → verificar SYNCED/FAILED → duplicata (409) → não encontrado (404).

### Cobertura

```bash
npm run test:cov
```

---

## Comportamento do Mock Salesforce

O `SalesforceService` simula a integração com o Salesforce sem depender de uma conta real.

| Configuração           | Comportamento                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Padrão (sem env var)   | 60% de chance de falha por tentativa (~21% dos pedidos finalizarão como FAILED após 3 retries) |
| `SALESFORCE_FAIL=true` | 100% de falha em todas as tentativas — todos os pedidos ficam FAILED                           |

**Estratégia de retry:**

| Tentativa | Delay antes da próxima |
| --------- | ---------------------- |
| 1ª        | ~1000ms + jitter       |
| 2ª        | ~2000ms + jitter       |
| 3ª        | — (lança exceção)      |

Isso permite observar os três estados possíveis (`PENDING` → `SYNCED` ou `FAILED`) realizando um `GET` no pedido alguns segundos após o `POST`.
