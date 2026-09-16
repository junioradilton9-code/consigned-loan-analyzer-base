import { useState, useEffect, useRef } from 'react';
import {
  lerConfig, salvarConfig, desligarNuvem, testarConexao, nuvemAtiva,
  gerarBackup, restaurarBackup,
} from '../utils/cloudDb';
import { lerUsuarios, sincronizarUsuariosDaNuvem } from '../utils/users';

const SQL_SCHEMA_URL = 'https://supabase.com/dashboard';
const ORIGEM_TXT: Record<string, string> = {
  ambiente: 'variáveis de ambiente (Netlify)',
  arquivo: 'arquivo do projeto (compartilhado)',
  navegador: 'salvo apenas neste navegador',
  nenhuma: 'nenhuma',
};

const SQL_SCRIPT = `-- CORREÇÃO: adiciona colunas novas caso a tabela já exista de uma versão antiga
alter table public.usuarios add column if not exists sessao_token text default '';
alter table public.usuarios add column if not exists sessao_dispositivo text default '';
alter table public.usuarios add column if not exists contratos_criados integer default 0;
alter table public.usuarios add column if not exists acessos_simultaneos integer default 0;

create table if not exists public.usuarios (
  id text primary key, nome text not null, email text unique not null,
  senha text not null, role text default 'comum', bloqueado boolean default false,
  limite_contratos integer default 0, acessos_simultaneos integer default 0, data_expiracao text default '',
  permissoes jsonb default '{}', criado_em timestamptz default now(),
  ultimo_acesso text default '', contratos_criados integer default 0,
  sessao_token text default '', sessao_dispositivo text default '',
  atualizado_em timestamptz default now());

create table if not exists public.contratos (
  id text primary key,
  usuario_id text references public.usuarios(id) on delete cascade,
  banco text default '', valor_liberado numeric default 0,
  parcela numeric default 0, prazo integer default 0,
  meses_pagos integer, valor_bruto_restante numeric,
  criado_em timestamptz default now());

create table if not exists public.configuracoes (
  usuario_id text primary key references public.usuarios(id) on delete cascade,
  taxa_ref numeric, atualizado_em timestamptz default now());

create table if not exists public.tabelas_coeficientes (
  id text primary key, usuario_id text default 'global', convenio text not null, codigo text not null,
  nome text not null, empregador text default '', prazos jsonb default '[]',
  tc numeric default 0, oficial boolean default false, linhas jsonb default '[]',
  atualizado_em timestamptz default now());
alter table public.tabelas_coeficientes add column if not exists usuario_id text default 'global';

-- Liberar acesso via anon key
alter table public.usuarios enable row level security;
alter table public.contratos enable row level security;
alter table public.configuracoes enable row level security;
alter table public.tabelas_coeficientes enable row level security;
create policy "all_usuarios" on public.usuarios for all using (true) with check (true);
create policy "all_contratos" on public.contratos for all using (true) with check (true);
create policy "all_config" on public.configuracoes for all using (true) with check (true);
create policy "all_tabelas" on public.tabelas_coeficientes for all using (true) with check (true);

-- Insere Master e Demo (não sobrescreve existentes)
insert into public.usuarios (id, nome, email, senha, role, bloqueado, limite_contratos, acessos_simultaneos, data_expiracao, permissoes, criado_em, ultimo_acesso, contratos_criados)
values
  ('master-padrao', 'Master Admin', 'master@consig.com', 'master123', 'master', false, 0, 0, '',
   '{"podeAdicionarContrato":true,"podeExcluirContrato":true,"podeExportarPDF":true,"podeUsarPortabilidade":true,"podeDefinirTaxaRef":true,"podeVerGrafico":true}',
   now(), '', 0),
  ('demo-padrao', 'Usuário Demo', 'demo@consig.com', 'demo123', 'comum', false, 5, 0, '',
   '{"podeAdicionarContrato":true,"podeExcluirContrato":true,"podeExportarPDF":true,"podeUsarPortabilidade":true,"podeDefinirTaxaRef":true,"podeVerGrafico":true}',
   now(), '', 0)
on conflict (id) do nothing;`;

export default function CloudConfig({ onSync }: { onSync?: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [ativo, setAtivo] = useState(false);
  const [origem, setOrigem] = useState<string>('nenhuma');
  const [msg, setMsg] = useState('');
  const [testando, setTestando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mostrarSql, setMostrarSql] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const [sqlCopiado, setSqlCopiado] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function copiarSql() {
    navigator.clipboard?.writeText(SQL_SCRIPT)
      .then(() => { setSqlCopiado(true); setTimeout(() => setSqlCopiado(false), 2500); })
      .catch(() => {
        // fallback: seleciona o bloco para cópia manual
        const pre = document.getElementById('sql-bloco');
        if (pre) {
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          sel?.removeAllRanges(); sel?.addRange(range);
        }
      });
  }

  useEffect(() => {
    const { cfg, origem: o } = lerConfig();
    setUrl(cfg.url);
    setKey(cfg.anonKey);
    setOrigem(o);
    setAtivo(cfg.ativo && nuvemAtiva());
  }, []);

  async function salvarETestar() {
    if (!url.trim() || !key.trim()) { setMsg('⚠️ Preencha a URL e a anon key do Supabase.'); return; }
    setTestando(true); setMsg('🔄 Testando conexão...');
    salvarConfig({ url: url.trim(), anonKey: key.trim(), ativo: true });
    const r = await testarConexao();
    setTestando(false);
    if (r.ok) { setAtivo(true); setOrigem('navegador'); setMsg('✅ Conectado! Os dados agora sincronizam entre computadores.'); onSync?.(); }
    else { setAtivo(false); setMsg(`❌ Falha: ${r.erro}. Verifique a URL/key e se o SQL foi executado.`); }
  }

  function desconectar() {
    if (!confirm('Desconectar do banco na nuvem NESTE computador? Os dados locais continuam salvos aqui. (Em outros computadores a conexão embutida continua ativa.)')) return;
    desligarNuvem(); setUrl(''); setKey(''); setAtivo(false); setOrigem('navegador');
    setMsg('🔌 Nuvem desligada neste computador. Rodando apenas com dados locais.');
  }

  async function enviarTudo() {
    if (!nuvemAtiva()) { setMsg('⚠️ Configure e conecte primeiro.'); return; }
    setEnviando(true); setMsg('⬆️ Enviando dados locais para a nuvem...');
    try {
      // Usa a mesma função da sincronização automática (merge, sem apagar)
      const { enviarDadosLocaisParaNuvem } = await import('../utils/cloudDb');
      await enviarDadosLocaisParaNuvem();
      setMsg('✅ Dados enviados para a nuvem (usuários, contratos, taxas e tabelas).');
      onSync?.();
    } catch (e: any) { setMsg('❌ Erro ao enviar: ' + (e?.message || 'desconhecido')); }
    setEnviando(false);
  }

  async function baixarTudo() {
    if (!nuvemAtiva()) { setMsg('⚠️ Configure e conecte primeiro.'); return; }
    setEnviando(true); setMsg('⬇️ Baixando dados da nuvem...');
    try {
      // 1) Usuários
      const n = await sincronizarUsuariosDaNuvem();
      // 2) Tabelas customizadas GLOBAIS
      try {
        const { nuvemBaixarTabelas } = await import('../utils/cloudDb');
        const { sincronizarTabelasDaNuvem } = await import('../utils/coeficientes');
        const tabsGlobais = await nuvemBaixarTabelas('global');
        if (tabsGlobais) (['governo', 'siape', 'inss'] as const).forEach((conv) =>
          sincronizarTabelasDaNuvem(conv, tabsGlobais[conv] || [], 'global'));

        // 3) Tabelas específicas de cada usuário
        const usuarios = lerUsuarios();
        for (const u of usuarios) {
          const tabsUser = await nuvemBaixarTabelas(u.id);
          if (tabsUser) (['governo', 'siape', 'inss'] as const).forEach((conv) =>
            sincronizarTabelasDaNuvem(conv, tabsUser[conv] || [], u.id));
        }
      } catch { /* offline */ }

      setMsg(`✅ ${n} usuário(s) e tabelas específicas baixados. Contratos e taxa de referência continuam individuais por acesso.`);
      onSync?.();
    } catch (e: any) { setMsg('❌ Erro ao baixar: ' + (e?.message || 'desconhecido')); }
    setEnviando(false);
  }

  // ── Backup / Restauração (arquivo JSON) ─────────────────────────
  function exportarBackup() {
    try {
      const b = gerarBackup();
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup-consignado-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMsg(`✅ Backup gerado: ${b.usuarios.length} usuário(s), ${Object.values(b.contratos).reduce((s, c) => s + c.length, 0)} contrato(s), ${Object.values(b.tabelas).reduce((s, t) => s + t.length, 0)} tabela(s).`);
    } catch (e: any) { setMsg('❌ Erro ao gerar backup: ' + (e?.message || 'desconhecido')); }
  }

  async function importarBackup(file: File) {
    try {
      const texto = await file.text();
      const b = JSON.parse(texto);
      if (!confirm('Restaurar este backup? Isso VAI SOBRESCRIVER os dados atuais deste navegador.')) return;
      const r = restaurarBackup(b);
      setMsg(r.msg);
      if (r.ok) {
        const { cfg, origem: o } = lerConfig();
        setUrl(cfg.url); setKey(cfg.anonKey); setOrigem(o); setAtivo(cfg.ativo && nuvemAtiva());
        onSync?.();
      }
    } catch { setMsg('❌ Arquivo de backup inválido.'); }
  }

  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0', fontSize: '.85rem', fontFamily: 'monospace' };
  const lbl: React.CSSProperties = { fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 };

  return (
    <section className="card cloud-config no-print" style={{ background: '#0f172a', border: `1px solid ${ativo ? '#10b981' : '#f59e0b'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: 0 }}>
          ☁️ Sincronizar dados entre computadores
          <span style={{
            fontSize: '.66rem', fontWeight: 800, padding: '4px 12px', borderRadius: 999,
            background: ativo ? '#052e16' : '#450a0a', color: ativo ? '#4ade80' : '#f87171',
            border: `1px solid ${ativo ? '#166534' : '#991b1b'}`, textTransform: 'uppercase', letterSpacing: '.05em',
          }}>
            {ativo ? '🟢 Conectado' : '🔴 Somente local'}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setExpandido(!expandido)}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            color: '#94a3b8', fontSize: '.8rem', fontWeight: 700, padding: '6px 14px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          }}
        >
          {expandido ? '🔼 Ocultar' : '🔽 Configurar'}
        </button>
      </div>

      {expandido && (<>
      {/* Aviso claro quando a nuvem está INATIVA */}
      {!ativo && (
        <div style={{
          background: 'linear-gradient(135deg,#451a03,#78350f)', border: '1.5px solid #f59e0b',
          color: '#fde68a', padding: '12px 16px', borderRadius: 10, marginBottom: 14, fontSize: '.82rem', fontWeight: 600, lineHeight: 1.55,
        }}>
          ⚠️ <b>Seus dados estão guardados SÓ neste navegador.</b> Ao abrir em outra máquina, eles NÃO aparecem.
          Para resolver, <b>conecte a nuvem abaixo</b> ou use <b>Backup</b> (botão azul) para levar os dados em um arquivo.
        </div>
      )}

      <p style={{ fontSize: '.82rem', color: '#94a3b8', marginBottom: 14 }}>
        Conecta automaticamente ao banco <b>Supabase</b> para usuários, senhas, contratos e tabelas
        ficarem salvos <b>em qualquer computador</b>. Os dados são sincronizados sozinhos ao abrir o app
        e a cada alteração — sem precisar clicar em nada.
        {ativo && <> Conexão ativa via <b style={{ color: '#4ade80' }}>{ORIGEM_TXT[origem]}</b>.</>}
      </p>

      {/* Passo a passo */}
      <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 12, padding: 14, marginBottom: 16, fontSize: '.8rem', color: '#cbd5e1', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 800, color: '#4ade80', marginBottom: 8 }}>✅ Conexão já configurada (embutida no código)</div>
        <div>A URL e a chave do banco já estão gravadas no arquivo
          <code style={{ background: '#334155', padding: '1px 6px', borderRadius: 4, margin: '0 3px' }}>src/utils/cloudConfig.ts</code>.
          Por isso o app conecta e sincroniza <b>automaticamente em qualquer computador</b>, sem precisar
          digitar nada. Se quiser trocar de banco, é só editar esse arquivo (ou definir
          <code style={{ background: '#334155', padding: '1px 5px', borderRadius: 4 }}>VITE_SUPABASE_URL</code> /
          <code style={{ background: '#334155', padding: '1px 5px', borderRadius: 4 }}>VITE_SUPABASE_ANON_KEY</code> no Netlify).</div>
        <div style={{ marginTop: 8, fontSize: '.74rem', color: '#94a3b8' }}>
          ℹ️ Se a conexão falhar, verifique se o banco foi criado e se as tabelas foram executadas
          (arquivo <code style={{ background: '#334155', padding: '1px 5px', borderRadius: 4 }}>supabase-schema.sql</code> no
          SQL Editor do <a href={SQL_SCHEMA_URL} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>supabase.com</a>).
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setMostrarSql(!mostrarSql)}
            style={{ background: 'transparent', border: 'none', color: '#60a5fa', fontSize: '.76rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
            {mostrarSql ? '🔽 Ocultar' : '📄 Ver'} SQL de criação das tabelas
          </button>
          <button type="button" onClick={copiarSql}
            style={{
              background: sqlCopiado ? '#052e16' : '#1e293b',
              border: `1px solid ${sqlCopiado ? '#22c55e' : '#475569'}`,
              color: sqlCopiado ? '#4ade80' : '#e2e8f0',
              fontSize: '.76rem', fontWeight: 700, cursor: 'pointer',
              padding: '5px 12px', borderRadius: 8,
            }}>
            {sqlCopiado ? '✅ SQL copiado!' : '📋 Copiar SQL'}
          </button>
        </div>
        {mostrarSql && (
          <pre id="sql-bloco" style={{ marginTop: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 12, fontSize: '.7rem', color: '#cbd5e1', overflow: 'auto', maxHeight: 260, lineHeight: 1.5, whiteSpace: 'pre', userSelect: 'text' }}>{SQL_SCRIPT}</pre>
        )}
      </div>

      {/* Campos */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
        <div><div style={lbl}>PROJECT URL</div><input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxxxxxx.supabase.co" style={inp} /></div>
        <div><div style={lbl}>ANON PUBLIC KEY</div><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style={inp} /></div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn-primario" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={salvarETestar} disabled={testando}>
          {testando ? '🔄 Testando...' : '🔌 Conectar e testar'}
        </button>
        <button className="btn-ouro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={enviarTudo} disabled={!ativo || enviando}>⬆️ Enviar dados locais</button>
        <button className="btn-neutro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={baixarTudo} disabled={!ativo || enviando}>⬇️ Baixar da nuvem</button>
        {ativo && <button className="btn-neutro" style={{ fontSize: '.82rem', padding: '10px 18px', color: '#f87171' }} onClick={desconectar}>🔌 Desconectar</button>}
      </div>

      {/* ── BACKUP / RESTAURAÇÃO ─────────────────────────── */}
      <div style={{ marginTop: 20, background: '#1e293b', border: '1px solid #3b82f6', borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, color: '#e2e8f0', fontSize: '.9rem', marginBottom: 6 }}>💾 Backup completo (arquivo)</div>
        <p style={{ fontSize: '.78rem', color: '#94a3b8', margin: '0 0 12px', lineHeight: 1.5 }}>
          Salve um arquivo com <b>TODOS</b> os dados (usuários, senhas, contratos, taxas e tabelas). Depois, abra esse arquivo em qualquer outro computador para recuperar tudo — <b>funciona sem a nuvem</b>.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ouro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={exportarBackup}>⬇️ Baixar backup (.json)</button>
          <button className="btn-neutro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={() => fileRef.current?.click()}>⬆️ Restaurar de backup</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importarBackup(f); e.target.value = ''; }} />
        </div>
      </div>

      {msg && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          background: msg.startsWith('✅') ? '#052e16' : msg.startsWith('❌') || msg.startsWith('⚠️') ? '#450a0a' : '#1e293b',
          color: msg.startsWith('✅') ? '#4ade80' : msg.startsWith('❌') || msg.startsWith('⚠️') ? '#f87171' : '#93c5fd',
          fontSize: '.82rem', fontWeight: 600,
        }}>{msg}</div>
      )}
      </>)}
    </section>
  );
}
