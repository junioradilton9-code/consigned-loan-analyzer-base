-- ============================================================
--  ANALISADOR DE EMPRÉSTIMO CONSIGNADO — ESQUEMA DO BANCO
--  Cole este SQL no Supabase → SQL Editor → Run
--  É seguro rodar mais de uma vez (usa IF NOT EXISTS / IF NOT EXISTS)
-- ============================================================

-- 1) USUÁRIOS -------------------------------------------------
create table if not exists public.usuarios (
  id                 text primary key,
  nome               text not null,
  email              text not null unique,
  senha              text not null,
  role               text not null default 'comum',
  bloqueado          boolean not null default false,
  limite_contratos   integer not null default 0,
  acessos_simultaneos integer not null default 0,
  data_expiracao     text default '',
  permissoes         jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  ultimo_acesso      text default '',
  contratos_criados  integer not null default 0,
  deletado_em        timestamptz default null,
  sessao_token       text default '',
  sessao_dispositivo text default '',
  atualizado_em      timestamptz not null default now()
);

-- Migração: adiciona colunas que podem faltar em bancos antigos
alter table public.usuarios add column if not exists sessao_token        text default '';
alter table public.usuarios add column if not exists sessao_dispositivo  text default '';
alter table public.usuarios add column if not exists acessos_simultaneos integer default 0;
alter table public.usuarios add column if not exists deletado_em         timestamptz default null;
alter table public.usuarios add column if not exists atualizado_em       timestamptz default now();
create index if not exists idx_usuarios_deletado_em on public.usuarios(deletado_em);

-- 2) CONTRATOS ------------------------------------------------
create table if not exists public.contratos (
  id                   text primary key,
  usuario_id           text not null references public.usuarios(id) on delete cascade,
  banco                text not null default '',
  valor_liberado       numeric not null default 0,
  parcela              numeric not null default 0,
  prazo                integer not null default 0,
  meses_pagos          integer,
  valor_bruto_restante numeric,
  criado_em            timestamptz not null default now()
);
create index if not exists idx_contratos_usuario on public.contratos(usuario_id);

-- 3) CONFIGURAÇÕES POR USUÁRIO --------------------------------
create table if not exists public.configuracoes (
  usuario_id    text primary key references public.usuarios(id) on delete cascade,
  taxa_ref      numeric,
  atualizado_em timestamptz not null default now()
);

-- 4) TABELAS DE COEFICIENTES CUSTOMIZADAS ---------------------
create table if not exists public.tabelas_coeficientes (
  id            text primary key,
  usuario_id    text default 'global',
  convenio      text not null,
  codigo        text not null,
  nome          text not null,
  empregador    text default '',
  prazos        jsonb not null default '[]'::jsonb,
  tc            numeric not null default 0,
  oficial       boolean not null default false,
  linhas        jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_tab_coef_convenio on public.tabelas_coeficientes(convenio);
create index if not exists idx_tab_coef_usuario on public.tabelas_coeficientes(usuario_id);
alter table public.tabelas_coeficientes add column if not exists usuario_id text default 'global';

-- 5) SEGURANÇA (RLS aberto — app usa anon key) ----------------
alter table public.usuarios             enable row level security;
alter table public.contratos            enable row level security;
alter table public.configuracoes        enable row level security;
alter table public.tabelas_coeficientes enable row level security;

drop policy if exists "acesso_total_usuarios"  on public.usuarios;
drop policy if exists "acesso_total_contratos" on public.contratos;
drop policy if exists "acesso_total_config"    on public.configuracoes;
drop policy if exists "acesso_total_tabelas"   on public.tabelas_coeficientes;

create policy "acesso_total_usuarios"  on public.usuarios             for all using (true) with check (true);
create policy "acesso_total_contratos" on public.contratos            for all using (true) with check (true);
create policy "acesso_total_config"    on public.configuracoes        for all using (true) with check (true);
create policy "acesso_total_tabelas"   on public.tabelas_coeficientes for all using (true) with check (true);

-- ============================================================
--  5) INSERE MASTER E DEMO (não sobrescreve existentes) -----
-- ============================================================
insert into public.usuarios (id, nome, email, senha, role, bloqueado, limite_contratos, acessos_simultaneos, data_expiracao, permissoes, criado_em, ultimo_acesso, contratos_criados)
values
  ('master-padrao', 'Master Admin', 'master@consig.com', 'master123', 'master', false, 0, 0, '',
   '{"podeAdicionarContrato":true,"podeExcluirContrato":true,"podeExportarPDF":true,"podeUsarPortabilidade":true,"podeDefinirTaxaRef":true,"podeVerGrafico":true}',
   now(), '', 0),
  ('demo-padrao', 'Usuário Demo', 'demo@consig.com', 'demo123', 'comum', false, 5, 0, '',
   '{"podeAdicionarContrato":true,"podeExcluirContrato":true,"podeExportarPDF":true,"podeUsarPortabilidade":true,"podeDefinirTaxaRef":true,"podeVerGrafico":true}',
   now(), '', 0)
on conflict (id) do nothing;

-- ============================================================
--  PRONTO! Depois:
--  1. Vá em Project Settings → API
--  2. Copie Project URL e anon public key
--  3. Cole em public/supabase-config.json  OU
--     no Netlify: Site settings → Environment variables
--       VITE_SUPABASE_URL
--       VITE_SUPABASE_ANON_KEY
-- ============================================================
