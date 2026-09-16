# 💰 Analisador de Empréstimo Consignado

Aplicação web para análise de empréstimos consignados: cálculo de taxa de juros real, saldo devedor, simulação de portabilidade com coeficientes oficiais, extração de dados de imagens/PDF/Excel (OCR) e gestão multiusuário local.

## 🚀 Rodando localmente

```bash
npm install
npm run dev
```

## 📦 Build de produção

```bash
npm run build
```

Gera um único arquivo em `dist/index.html` (via `vite-plugin-singlefile`).

## ☁️ Deploy no Netlify

### Opção 1 — Conectar o repositório do GitHub (recomendado)

1. Suba o projeto para o GitHub:
   ```bash
   git init
   git add .
   git commit -m "Analisador de Empréstimo Consignado"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
   git push -u origin main
   ```
2. Acesse [netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → selecione o repositório.
3. O Netlify detecta automaticamente o `netlify.toml`:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Clique em **Deploy**. Cada push na `main` faz deploy automático.

### Opção 2 — Drag & drop (rápido)

1. `npm run build`
2. Acesse [app.netlify.com/drop](https://app.netlify.com/drop) e arraste a pasta `dist/`.

## 🔧 Stack

- **React 19 + TypeScript + Vite**
- **Tailwind CSS v4**
- **Chart.js / react-chartjs-2** (gráficos)
- **Tesseract.js** (OCR de imagens)
- **pdfjs-dist** (extração de texto de PDF)
- **SheetJS (xlsx)** (leitura de Excel)
- **jsPDF** (exportação de relatórios)

## 🔐 Multiusuário

O sistema é multiusuário (master + usuários comuns). O primeiro master é criado automaticamente na inicialização.

## ☁️ Banco de dados na nuvem (Supabase)

✅ **Conexão já está embutida no código** (arquivo [`src/utils/cloudConfig.ts`](./src/utils/cloudConfig.ts))
com a URL e a chave do banco. Por isso o app **conecta e sincroniza automaticamente em qualquer
computador/navegador** — sem precisar configurar nada na interface. Os dados sobem sozinhos ao abrir o
app e a cada alteração (usuários, senhas, contratos, taxas e tabelas de coeficientes).

Para trocar de banco no futuro, basta editar o `src/utils/cloudConfig.ts` (ou definir
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` no Netlify, que têm prioridade).

### Pré-requisito (uma única vez)

As tabelas do banco precisam existir. Abra o [SQL Editor](https://supabase.com/dashboard) do seu projeto,
cole o conteúdo de [`supabase-schema.sql`](./supabase-schema.sql) e clique em **Run**.

### ⭐ Onde coloco a conexão para funcionar em TODAS as máquinas?

Sem a conexão no código, a configuração fica guardada **só no navegador** — e é por isso que você
perdia os dados ao trocar de máquina. Para resolver, use **uma** das opções (a 1º é a mais fácil):

**Opção 1 — Arquivo do projeto (recomendado):** abra
[`src/utils/cloudConfig.ts`](./src/utils/cloudConfig.ts) e cole a URL e a chave:
```ts
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```
Faça o deploy. **Todas** as máquinas que abrirem o site se conectam ao mesmo banco automaticamente.

**Opção 2 — Netlify (sem editar código):** em **Site settings → Environment variables**, defina:
```
VITE_SUPABASE_URL       = https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY  = eyJhbGciOi...
```
O app lê o ambiente **antes** do arquivo.

### 💾 Alternativa sem nuvem: Backup (arquivo)

Na seção **☁️ Sincronizar dados**, há os botões **⬇️ Baixar backup (.json)** e **⬆️ Restaurar de backup**.
Isso gera um arquivo com **TUDO** (usuários, senhas, contratos, taxas e tabelas). Leve esse arquivo
para outro computador e clique em **Restaurar** — sem precisar de Supabase.

### O que é sincronizado

| Dado | Tabela |
|---|---|
| Usuários, permissões, limites, bloqueios | `usuarios` |
| Contratos de cada usuário | `contratos` |
| Taxa de referência | `configuracoes` |
| Tabelas de coeficientes customizadas | `tabelas_coeficientes` |

> Funciona **offline-first**: se a internet cair, o app continua usando o cache local e sincroniza quando voltar.

## 🛡️ Proteções embutidas

- **Marca d'água de sessão** sobre toda a tela: nome, e-mail, dispositivo e data/hora de quem está olhando — torna qualquer captura de tela **rastreável**.
- **Cópia de texto bloqueada** (seleção desabilitada; inputs seguem liberados).
- **Clique direito bloqueado** (fora de campos de formulário).
- **Arrastar imagens bloqueado**.
- **Atalhos bloqueados**: F12, Ctrl+Shift+I/J/K/C/P, Ctrl+U (ver fonte), Ctrl+S (salvar página).
- **Detecção de DevTools** (desktop) com alerta.
- **Aviso de console** contra engenharia reversa.
- **Senhas com hash SHA-256** (não ficam em texto puro no banco).
- **Sessão única**: 1 acesso por vez por conta.

> ℹ️ Proteções de cliente aumentam o custo da cópia e identificam o autor, mas não a tornam impossível (o código final roda no navegador).

## 📄 Licença

Uso interno. Cálculos pela Tabela Price — simulação educativa, não constitui recomendação financeira.
