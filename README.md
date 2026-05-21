# ClaudeProxy

Proxy API OpenAI-compatible que conecta ao **Claude (claude.ai)** via automação de navegador com Playwright.

## ✨ Features

- **OpenAI API Compatible**: Interface compatível com `/v1/chat/completions` e `/v1/models`
- **Claude Models**: Suporte a Opus, Sonnet, Haiku e todos os modelos Claude
- **Session Persistence**: Login persistente com armazenamento de perfil do navegador em `claude_profile/`
- **Browser Selection**: Escolha entre Chrome, Firefox, Edge ou Chromium
- **Docker Ready**: Deploy simplificado com suporte a Docker

## 🚀 Como Usar

### 1. Instalar dependências
```bash
npm install
npx playwright install
```

### 2. Configurar credenciais
```bash
cp .env.example .env
```

Edite o `.env`:
```env
PORT=3000
ANTHROPIC_EMAIL=seu-email@exemplo.com
ANTHROPIC_PASSWORD=sua-senha
BROWSER=chromium
```

### 3. Iniciar
```bash
npm start
```

### 4. Usar com OpenAI SDK
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-no-key-required'
});

const completion = await openai.chat.completions.create({
  model: 'claude-opus-4-7',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(completion.choices[0].message.content);
```

## 📡 API Endpoints

- `POST /v1/chat/completions` - Chat completions
- `GET /v1/models` - Lista de modelos disponíveis
- `GET /health` - Health check

## 🤖 Modelos Disponíveis

- `claude-opus-4-7` (padrão)
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `claude-3-5-sonnet`
- etc.

## ⚠️ Disclaimer

Este projeto é apenas para fins educacionais. Use por sua conta e risco.