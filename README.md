# Cajuína CMS Auth API

API de autenticação OAuth para Sveltia CMS (anteriormente Netlify CMS).

## 📁 Estrutura de Arquivos

```
api/
├── index.ts           # 🚀 Cloudflare Workers + Express (httpServerHandler)
├── handler.ts         # 🔧 Worker handler com lógica OAuth
├── standalone.ts      # 🖥️  Servidor Express standalone (Docker/local)
├── env.schema.ts      # 📋 Schema de validação das variáveis de ambiente
├── env.ts             # 🔐 Configuração e validação do ambiente
├── wrangler.jsonc     # ⚙️  Configuração do Cloudflare Workers
└── package.json       # 📦 Dependências e scripts
```

## 🎯 Arquivos Principais

### `index.ts` - Cloudflare Workers
Arquivo principal para deploy no Cloudflare Workers. Usa Express.js com `httpServerHandler` para compatibilidade com o runtime do Cloudflare.

**Características:**
- Express.js rodando no Cloudflare Workers
- Endpoints OAuth delegados ao handler
- Health check endpoint
- Compilado para `dist/index.js`

### `handler.ts` - OAuth Handler
Contém toda a lógica OAuth para GitHub e GitLab. É utilizado tanto pelo `index.ts` (Workers) quanto pelo `standalone.ts` (Docker/local).

**Providers suportados:**
- ✅ GitHub
- ✅ GitLab
- ⏳ Bitbucket (em desenvolvimento)

### `standalone.ts` - Servidor Standalone
Servidor Express para desenvolvimento local ou execução em Docker. Adapta as requisições Express para o formato do Worker handler.

**Características:**
- Logger com Pino
- Health check em `/health`
- Suporte a variáveis de ambiente locais
- Ideal para desenvolvimento

## 🚀 Scripts Disponíveis

```bash
# Compilar TypeScript
pnpm build

# Desenvolvimento local (standalone)
pnpm dev

# Iniciar servidor standalone (produção)
pnpm start

# Deploy para Cloudflare Workers
pnpm deploy

# Wrangler dev (testa o Workers localmente)
pnpm wrangler:start

# Verificações
pnpm check          # Roda todas as verificações
pnpm check:types    # TypeScript
pnpm check:env      # Validação de env vars
pnpm check:prettier # Formatação
pnpm check:eslint   # Linting
```

## 🔧 Variáveis de Ambiente

### Obrigatórias

```env
# GitHub OAuth
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# GitLab OAuth
GITLAB_CLIENT_ID=your_client_id
GITLAB_CLIENT_SECRET=your_client_secret

# Domínios permitidos (separados por vírgula)
ALLOWED_DOMAINS=*.yourdomain.com,anotherdomain.com
```

### Opcionais

```env
# Hostnames customizados
GITHUB_HOSTNAME=github.com
GITLAB_HOSTNAME=gitlab.com

# Standalone server
HOST=localhost
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Para testes locais (desabilita cookies Secure)
INSECURE_COOKIES=1
```

## 🌐 Endpoints

### OAuth
- `GET /auth` - Inicia o fluxo OAuth
- `GET /oauth/auth` - Alias para `/auth`
- `GET /oauth/authorize` - Alias para `/auth`
- `GET /callback` - Callback OAuth
- `GET /oauth/redirect` - Alias para `/callback`

### Utilitários
- `GET /health` - Health check
- `GET /` - Informações da API

## 📦 Deploy

### Cloudflare Workers

```bash
# Build e deploy
pnpm build && pnpm deploy
```

### Docker

```bash
# Build da imagem
docker build -t cajuina-cms-auth .

# Run
docker run -p 3000:3000 --env-file .env cajuina-cms-auth
```

## 🔄 Fluxo OAuth

1. **Usuário inicia autenticação** → `GET /auth?provider=github&site_id=example.com`
2. **API redireciona para provider** → GitHub/GitLab OAuth page
3. **Callback com código** → `GET /callback?code=xxx&state=xxx`
4. **API troca código por token** → Requisição ao provider
5. **HTML postMessage** → Envia token para o CMS via `window.postMessage`

## 🛡️ Segurança

- ✅ CSRF protection com tokens aleatórios
- ✅ Domain whitelist
- ✅ Cookies HttpOnly
- ✅ SameSite=Lax
- ✅ Secure cookies (exceto em dev com `INSECURE_COOKIES=1`)
- ✅ Validação de state tokens

## 📝 Notas

- O arquivo `handler.ts` é reutilizado nos dois ambientes (Workers e standalone)
- Use `standalone.ts` para desenvolvimento local
- Use `index.ts` para deploy no Cloudflare Workers
- Compile com `pnpm build` antes de fazer deploy
