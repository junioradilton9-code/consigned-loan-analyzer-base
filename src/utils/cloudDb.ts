import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Usuario } from './users';
import type { Contrato } from './financeiro';
import type { TabelaFator, Convenio } from './coeficientes';
import { configDoArquivo, type CloudConfig, type OrigemConfig } from './cloudConfig';

// ══════════════════════════════════════════════════════
//  CONFIGURAÇÃO
//  A URL/anon key podem vir de variáveis de ambiente (build)
//  ou serem salvas pelo master direto na interface.
// ══════════════════════════════════════════════════════
const CHAVE_CFG = 'consig_supabase_cfg';

export interface LerConfigResultado {
  cfg: CloudConfig;
  origem: OrigemConfig;
}

export function lerConfig(): LerConfigResultado {
  // 1) Variáveis de ambiente (Netlify → Environment variables)
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
  if (envUrl && envKey) return { cfg: { url: envUrl, anonKey: envKey, ativo: true }, origem: 'ambiente' };

  // 2) Override manual pelo master na interface (só neste navegador)
  try {
    const raw = localStorage.getItem(CHAVE_CFG);
    if (raw) {
      const c = JSON.parse(raw) as CloudConfig;
      // Desconexão explícita pelo master tem prioridade sobre a config embutida
      if (c.ativo === false) return { cfg: { url: c.url, anonKey: c.anonKey, ativo: false }, origem: 'navegador' };
      if (c.url && c.anonKey) return { cfg: { ...c, ativo: true }, origem: 'navegador' };
    }
  } catch { /* ignora */ }

  // 3) Arquivo do projeto — embutida no código, compartilhada entre TODAS as máquinas
  const doArq = configDoArquivo();
  if (doArq.ativo) return { cfg: doArq, origem: 'arquivo' };

  return { cfg: { url: '', anonKey: '', ativo: false }, origem: 'nenhuma' };
}

export function salvarConfig(cfg: CloudConfig): void {
  localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg));
  _client = null; // força recriar o client
}

/** Desliga a nuvem explicitamente (fica salvo neste navegador) */
export function desligarNuvem(): void {
  localStorage.setItem(CHAVE_CFG, JSON.stringify({ url: '', anonKey: '', ativo: false }));
  _client = null;
}

export function limparConfig(): void {
  localStorage.removeItem(CHAVE_CFG);
  _client = null;
}

let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  const { cfg } = lerConfig();
  if (!cfg.ativo || !cfg.url || !cfg.anonKey) return null;
  if (!_client) {
    try {
      _client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false },
      });
    } catch {
      return null;
    }
  }
  return _client;
}

export function nuvemAtiva(): boolean {
  return getClient() !== null;
}

export async function testarConexao(): Promise<{ ok: boolean; erro?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, erro: 'Configuração ausente ou inválida.' };
  try {
    const { error } = await sb.from('usuarios').select('id').limit(1);
    if (error) return { ok: false, erro: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e?.message || 'Falha de rede' };
  }
}

// ══════════════════════════════════════════════════════
//  MAPEAMENTO (camelCase ↔ snake_case)
// ══════════════════════════════════════════════════════
function userParaDb(u: Usuario) {
  // Fallbacks dentro do JSON "permissoes": mesmo que o Supabase esteja com
  // schema antigo sem as colunas novas, os dados críticos continuam salvos.
  const permissoesComMeta = {
    ...(u.permissoes || {}),
    __acessosSimultaneos: u.acessosSimultaneos ?? 0,
    __sessaoToken: u.sessaoToken || '',
    __sessaoDispositivo: u.sessaoDispositivo || '',
  };
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    senha: u.senha,
    role: u.role,
    bloqueado: u.bloqueado,
    limite_contratos: u.limiteContratos,
    acessos_simultaneos: u.acessosSimultaneos ?? 0,
    data_expiracao: u.dataExpiracao || '',
    permissoes: permissoesComMeta,
    ultimo_acesso: u.ultimoAcesso || '',
    contratos_criados: u.contratosCriados || 0,
    deletado_em: u.deletadoEm || null,
    sessao_token: u.sessaoToken || '',
    sessao_dispositivo: u.sessaoDispositivo || '',
    atualizado_em: new Date().toISOString(),
  };
}

/** Versão sem colunas novas — fallback para schemas antigos */
function userParaDbBasico(u: Usuario) {
  const { sessao_token, sessao_dispositivo, acessos_simultaneos, ...rest } = userParaDb(u);
  void sessao_token; void sessao_dispositivo; void acessos_simultaneos;
  return rest;
}

function dbParaUser(r: any): Usuario {
  const permissoes = r.permissoes || {};
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    senha: r.senha,
    role: r.role,
    bloqueado: !!r.bloqueado,
    limiteContratos: r.limite_contratos ?? 0,
    acessosSimultaneos: r.acessos_simultaneos ?? permissoes.__acessosSimultaneos ?? 0,
    dataExpiracao: r.data_expiracao || '',
    permissoes,
    criadoEm: r.criado_em || new Date().toISOString(),
    ultimoAcesso: r.ultimo_acesso || '',
    contratosCriados: r.contratos_criados ?? 0,
    deletadoEm: r.deletado_em || r.deleted_at || '',
    sessaoToken: r.sessao_token || permissoes.__sessaoToken || '',
    sessaoDispositivo: r.sessao_dispositivo || permissoes.__sessaoDispositivo || '',
  };
}

function contratoParaDb(c: Contrato, usuarioId: string) {
  return {
    id: String(c.id),
    usuario_id: usuarioId,
    banco: c.banco,
    valor_liberado: c.valorLiberado,
    parcela: c.parcela,
    prazo: c.prazo,
    meses_pagos: c.mesesPagos ?? null,
    valor_bruto_restante: c.valorBrutoRestante ?? null,
  };
}

function dbParaContrato(r: any): Contrato {
  const c: Contrato = {
    id: r.id,
    banco: r.banco,
    valorLiberado: Number(r.valor_liberado),
    parcela: Number(r.parcela),
    prazo: Number(r.prazo),
  };
  if (r.meses_pagos !== null && r.meses_pagos !== undefined) c.mesesPagos = Number(r.meses_pagos);
  if (r.valor_bruto_restante !== null && r.valor_bruto_restante !== undefined)
    c.valorBrutoRestante = Number(r.valor_bruto_restante);
  return c;
}

// ══════════════════════════════════════════════════════
//  USUÁRIOS
// ══════════════════════════════════════════════════════
export async function nuvemBaixarUsuarios(): Promise<Usuario[] | null> {
  const sb = getClient(); if (!sb) return null;
  try {
    // Primeiro tenta com todas as colunas
    let resp = await sb.from('usuarios').select('*');
    if (resp.error) {
      // Schema antigo: colunas novas podem faltar — seleciona só as básicas
      resp = await sb.from('usuarios').select(
        'id,nome,email,senha,role,bloqueado,limite_contratos,data_expiracao,permissoes,criado_em,ultimo_acesso,contratos_criados'
      );
    }
    if (resp.error || !resp.data) return null;
    return resp.data
      .filter((r: any) => !(r.deletado_em || r.deleted_at))
      .map(dbParaUser);
  } catch {
    return null;
  }
}

async function protegerSessoesRemotas(lista: Usuario[], sb: SupabaseClient): Promise<Usuario[] | null> {
  const sessaoId = localStorage.getItem('consig_session_id');
  const sessaoToken = localStorage.getItem('consig_session_token');
  const ids = lista.map(u => u.id);
  if (!ids.length) return lista;

  const { data, error } = await sb
    .from('usuarios')
    .select('id, sessao_token, sessao_dispositivo')
    .in('id', ids);
  if (error) {
    // Bancos antigos não possuem essas colunas; nesse caso o fallback básico
    // continua seguro porque não há sessão remota para preservar.
    if (/sessao_token|sessao_dispositivo|column/i.test(error.message)) return lista;
    return null;
  }

  const remotos = new Map((data || []).map((u: any) => [u.id, u]));
  return lista.map(u => {
    const remoto = remotos.get(u.id);
    const eSessaoAtual = u.id === sessaoId && !!sessaoToken;
    if (!remoto || eSessaoAtual) return u;
    return {
      ...u,
      sessaoToken: remoto.sessao_token,
      sessaoDispositivo: remoto.sessao_dispositivo,
    };
  });
}

/**
 * Salva usuários na nuvem. Se o schema for antigo (faltando colunas novas),
 * retenta usando apenas colunas básicas e guarda os extras dentro de permissoes.
 */
async function upsertUsuarios(lista: Usuario[]): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  const ativosOriginais = lista.filter(u => !(u.deletadoEm || (u as any).deletedAt));
  const ativos = await protegerSessoesRemotas(ativosOriginais, sb);
  if (!ativos) return false;
  if (!ativos.length) return true;
  try {
    const ids = ativos.map(u => u.id);
    const { data: existentes, error: selErr } = await sb.from('usuarios').select('id, deletado_em, deleted_at').in('id', ids);
    if (!selErr && existentes?.length) {
      const tombstones = new Set(
        existentes
          .filter((r: any) => r.deletado_em || r.deleted_at)
          .map((r: any) => r.id)
      );
      const pendentes = ativos.filter(u => !tombstones.has(u.id));
      if (!pendentes.length) return true;
      const { error } = await sb.from('usuarios').upsert(pendentes.map(userParaDb), { onConflict: 'id' });
      if (!error) return true;
      // Schema antigo: faltam colunas novas — tenta sem elas
      if (/sessao_token|sessao_dispositivo|acessos_simultaneos|column/i.test(error.message)) {
        const { error: e2 } = await sb.from('usuarios').upsert(pendentes.map(userParaDbBasico), { onConflict: 'id' });
        return !e2;
      }
      return false;
    }

    const { error } = await sb.from('usuarios').upsert(ativos.map(userParaDb), { onConflict: 'id' });
    if (!error) return true;
    // Schema antigo: faltam colunas novas — tenta sem elas
    if (/sessao_token|sessao_dispositivo|acessos_simultaneos|column/i.test(error.message)) {
      const { error: e2 } = await sb.from('usuarios').upsert(ativos.map(userParaDbBasico), { onConflict: 'id' });
      return !e2;
    }
    return false;
  } catch {
    return false;
  }
}

export async function nuvemSalvarUsuarios(lista: Usuario[]): Promise<boolean> {
  return upsertUsuarios(lista);
}

export async function nuvemSalvarUsuario(u: Usuario): Promise<boolean> {
  return upsertUsuarios([u]);
}

export async function nuvemRemoverUsuario(id: string): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { error } = await sb.from('usuarios').update({ deletado_em: new Date().toISOString() }).eq('id', id);
    if (!error) return true;
  } catch { /* fallback para schema antigo */ }

  const { error } = await sb.from('usuarios').delete().eq('id', id);
  return !error;
}

// ══════════════════════════════════════════════════════
//  CONTRATOS
// ══════════════════════════════════════════════════════
export async function nuvemBaixarContratos(usuarioId: string): Promise<Contrato[] | null> {
  const sb = getClient(); if (!sb) return null;
  try {
    const { data, error } = await sb.from('contratos').select('*').eq('usuario_id', usuarioId);
    if (error || !data) return null;
    return data.map(dbParaContrato);
  } catch { return null; }
}

/** Substitui todos os contratos do usuário na nuvem pelo array informado */
export async function nuvemSalvarContratos(usuarioId: string, lista: Contrato[]): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { error: delErr } = await sb.from('contratos').delete().eq('usuario_id', usuarioId);
    if (delErr) return false;
    if (!lista.length) return true;
    const { error } = await sb.from('contratos').insert(lista.map(c => contratoParaDb(c, usuarioId)));
    return !error;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════
//  CONFIGURAÇÕES (taxa de referência)
// ══════════════════════════════════════════════════════
export async function nuvemBaixarTaxaRef(usuarioId: string): Promise<number | null> {
  const sb = getClient(); if (!sb) return null;
  try {
    const { data, error } = await sb.from('configuracoes').select('taxa_ref').eq('usuario_id', usuarioId).maybeSingle();
    if (error || !data || data.taxa_ref === null) return null;
    return Number(data.taxa_ref);
  } catch { return null; }
}

export async function nuvemSalvarTaxaRef(usuarioId: string, taxa: number): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { error } = await sb.from('configuracoes').upsert(
      { usuario_id: usuarioId, taxa_ref: isNaN(taxa) ? null : taxa, atualizado_em: new Date().toISOString() },
      { onConflict: 'usuario_id' }
    );
    return !error;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════
//  TABELAS DE COEFICIENTES
// ══════════════════════════════════════════════════════
export async function nuvemBaixarTabelas(usuarioId = 'global'): Promise<Record<string, TabelaFator[]> | null> {
  const sb = getClient(); if (!sb) return null;
  try {
    let resp = await sb.from('tabelas_coeficientes').select('*');
    if (resp.error) {
      resp = await sb.from('tabelas_coeficientes').select(
        'id,convenio,codigo,nome,empregador,prazos,tc,oficial,linhas'
      );
    }
    if (resp.error || !resp.data) return null;
    const out: Record<string, TabelaFator[]> = { governo: [], siape: [], inss: [] };
    for (const r of resp.data) {
      const dono = r.usuario_id || 'global';
      if (dono !== usuarioId) continue;
      const t: TabelaFator = {
        id: r.id,
        convenio: r.convenio,
        codigo: r.codigo,
        nome: r.nome,
        empregador: r.empregador || '',
        prazos: r.prazos || [],
        tc: Number(r.tc) || 0,
        oficial: !!r.oficial,
        linhas: r.linhas || [],
      };
      (out[r.convenio] ||= []).push(t);
    }
    return out;
  } catch { return null; }
}

export async function nuvemSalvarTabela(conv: Convenio, tabela: TabelaFator, usuarioId = 'global'): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { normalizarTabela } = await import('./coeficientes');
    const t = normalizarTabela(tabela);
    const payload = {
      id: `${usuarioId}__${conv}__${t.codigo}`,
      usuario_id: usuarioId,
      convenio: conv,
      codigo: t.codigo,
      nome: t.nome,
      empregador: t.empregador,
      prazos: t.prazos,
      tc: t.tc,
      oficial: t.oficial,
      linhas: t.linhas,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await sb.from('tabelas_coeficientes').upsert(payload, { onConflict: 'id' });
    if (!error) return true;
    if (/usuario_id|column/i.test(error.message)) {
      const { id, usuario_id, ...rest } = payload;
      const { error: e2 } = await sb.from('tabelas_coeficientes').upsert({ ...rest }, { onConflict: 'id' });
      return !e2;
    }
    return false;
  } catch { return false; }
}

export async function nuvemRemoverTabelasConvenio(conv: Convenio, usuarioId = 'global'): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { error } = await sb.from('tabelas_coeficientes').delete().eq('convenio', conv).eq('usuario_id', usuarioId);
    return !error;
  } catch { return false; }
}

export async function nuvemRemoverTabelaPorCodigo(conv: Convenio, codigo: string, usuarioId = 'global'): Promise<boolean> {
  const sb = getClient(); if (!sb) return false;
  try {
    const { error } = await sb.from('tabelas_coeficientes').delete().eq('id', `${usuarioId}__${conv}__${codigo}`);
    return !error;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════
//  SINCRONIZAÇÃO AUTOMÁTICA BILATERAL
//  IMPORTANTE: contratos, taxaRef e resultado da portabilidade são
//  INDIVIDUAIS por ACESSO simultâneo (workspace local por sessão).
//  A nuvem sincroniza apenas usuários e tabelas de coeficientes.
// ══════════════════════════════════════════════════════════════════
export async function enviarDadosLocaisParaNuvem(): Promise<void> {
  const sb = getClient(); if (!sb) return;

  try {
    // 1) Usuários
    let usuarios = lerUsuarios();
    let podeEnviarUsuarios = true;
    const sessaoId = localStorage.getItem('consig_session_id');
    const sessaoToken = localStorage.getItem('consig_session_token');

    // A lista local pode conter um token antigo mesmo sem haver uma sessão
    // ativa neste navegador. Nunca deixe esse cache substituir a sessão
    // válida de outro dispositivo durante a sincronização automática.
    if (!sessaoId || !sessaoToken) {
      const remotos = await nuvemBaixarUsuarios();
      if (remotos === null) podeEnviarUsuarios = false;
      if (remotos?.length) {
        const porId = new Map(remotos.map(u => [u.id, u]));
        usuarios = usuarios.map(u => {
          const remoto = porId.get(u.id);
          if (!remoto) return u;
          return {
            ...u,
            sessaoToken: remoto.sessaoToken,
            sessaoDispositivo: remoto.sessaoDispositivo,
          };
        });
      }
    }
    if (podeEnviarUsuarios && usuarios.length) {
      await nuvemSalvarUsuarios(usuarios);
    }

    // 2) Tabelas globais antigas
    for (const conv of ['governo', 'siape', 'inss'] as const) {
      for (const t of lerDeltaConv(conv)) {
        await nuvemSalvarTabela(conv, t, 'global');
      }
    }

    // 3) Tabelas específicas por usuário (varre todas as chaves locais)
    try {
      const chaves = Object.keys(localStorage)
        .filter(k => k.startsWith('consig_tabelas_custom_') && !/^consig_tabelas_custom_(governo|siape|inss)$/.test(k));
      for (const k of chaves) {
        const m = k.match(/^consig_tabelas_custom_(.+)_(governo|siape|inss)$/);
        if (!m) continue;
        const usuarioId = m[1];
        const conv = m[2] as Convenio;
        const arr = JSON.parse(localStorage.getItem(k) || '[]') as TabelaFator[];
        for (const t of arr) {
          await nuvemSalvarTabela(conv, t, usuarioId);
        }
      }
    } catch { /* ignore */ }
  } catch {
    // Offline ou falha de rede — mantém dados locais, tenta de novo na próxima abertura
  }
}

// ══════════════════════════════════════════════════════════════════
//  BACKUP / RESTAURAÇÃO COMPLETA (arquivo JSON)
//  Permite levar TODOS os dados de uma máquina para outra,
//  mesmo sem a nuvem configurada.
// ══════════════════════════════════════════════════════════════════
import { lerUsuarios } from './users';
import type { TabelaFator as _TF } from './coeficientes';

// Leitura dos deltas de tabelas customizadas (mesmo schema do localStorage)
function lerDeltaConv(conv: string): _TF[] {
  try {
    const raw = localStorage.getItem(`consig_tabelas_custom_${conv}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function salvarDeltaConv(conv: string, arr: _TF[]) {
  if (arr.length) localStorage.setItem(`consig_tabelas_custom_${conv}`, JSON.stringify(arr));
  else localStorage.removeItem(`consig_tabelas_custom_${conv}`);
}

function lerTodasTabelasCustomizadas(): Record<string, _TF[]> {
  const out: Record<string, _TF[]> = {};
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('consig_tabelas_custom_'))
      .forEach((k) => {
        try { out[k] = JSON.parse(localStorage.getItem(k) || '[]') || []; }
        catch { out[k] = []; }
      });
  } catch { /* ignore */ }
  return out;
}

function restaurarTodasTabelasCustomizadas(tabelas: Record<string, _TF[]> | undefined) {
  if (!tabelas) return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('consig_tabelas_custom_'))
      .forEach((k) => localStorage.removeItem(k));
    Object.entries(tabelas).forEach(([k, v]) => {
      if (Array.isArray(v) && k.startsWith('consig_tabelas_custom_')) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    });
  } catch { /* ignore */ }
}
function lerContratosDe(uid: string): Contrato[] {
  try {
    const token = localStorage.getItem('consig_session_token') || 'local';
    const raw = localStorage.getItem(`consig_contratos_${uid}_${token}`)
      || localStorage.getItem(`consig_contratos_${uid}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function lerTaxaDe(uid: string): number {
  const token = localStorage.getItem('consig_session_token') || 'local';
  const v = parseFloat(
    localStorage.getItem(`consig_taxaRef_${uid}_${token}`)
      || localStorage.getItem(`consig_taxaRef_${uid}`)
      || 'NaN'
  );
  return v;
}

export interface BackupCompleto {
  versao: number;
  geradoEm: string;
  usuarios: Usuario[];
  contratos: Record<string, Contrato[]>;   // chave = id do usuário
  taxaRef: Record<string, number>;          // chave = id do usuário
  tabelas: Record<string, _TF[]>;           // legado: chave = convenio
  tabelasPorChave?: Record<string, _TF[]>;  // novo: todas as chaves localStorage (por usuário também)
  cloudConfig: { url: string; anonKey: string } | null;
}

/** Gera o backup completo de tudo o que está neste navegador */
export function gerarBackup(): BackupCompleto {
  const usuarios = lerUsuarios();
  const contratos: Record<string, Contrato[]> = {};
  const taxaRef: Record<string, number> = {};
  usuarios.forEach((u) => {
    contratos[u.id] = lerContratosDe(u.id);
    taxaRef[u.id] = lerTaxaDe(u.id);
  });
  const tabelas: Record<string, _TF[]> = {
    governo: lerDeltaConv('governo'),
    siape: lerDeltaConv('siape'),
    inss: lerDeltaConv('inss'),
  };
  const tabelasPorChave = lerTodasTabelasCustomizadas();
  const { cfg } = lerConfig();
  return {
    versao: 1,
    geradoEm: new Date().toISOString(),
    usuarios,
    contratos,
    taxaRef,
    tabelas,
    tabelasPorChave,
    cloudConfig: cfg.url ? { url: cfg.url, anonKey: cfg.anonKey } : null,
  };
}

/** Restaura um backup completo para este navegador */
export function restaurarBackup(b: BackupCompleto): { ok: boolean; msg: string } {
  try {
    if (!b || b.versao !== 1 || !Array.isArray(b.usuarios)) {
      return { ok: false, msg: 'Arquivo de backup inválido.' };
    }
    // Usuários
    localStorage.setItem('consig_users', JSON.stringify(b.usuarios));
    // Contratos + taxa: grava na sessão atual e também na chave legada para
    // que backups restaurados antes do login continuem disponíveis.
    const token = localStorage.getItem('consig_session_token') || 'local';
    b.usuarios.forEach((u) => {
      if (b.contratos[u.id]) {
        const dados = JSON.stringify(b.contratos[u.id]);
        localStorage.setItem(`consig_contratos_${u.id}_${token}`, dados);
        localStorage.setItem(`consig_contratos_${u.id}`, dados);
      }
      if (b.taxaRef[u.id] !== undefined) {
        const taxa = isNaN(b.taxaRef[u.id]) ? '' : String(b.taxaRef[u.id]);
        localStorage.setItem(`consig_taxaRef_${u.id}_${token}`, taxa);
        localStorage.setItem(`consig_taxaRef_${u.id}`, taxa);
      }
    });
    // Tabelas customizadas (novo formato preserva escopo por usuário)
    if (b.tabelasPorChave) restaurarTodasTabelasCustomizadas(b.tabelasPorChave);
    else ['governo', 'siape', 'inss'].forEach((conv) => salvarDeltaConv(conv, b.tabelas[conv] || []));
    // Configuração de nuvem (se o backup trouxer)
    if (b.cloudConfig) {
      localStorage.setItem(CHAVE_CFG, JSON.stringify({ url: b.cloudConfig.url, anonKey: b.cloudConfig.anonKey, ativo: true }));
      _client = null;
    }
    return { ok: true, msg: `${b.usuarios.length} usuário(s) restaurado(s). Recarregue a página.` };
  } catch (e: any) {
    return { ok: false, msg: 'Erro ao restaurar: ' + (e?.message || 'desconhecido') };
  }
}
