import type { Contrato } from './financeiro';

export type Role = 'master' | 'comum';

export interface Permissoes {
  podeAdicionarContrato: boolean;
  podeExcluirContrato: boolean;
  podeExportarPDF: boolean;
  podeUsarPortabilidade: boolean;
  podeDefinirTaxaRef: boolean;
  podeVerGrafico: boolean;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  senha: string;
  role: Role;
  bloqueado: boolean;
  limiteContratos: number;
  /** 0 = sessão única, 1..10 = nº máximo de sessões simultâneas */
  acessosSimultaneos: number;
  dataExpiracao: string;
  permissoes: Permissoes;
  criadoEm: string;
  ultimoAcesso: string;
  contratosCriados: number;
  /** Timestamp de exclusão para evitar reativação por sincronização */
  deletadoEm?: string;
  /** JSON com as sessões ativas ou token legado */
  sessaoToken?: string;
  /** Texto auxiliar / legado */
  sessaoDispositivo?: string;
}

export interface SessaoAtiva {
  token: string;
  dispositivo: string;
  criadoEm: string;
}

const CHAVE_USERS = 'consig_users';
const CHAVE_SESSION = 'consig_session_id';
const CHAVE_TOKEN = 'consig_session_token';

/** Gera um token único para a sessão */
export function gerarToken(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Descrição amigável do dispositivo atual */
export function descreverDispositivo(): string {
  const ua = navigator.userAgent;
  let so = 'Desconhecido';
  if (/Windows/i.test(ua)) so = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) so = 'macOS';
  else if (/Android/i.test(ua)) so = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iOS';
  else if (/Linux/i.test(ua)) so = 'Linux';

  let nav = 'Navegador';
  if (/Edg\//i.test(ua)) nav = 'Edge';
  else if (/OPR\//i.test(ua)) nav = 'Opera';
  else if (/Chrome\//i.test(ua)) nav = 'Chrome';
  else if (/Safari\//i.test(ua)) nav = 'Safari';
  else if (/Firefox\//i.test(ua)) nav = 'Firefox';

  return `${nav} · ${so}`;
}

/** 0 = sessão única; 1..10 = nº máximo de sessões simultâneas */
export function limiteSessoes(user: Pick<Usuario, 'acessosSimultaneos'>): number {
  const n = Math.max(0, Math.min(10, Number(user.acessosSimultaneos ?? 0)));
  return n === 0 ? 1 : n;
}

/** Lê as sessões ativas do usuário (compatível com token legado em string) */
export function lerSessoesAtivas(user: Partial<Usuario> | null | undefined): SessaoAtiva[] {
  if (!user?.sessaoToken) return [];
  const raw = user.sessaoToken;
  try {
    if (raw.trim().startsWith('[')) {
      const arr = JSON.parse(raw) as SessaoAtiva[];
      return Array.isArray(arr)
        ? arr.filter(s => !!s?.token).map(s => ({
            token: String(s.token),
            dispositivo: String(s.dispositivo || ''),
            criadoEm: String(s.criadoEm || ''),
          }))
        : [];
    }
  } catch { /* legado */ }
  return [{ token: raw, dispositivo: user.sessaoDispositivo || '', criadoEm: '' }];
}

function salvarSessoesNoUsuario(user: Usuario, sessoes: SessaoAtiva[]): Usuario {
  const seguras = sessoes.filter(s => !!s.token);
  return {
    ...user,
    sessaoToken: JSON.stringify(seguras),
    sessaoDispositivo: seguras[seguras.length - 1]?.dispositivo || '',
  };
}

const PERM_MASTER: Permissoes = {
  podeAdicionarContrato: true,
  podeExcluirContrato: true,
  podeExportarPDF: true,
  podeUsarPortabilidade: true,
  podeDefinirTaxaRef: true,
  podeVerGrafico: true,
};

const PERM_COMUM: Permissoes = {
  podeAdicionarContrato: true,
  podeExcluirContrato: true,
  podeExportarPDF: true,
  podeUsarPortabilidade: true,
  podeDefinirTaxaRef: true,
  podeVerGrafico: true,
};

export function permissoesPadrao(role: Role): Permissoes {
  return role === 'master' ? { ...PERM_MASTER } : { ...PERM_COMUM };
}

function gerarId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ══════════════════════════════════════════════════════
//  HASH DE SENHA (SHA-256 + salt fixo do app)
//  Evita senhas em texto puro no banco/localStorage.
//  Compatível com contas antigas: se a senha salva não for
//  hash, compara em texto puro e migra no próximo login.
// ══════════════════════════════════════════════════════
const HASH_PREFIX = 'sha256$';
const APP_SALT = 'consig-analyzer-v1';

/** Gera o hash da senha (assíncrono, usa Web Crypto) */
export async function hashSenha(senha: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(APP_SALT + '::' + senha);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return HASH_PREFIX + hex;
  } catch {
    // Ambiente sem Web Crypto (http sem localhost): mantém texto puro
    return senha;
  }
}

function ehHash(v: string): boolean {
  return typeof v === 'string' && v.startsWith(HASH_PREFIX);
}

/** Compara a senha digitada com o valor armazenado (hash ou legado) */
export async function conferirSenha(digitada: string, armazenada: string): Promise<boolean> {
  if (ehHash(armazenada)) {
    return (await hashSenha(digitada)) === armazenada;
  }
  return digitada === armazenada; // conta legada em texto puro
}

function agoraIso(): string {
  return new Date().toISOString();
}

export function lerUsuarios(): Usuario[] {
  try {
    const raw = localStorage.getItem(CHAVE_USERS);
    if (!raw) return [];
    return JSON.parse(raw) as Usuario[];
  } catch {
    return [];
  }
}

export function gravarUsuarios(lista: Usuario[], opts?: { semNuvem?: boolean; skipCloud?: boolean }): void {
  localStorage.setItem(CHAVE_USERS, JSON.stringify(lista));
  if (opts?.semNuvem || opts?.skipCloud) return;
  // Sincroniza com a nuvem em background (não bloqueia a UI)
  import('./cloudDb').then(({ nuvemSalvarUsuarios }) => {
    nuvemSalvarUsuarios(lista).catch(() => { /* offline: mantém local */ });
  }).catch(() => { /* módulo indisponível */ });
}

/**
 * Envia a lista de usuários para a nuvem e AGUARDA a confirmação.
 * Usada no login: o heartbeat só começa depois que o token está no banco,
 * evitando que a sessão recém-criada seja derrubada por race condition.
 */
export async function gravarUsuariosAguardandoNuvem(lista: Usuario[], timeoutMs = 6000): Promise<void> {
  localStorage.setItem(CHAVE_USERS, JSON.stringify(lista));
  try {
    const { nuvemSalvarUsuarios } = await import('./cloudDb');
    await Promise.race([
      nuvemSalvarUsuarios(lista),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch { /* offline: mantém local */ }
}

/**
 * Baixa os usuários da nuvem e mescla no localStorage (nuvem tem prioridade).
 * Também deduplica por e-mail: se duas máquinas criaram o mesmo e-mail com
 * IDs diferentes (ex.: o master padrão), mantém um único usuário e migra
 * contratos/taxa do ID descartado para o mantido.
 */
export async function sincronizarUsuariosDaNuvem(): Promise<number> {
  try {
    const { nuvemBaixarUsuarios } = await import('./cloudDb');
    let remotos: Usuario[] | null = null;
    try {
      remotos = await nuvemBaixarUsuarios();
    } catch {
      // Se o Supabase lança exceção (schema inexistente), ignora
      return 0;
    }
    if (!remotos || remotos.length === 0) return 0;

    const locais = lerUsuarios();
    const mapa = new Map<string, Usuario>();
    locais.forEach(u => mapa.set(u.id, u));
    remotos.forEach((u) => {
      const local = mapa.get(u.id);
      if (local) {
        // Preserva a sessão ativa local do navegador atual para evitar falso
        // "acesso em outro dispositivo" quando o backend ainda está com dados
        // antigos ou a sincronização chegou antes da sessão remota atualizar.
        mapa.set(u.id, {
          ...u,
          sessaoToken: local.sessaoToken || u.sessaoToken || '',
          sessaoDispositivo: local.sessaoDispositivo || u.sessaoDispositivo || '',
          ultimoAcesso: local.ultimoAcesso || u.ultimoAcesso || '',
        });
        return;
      }
      mapa.set(u.id, u);
    });
    const mesclado = [...mapa.values()];

    // ── Deduplica por e-mail ──
    const porEmail = new Map<string, Usuario[]>();
    mesclado.forEach(u => {
      const k = (u.email || '').toLowerCase();
      porEmail.set(k, [...(porEmail.get(k) || []), u]);
    });

    const lista: Usuario[] = [];
    const descartados: { id: string; mantidoId: string }[] = [];
    porEmail.forEach((dupes) => {
      if (dupes.length === 1) { lista.push(dupes[0]); return; }
      const mantido = [...dupes].sort((a, b) =>
        (b.contratosCriados || 0) - (a.contratosCriados || 0) ||
        (a.criadoEm || '').localeCompare(b.criadoEm || '')
      )[0];
      lista.push(mantido);
      dupes.forEach((u) => {
        if (u.id === mantido.id) return;
        descartados.push({ id: u.id, mantidoId: mantido.id });
        // Migra contratos locais
        const cAntigo = localStorage.getItem(`consig_contratos_${u.id}`);
        if (cAntigo) {
          try {
            const antiga: Contrato[] = JSON.parse(cAntigo) || [];
            const cNovo = localStorage.getItem(`consig_contratos_${mantido.id}`);
            const nova: Contrato[] = cNovo ? JSON.parse(cNovo) || [] : [];
            const ids = new Set(nova.map(x => String(x.id)));
            const fundido = [...nova, ...antiga.filter(x => !ids.has(String(x.id)))];
            localStorage.setItem(`consig_contratos_${mantido.id}`, JSON.stringify(fundido));
          } catch { /* ignora */ }
          localStorage.removeItem(`consig_contratos_${u.id}`);
        }
        // Migra taxa de referência
        const tAntigo = localStorage.getItem(`consig_taxaRef_${u.id}`);
        if (tAntigo && !localStorage.getItem(`consig_taxaRef_${mantido.id}`)) {
          localStorage.setItem(`consig_taxaRef_${mantido.id}`, tAntigo);
        }
        localStorage.removeItem(`consig_taxaRef_${u.id}`);
      });
    });

    localStorage.setItem(CHAVE_USERS, JSON.stringify(lista));

    // ── Limpa duplicados do banco (migra contratos da nuvem antes) ──
    if (descartados.length) {
      try {
        const { nuvemRemoverUsuario, nuvemBaixarContratos, nuvemSalvarContratos, nuvemSalvarUsuarios } = await import('./cloudDb');
        for (const { id, mantidoId } of descartados) {
          try {
            const contrDesc = (await nuvemBaixarContratos(id)) || [];
            if (contrDesc.length) {
              const contrMantido = (await nuvemBaixarContratos(mantidoId)) || [];
              const ids = new Set(contrMantido.map(c => String(c.id)));
              const fundido = [...contrMantido, ...contrDesc.filter(c => !ids.has(String(c.id)))];
              await nuvemSalvarContratos(mantidoId, fundido);
            }
          } catch { /* segue */ }
        }
        await nuvemSalvarUsuarios(lista);
        for (const { id } of descartados) {
          try { await nuvemRemoverUsuario(id); } catch { /* segue */ }
        }
      } catch { /* offline: duplicata fica só local, resolve na próxima sync */ }
    }

    return remotos.length;
  } catch {
    return 0;
  }
}

export function garantirMaster(): Usuario[] {
  let lista = lerUsuarios();
  if (lista.length === 0) {
    // Se o app já foi iniciado antes, NÃO recria (master foi deletado intencionalmente)
    if (localStorage.getItem('consig_app_inicializado') === '1') {
      return lista;
    }
    // Primeira vez real: cria master e demo
    const master: Usuario = {
      id: gerarId(),
      nome: 'Master Admin',
      email: 'master@consig.com',
      senha: 'master123', // migra para hash no primeiro login
      role: 'master',
      bloqueado: false,
      limiteContratos: 0,
      acessosSimultaneos: 0,
      dataExpiracao: '',
      permissoes: permissoesPadrao('master'),
      criadoEm: agoraIso(),
      ultimoAcesso: agoraIso(),
      contratosCriados: 0,
    };
    const demo: Usuario = {
      id: gerarId(),
      nome: 'Usuário Demo',
      email: 'demo@consig.com',
      senha: 'demo123', // migra para hash no primeiro login
      role: 'comum',
      bloqueado: false,
      limiteContratos: 5,
      acessosSimultaneos: 0,
      dataExpiracao: '',
      permissoes: permissoesPadrao('comum'),
      criadoEm: agoraIso(),
      ultimoAcesso: '',
      contratosCriados: 0,
    };
    lista = [master, demo];
    gravarUsuarios(lista, { skipCloud: true });
  }
  // Marca que o app já foi iniciado
  localStorage.setItem('consig_app_inicializado', '1');
  return lista;
}

export function obterUsuarioPorId(id: string): Usuario | undefined {
  return lerUsuarios().find((u) => u.id === id);
}

export function obterUsuarioPorEmail(email: string): Usuario | undefined {
  return lerUsuarios().find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase()
  );
}

/** Autenticação assíncrona com hash de senha (migra contas legadas) */
export async function autenticar(
  email: string,
  senha: string
): Promise<{ usuario: Usuario; erro?: string } | { usuario?: undefined; erro: string }> {
  const user = obterUsuarioPorEmail(email);
  if (!user) return { erro: 'Usuário não encontrado.' };
  if (user.bloqueado) return { erro: 'Usuário bloqueado pelo master.' };
  if (user.dataExpiracao) {
    const exp = new Date(user.dataExpiracao);
    if (new Date() > exp) return { erro: 'Acesso expirado. Fale com o master.' };
  }

  const ok = await conferirSenha(senha, user.senha);
  if (!ok) return { erro: 'Senha incorreta.' };

  // Migra automaticamente senha legada (texto puro) para hash
  if (!user.senha.startsWith(HASH_PREFIX)) {
    try {
      const h = await hashSenha(senha);
      atualizarUsuario(user.id, { senha: h });
      user.senha = h;
    } catch { /* segue sem migrar */ }
  }

  return { usuario: user };
}

export function criarUsuario(dados: Omit<Usuario, 'id' | 'criadoEm' | 'ultimoAcesso' | 'contratosCriados'>): Usuario {
  const lista = lerUsuarios();
  if (lista.some((u) => u.email.toLowerCase() === dados.email.toLowerCase())) {
    throw new Error('E-mail já cadastrado.');
  }
  const novo: Usuario = {
    id: gerarId(),
    criadoEm: agoraIso(),
    ultimoAcesso: '',
    contratosCriados: 0,
    ...dados,
  };
  gravarUsuarios([...lista, novo]);
  return novo;
}

export function atualizarUsuario(id: string, patch: Partial<Usuario>): Usuario {
  const lista = lerUsuarios();
  const idx = lista.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('Usuário não encontrado.');
  if (patch.email) {
    const dup = lista.find(
      (u) => u.id !== id && u.email.toLowerCase() === patch.email!.toLowerCase()
    );
    if (dup) throw new Error('E-mail já cadastrado.');
  }
  lista[idx] = { ...lista[idx], ...patch };
  gravarUsuarios(lista);
  return lista[idx];
}

export async function removerUsuario(id: string): Promise<void> {
  const lista = lerUsuarios();
  const alvo = lista.find((u) => u.id === id);
  if (!alvo) return;
  // Única proteção: não deletar o último master do sistema
  if (alvo.role === 'master') {
    const masters = lista.filter((u) => u.role === 'master');
    if (masters.length <= 1) throw new Error('Não é possível remover o último master do sistema.');
  }
  // Limpa dados locais
  gravarUsuarios(lista.filter((u) => u.id !== id));
  localStorage.removeItem(`consig_contratos_${id}`);
  localStorage.removeItem(`consig_taxaRef_${id}`);
  localStorage.removeItem(`consig_tabelas_custom_${id}_governo`);
  localStorage.removeItem(`consig_tabelas_custom_${id}_siape`);
  localStorage.removeItem(`consig_tabelas_custom_${id}_inss`);
  // Remove da nuvem
  try {
    const { nuvemRemoverUsuario } = await import('./cloudDb');
    await nuvemRemoverUsuario(id);
  } catch { /* offline */ }
}

export function alternarBloqueio(id: string): Usuario {
  const user = obterUsuarioPorId(id);
  if (!user) throw new Error('Usuário não encontrado.');
  if (id === obterSessaoId()) throw new Error('Você não pode bloquear a própria conta.');
  const bloqueando = !user.bloqueado;
  return atualizarUsuario(id, bloqueando
    ? { bloqueado: true, sessaoToken: '[]', sessaoDispositivo: '' }
    : { bloqueado: false });
}

// ══════════════════════════════════════════════════════
//  SESSÃO ÚNICA — apenas 1 acesso simultâneo por conta
// ══════════════════════════════════════════════════════

const CHAVE_ULTIMO_LOGIN = 'consig_ultimo_login_ts';

/**
 * Cria a sessão e invalida qualquer outra sessão ativa da mesma conta.
 * AGUARDA o envio do novo token para a nuvem (com timeout) para que o
 * heartbeat não derrube a sessão recém-criada por race condition.
 */
export async function salvarSessao(id: string): Promise<string> {
  const token = gerarToken();
  const dispositivo = descreverDispositivo();
  localStorage.setItem(CHAVE_SESSION, id);
  localStorage.setItem(CHAVE_TOKEN, token);
  localStorage.setItem(CHAVE_ULTIMO_LOGIN, String(Date.now()));

  const lista = lerUsuarios();
  const idx = lista.findIndex((u) => u.id === id);
  if (idx >= 0) {
    const user = lista[idx];
    const sessoes = lerSessoesAtivas(user).filter(s => s.token !== token);
    sessoes.push({ token, dispositivo, criadoEm: agoraIso() });
    // 0 = sessão única; 1..10 = máximo de sessões simultâneas
    const max = limiteSessoes(user);
    while (sessoes.length > max) sessoes.shift();
    lista[idx] = salvarSessoesNoUsuario({
      ...user,
      ultimoAcesso: agoraIso(),
    }, sessoes);
    await gravarUsuariosAguardandoNuvem(lista);
  }
  return token;
}

/**
 * Limpa o token de sessão do registro local do usuário SEM enviar para a
 * nuvem — usado quando este dispositivo foi derrubado por outro.
 * (Não pode sobrescrever o token do dispositivo legítimo no banco.)
 */
export function limparTokenSessaoLocal(id: string): void {
  const tokenLocal = obterTokenLocal();
  if (!tokenLocal) return;
  const lista = lerUsuarios();
  const idx = lista.findIndex((u) => u.id === id);
  if (idx < 0) return;
  const user = lista[idx];
  const sessoes = lerSessoesAtivas(user).filter(s => s.token !== tokenLocal);
  lista[idx] = salvarSessoesNoUsuario(user, sessoes);
  gravarUsuarios(lista, { semNuvem: true });
}

/** Milissegundos desde o último login (para o período de graça do heartbeat) */
export function msDesdeUltimoLogin(): number {
  const ts = parseInt(localStorage.getItem(CHAVE_ULTIMO_LOGIN) || '0', 10);
  return ts ? Date.now() - ts : Infinity;
}

export function limparSessao(): void {
  localStorage.removeItem(CHAVE_SESSION);
  localStorage.removeItem(CHAVE_TOKEN);
}

/** Logout intencional: libera a conta para novo login em qualquer lugar */
export function encerrarSessao(): void {
  const id = obterSessaoId();
  const tokenLocal = obterTokenLocal();
  if (id && tokenLocal) {
    try {
      const user = obterUsuarioPorId(id);
      if (user) {
        const sessoes = lerSessoesAtivas(user).filter(s => s.token !== tokenLocal);
        atualizarUsuario(id, {
          sessaoToken: JSON.stringify(sessoes),
          sessaoDispositivo: sessoes[sessoes.length - 1]?.dispositivo || '',
        });
      }
    } catch { /* ignora */ }
  }
  limparSessao();
}

export function obterSessaoId(): string | null {
  return localStorage.getItem(CHAVE_SESSION);
}

export function obterTokenLocal(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

export function obterSessaoUsuario(): Usuario | null {
  const id = obterSessaoId();
  if (!id) return null;
  const user = obterUsuarioPorId(id);
  if (!user) {
    limparSessao();
    return null;
  }
  if (user.bloqueado) return null;
  if (user.dataExpiracao && new Date() > new Date(user.dataExpiracao)) return null;
  const tokenLocal = obterTokenLocal();
  if (tokenLocal) {
    const ok = lerSessoesAtivas(user).some(s => s.token === tokenLocal);
    if (!ok) return null;
  }
  return user;
}

export type MotivoQueda = 'outro_dispositivo' | 'bloqueado' | 'expirado' | 'removido';

/**
 * Verifica se a sessão local ainda é a sessão ativa da conta.
 * Consulta a nuvem (quando disponível) para detectar login em outra máquina.
 */
/**
 * Verifica se a sessão local ainda é a sessão ativa da conta.
 * Consulta a nuvem (quando disponível) para detectar login em outra máquina.
 *
 * ⚠️ Período de graça: nos 15s após um login, o token recém-criado pode
 * ainda não ter propagado para todos os dispositivos/banco. Nessa janela
 * a sessão local é considerada válida (evita o loop "login → derrubado").
 */
export async function validarSessaoAtiva(): Promise<{ ok: true } | { ok: false; motivo: MotivoQueda }> {
  const id = obterSessaoId();
  const tokenLocal = obterTokenLocal();
  if (!id || !tokenLocal) return { ok: false, motivo: 'removido' };

  const naJanelaDeGraça = msDesdeUltimoLogin() < 60000;

  // 1) Valida contra a nuvem (fonte da verdade entre máquinas)
  try {
    const { nuvemBaixarUsuarios, nuvemAtiva } = await import('./cloudDb');
    if (nuvemAtiva()) {
      const remotos = await nuvemBaixarUsuarios();
      if (remotos && remotos.length) {
        const locais = lerUsuarios();
        const remoto = remotos.find(u => u.id === id);
        if (!remoto) return { ok: false, motivo: 'removido' };
        if (remoto.bloqueado) return { ok: false, motivo: 'bloqueado' };
        if (remoto.dataExpiracao && new Date() > new Date(remoto.dataExpiracao))
          return { ok: false, motivo: 'expirado' };

        // Valida antes de substituir o cache local. Uma resposta remota
        // atrasada/legada sem o token não pode apagar a sessão recém-criada.
        const local = locais.find(u => u.id === id) || null;
        const sessoesLocais = local ? lerSessoesAtivas(local) : [];
        const sessaoLocal = sessoesLocais.find(s => s.token === tokenLocal);
        const localOk = !!sessaoLocal;
        const sessoesRemotas = lerSessoesAtivas(remoto);
        const sessaoRemotaMaisRecente = [...sessoesRemotas]
          .filter(s => !!s.criadoEm)
          .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
          .at(-1);
        const remotoSubstituiuSessao = !!sessaoLocal?.criadoEm &&
          !!sessaoRemotaMaisRecente?.criadoEm &&
          sessaoRemotaMaisRecente.criadoEm > sessaoLocal.criadoEm;

        // Avança quando a sessão ainda existe neste navegador. Isso evita
        // falsos positivos causados por sincronização lenta ou por um banco
        // que ainda não propagou o token do login atual.
        if (localOk) {
          if (sessoesRemotas.length === 0 || !sessoesRemotas.some(s => s.token === tokenLocal)) {
            if (naJanelaDeGraça) return { ok: true };
          }
        }

        // Só valida token se a nuvem realmente tiver sessão salva.
        // Se o schema do banco ainda for antigo (sem sessao_token), a linha
        // estiver vazia ou os dados remotos estiverem atrasados, não derruba
        // a sessão ativa do navegador atual por falso positivo.
        if (sessoesRemotas.length > 0) {
          const remotoOk = sessoesRemotas.some(s => s.token === tokenLocal);
          if (!remotoOk) {
            // Damos prioridade à sessão local quando ela ainda está ativa
            // neste navegador, porque o backend pode estar sem a última sessão
            // sincronizada ou a conta foi bloqueada em outra aba do mesmo app.
            if (localOk && naJanelaDeGraça) return { ok: true };
            if (!naJanelaDeGraça && remotoSubstituiuSessao) {
              return { ok: false, motivo: 'outro_dispositivo' };
            }
          } else {
            localStorage.removeItem(CHAVE_ULTIMO_LOGIN);
          }
        }

        const mapa = new Map<string, Usuario>();
        locais.forEach(u => mapa.set(u.id, u));
        remotos.forEach(u => {
          // Mantém o token local enquanto a nuvem ainda não publicou a sessão.
          // Quando há outro token remoto, o retorno acima já encerrou a sessão.
          if (u.id === id && local && (sessoesRemotas.length === 0 || localOk)) {
            mapa.set(u.id, {
              ...u,
              sessaoToken: local.sessaoToken,
              sessaoDispositivo: local.sessaoDispositivo,
            });
          } else {
            mapa.set(u.id, u);
          }
        });
        localStorage.setItem(CHAVE_USERS, JSON.stringify([...mapa.values()]));
        return { ok: true };
      }
    }
  } catch { /* offline: valida só localmente */ }

  // 2) Validação local (outra aba do mesmo navegador)
  const local = obterUsuarioPorId(id);
  if (!local) return { ok: false, motivo: 'removido' };
  if (local.bloqueado) return { ok: false, motivo: 'bloqueado' };
  if (local.dataExpiracao && new Date() > new Date(local.dataExpiracao))
    return { ok: false, motivo: 'expirado' };
  const localOk = lerSessoesAtivas(local).some(s => s.token === tokenLocal);
  if (!localOk) {
    // No mesmo navegador, a sessão local ainda pode existir mesmo quando a nuvem
    // está atrasada. Só consideramos outro dispositivo fora da janela de graça.
            // Token diferente sem timestamp confiável pode ser uma resposta
            // antiga do Supabase; nunca derruba a sessão por esse sinal isolado.
            if (!naJanelaDeGraça && remotoSubstituiuSessao) {
              return { ok: false, motivo: 'outro_dispositivo' };
            }
    return { ok: true };
  }
  return { ok: true };
}

export function mensagemQueda(motivo: MotivoQueda): string {
  switch (motivo) {
    case 'outro_dispositivo':
      return '🔒 Sessão encerrada: esta conta foi acessada em outro dispositivo. Faça login novamente.';
    case 'bloqueado':
      return '⛔ Sua conta foi bloqueada pelo master.';
    case 'expirado':
      return '⌛ Seu acesso expirou. Fale com o master para renovar.';
    default:
      return '🔒 Sua sessão foi encerrada. Faça login novamente.';
  }
}

export function depurarSessaoAtual(): Record<string, unknown> {
  const id = obterSessaoId();
  const token = obterTokenLocal();
  const user = id ? obterUsuarioPorId(id) : undefined;
  return {
    id,
    token,
    localOk: !!user && !!token && lerSessoesAtivas(user).some(s => s.token === token),
    usuario: user ? { id: user.id, nome: user.nome, email: user.email, bloqueado: user.bloqueado, dataExpiracao: user.dataExpiracao } : null,
    sessoesAtivas: user ? lerSessoesAtivas(user) : [],
    ultimoLoginMs: msDesdeUltimoLogin(),
    janelaGraça: msDesdeUltimoLogin() < 60000,
  };
}

export function depurarSessaoAtualTexto(): string {
  return JSON.stringify(depurarSessaoAtual(), null, 2);
}

export function tempoRestanteExpiracao(data: string): string {
  if (!data) return 'Sem expiração';
  const diff = new Date(data).getTime() - Date.now();
  if (diff <= 0) return 'Expirado';
  const dias = Math.floor(diff / 86400000);
  if (dias > 0) return `${dias}d restantes`;
  const horas = Math.floor(diff / 3600000);
  return `${horas}h restantes`;
}
