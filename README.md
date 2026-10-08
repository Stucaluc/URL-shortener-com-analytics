# URL Shortener com Analytics

Encurtador de URLs com painel de analytics. API REST em **Node.js + TypeScript + Fastify**, persistência em **PostgreSQL** e dashboard web em **HTML + Bootstrap + Chart.js**.

## Funcionalidades

- Criação de links curtos com código aleatório (base62) ou **alias personalizado**
- Expiração opcional (links expirados respondem `410 Gone`)
- Redirecionamento `302` que registra cada clique **sem atrasar a resposta**
- Analytics por link: total de cliques, visitantes únicos, cliques por dia, origem (referrer), navegador, sistema operacional, dispositivo e país
- Dashboard web para criar, copiar, excluir links e visualizar os gráficos
- Privacidade por padrão: o IP **não é armazenado** (apenas um hash HMAC), e do referrer só o domínio é guardado
- Segurança: autenticação por API key, rate limiting, headers de segurança (CSP via Helmet), validação de entrada com Zod, bloqueio de esquemas perigosos (`javascript:`, `data:` etc.)
- Docker Compose, migrations versionadas, testes automatizados e CI no GitHub Actions

## Início rápido (Docker Compose)

Pré-requisitos: Docker com Compose v2.

```bash
git clone https://github.com/Stucaluc/URL-shortener-com-analytics.git
cd URL-shortener-com-analytics

cp .env.example .env
# Edite o .env e preencha POSTGRES_PASSWORD, API_KEY e IP_HASH_SALT.
# Dica para gerar valores seguros (use hexadecimal para a senha do banco, pois ela entra em uma URL):
#   openssl rand -hex 24

docker compose up -d --build
```

Acesse **http://localhost:3000** (redireciona para o dashboard) e informe a `API_KEY` no campo do topo da página.

## Desenvolvimento local

Pré-requisitos: Node.js 20+ (testado com 22) e um PostgreSQL acessível.

```bash
# PostgreSQL descartável para desenvolvimento
docker run -d --name shortener-db -p 5432:5432 \
  -e POSTGRES_USER=shortener -e POSTGRES_PASSWORD=shortener -e POSTGRES_DB=shortener \
  postgres:16-alpine

npm install
cp .env.example .env     # o DATABASE_URL padrão já aponta para o container acima
npm run dev              # http://localhost:3000 (migrations rodam ao iniciar)
```

Scripts úteis:

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor com recarga automática |
| `npm run build` / `npm start` | Compila para `dist/` e executa a versão compilada |
| `npm run migrate` | Aplica as migrations manualmente |
| `npm run typecheck` | Verificação de tipos |
| `npm test` | Testes (os de integração com PostgreSQL exigem `TEST_DATABASE_URL`) |

## Configuração

Todas as opções são variáveis de ambiente (veja o `.env.example`).

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | — (obrigatória) | String de conexão do PostgreSQL |
| `BASE_URL` | `http://localhost:3000` | URL pública usada para montar os links curtos |
| `API_KEY` | — | Chave exigida no header `x-api-key`. **Obrigatória em produção** (mín. 16 caracteres). Sem ela, a API de gerenciamento fica aberta (somente desenvolvimento) |
| `IP_HASH_SALT` | — | Segredo do HMAC dos visitantes. **Obrigatório em produção** (mín. 16 caracteres) |
| `TRUST_PROXY` | `false` | Use `true` apenas atrás de proxy reverso confiável, para que `request.ip` use `X-Forwarded-For` |
| `COUNTRY_HEADER` | vazio (desativado) | Nome do header com o país do visitante (ex.: `cf-ipcountry` no Cloudflare). Só habilite se o seu proxy sobrescreve esse header |
| `AUTO_MIGRATE` | `true` | Aplica as migrations ao iniciar |
| `CODE_LENGTH` | `7` | Tamanho dos códigos gerados (4 a 16) |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Endereço de escuta |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |

## API

Todas as rotas de gerenciamento ficam em `/api/v1` e exigem o header `x-api-key` quando `API_KEY` está definida. O redirecionamento (`GET /:code`) e o `GET /health` são públicos.

| Método e rota | Descrição | Respostas |
| --- | --- | --- |
| `POST /api/v1/links` | Cria um link. Corpo: `url` (obrigatório), `alias`, `expiresAt` (ISO 8601) | `201`, `400`, `409` (alias em uso) |
| `GET /api/v1/links?limit=20&offset=0` | Lista links (mais recentes primeiro), `limit` de 1 a 100 | `200` |
| `GET /api/v1/links/:code` | Detalhes de um link | `200`, `404` |
| `DELETE /api/v1/links/:code` | Remove o link e seus cliques | `204`, `404` |
| `GET /api/v1/links/:code/stats?days=30` | Estatísticas dos últimos 1 a 365 dias (UTC) | `200`, `400`, `404` |
| `GET /:code` | Redireciona (`302`) e registra o clique | `302`, `404`, `410` (expirado) |
| `GET /health` | Verifica a aplicação e a conexão com o banco | `200`, `503` |

Exemplo:

```bash
curl -X POST http://localhost:3000/api/v1/links \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"url": "https://exemplo.com/uma/url/bem/longa", "alias": "promo"}'
```

```json
{
  "code": "promo",
  "shortUrl": "http://localhost:3000/promo",
  "targetUrl": "https://exemplo.com/uma/url/bem/longa",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "expiresAt": null,
  "clickCount": 0
}
```

```bash
curl "http://localhost:3000/api/v1/links/promo/stats?days=7" -H "x-api-key: $API_KEY"
```

Erros seguem o formato `{ "error": "codigo_do_erro", "message": "descrição" }`.

## Testes

```bash
npm test
```

A suíte cobre utilitários (validação de URL, user-agent, hash, datas, configuração) e a API completa, usando um repositório em memória. Os testes de integração com PostgreSQL real rodam quando `TEST_DATABASE_URL` aponta para um banco **descartável** (as tabelas são truncadas):

```bash
TEST_DATABASE_URL=postgres://shortener:shortener@localhost:5432/shortener npm test
```

O workflow de CI (`.github/workflows/ci.yml`) executa typecheck, testes (com PostgreSQL), build, `npm audit` e o build da imagem Docker.

## Estrutura

```
src/
  app.ts            # rotas, segurança e montagem do Fastify
  server.ts         # inicialização e encerramento gracioso
  config.ts         # leitura e validação das variáveis de ambiente (Zod)
  repository.ts     # contrato de persistência
  repositories/     # PostgreSQL e memória (testes)
  lib/              # códigos, URLs, user-agent, privacidade, datas
  migrate.ts        # executor de migrations
migrations/         # SQL versionado
public/             # dashboard
tests/              # testes unitários, de API e de integração
docs/ARQUITETURA.md # decisões, riscos e roadmap
```

## Privacidade e limitações conhecidas

- O IP do visitante nunca é gravado; guarda-se `HMAC-SHA256(IP_HASH_SALT, ip|user-agent)` apenas para contar visitantes únicos. Trocar o salt reinicia a contagem de únicos.
- O país depende de um header do seu proxy/CDN; não há banco GeoIP embutido.
- A detecção de navegador/SO/dispositivo usa regras simples e não cobre todos os agentes (ex.: iPad com Safari moderno se identifica como macOS).
- Encurtadores podem ser usados para disfarçar links maliciosos. Mantenha a API protegida por chave e considere adicionar verificação de destinos antes de abrir o serviço ao público (veja o roadmap).

Mais detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Licença

[MIT](LICENSE)
