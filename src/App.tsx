import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import { Pie } from 'react-chartjs-2';
import jsPDF from 'jspdf';
import {
  Contrato,
  analisar,
  consolidar,
  agruparPorBanco,
} from './utils/financeiro';
import {
  fmtBRL,
  fmtPct,
  parseNum,
  formatarMoedaInput,
} from './utils/format';
import {
  garantirMaster,
  lerUsuarios,
  autenticar,
  criarUsuario,
  atualizarUsuario,
  removerUsuario,
  alternarBloqueio,
  salvarSessao,
  limparSessao,
  limparTokenSessaoLocal,
  encerrarSessao,
  obterSessaoUsuario,
  obterSessaoId,
  obterTokenLocal,
  validarSessaoAtiva,
  mensagemQueda,
  depurarSessaoAtual,
  depurarSessaoAtualTexto,
  hashSenha,
  permissoesPadrao,
  tempoRestanteExpiracao,
  descreverDispositivo,
  lerSessoesAtivas,
  limiteSessoes,
  type Usuario,
  type Permissoes,
  type Role,
} from './utils/users';
import Portabilidade from './components/Portabilidade';
import CoeficientesManager from './components/CoeficientesManager';
import CloudConfig from './components/CloudConfig';
import Watermark from './components/Watermark';
import { extrairDadosDeImagem, type DadosExtraidos } from './utils/ocrExtractor';
import { setUsuarioCoeficientes } from './utils/coeficientes';

ChartJS.register(ArcElement, Tooltip, Legend, Title);

const CORES = [
  '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#7c3aed',
  '#db2777', '#65a30d', '#0891b2', '#ea580c', '#4f46e5',
];

interface DinheiroFloat {
  id: number; emoji: string; left: number; dur: number; delay: number;
  opacity: number; fontSize: number; blur: boolean; isCoin: boolean;
  size: number; coinFontSize: number;
}

function FundoDinheiro() {
  const items = useMemo<DinheiroFloat[]>(() => {
    const emojis = ['💵', '💸', '💰', '🪙', '💵', '💵', '💲'];
    const arr: DinheiroFloat[] = [];
    for (let i = 0; i < 24; i++) {
      const isCoin = Math.random() < 0.22;
      const t = 26 + Math.random() * 28;
      arr.push({
        id: i,
        emoji: isCoin ? 'R$' : emojis[Math.floor(Math.random() * emojis.length)],
        left: Math.random() * 96,
        dur: 16 + Math.random() * 18,
        delay: -Math.random() * 30,
        opacity: 0.16 + Math.random() * 0.42,
        fontSize: 1.4 + Math.random() * 2.2,
        blur: Math.random() < 0.35,
        isCoin,
        size: t,
        coinFontSize: t * 0.3,
      });
    }
    return arr;
  }, []);
  return (
    <div id="fundoDinheiro" aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {items.map((it) => (
        <span
          key={it.id}
          className={`dinheiro ${it.isCoin ? 'moeda' : ''}`}
          style={{
            left: `${it.left}%`,
            animationDuration: `${it.dur}s`,
            animationDelay: `${it.delay}s`,
            opacity: it.opacity,
            fontSize: it.isCoin ? `${it.coinFontSize}px` : `${it.fontSize}rem`,
            width: it.isCoin ? `${it.size}px` : undefined,
            height: it.isCoin ? `${it.size}px` : undefined,
            filter: it.blur ? 'blur(1.5px)' : undefined,
          }}
        >
          {it.emoji}
        </span>
      ))}
    </div>
  );
}

// Workspace de análise por SESSÃO (não sincroniza entre acessos simultâneos)
function sessaoAnaliseKey() { return obterTokenLocal() || 'local'; }
function contratosKey(uid: string) { return `consig_contratos_${uid}_${sessaoAnaliseKey()}`; }
function taxaRefKey(uid: string) { return `consig_taxaRef_${uid}_${sessaoAnaliseKey()}`; }

function lerContratosUsuario(uid: string): Contrato[] {
  try {
    // 1) workspace desta sessão
    const raw = localStorage.getItem(contratosKey(uid));
    if (raw) return JSON.parse(raw);
    // 2) legado por usuário (migra para esta sessão)
    const legacyUser = localStorage.getItem(`consig_contratos_${uid}`);
    if (legacyUser) {
      localStorage.setItem(contratosKey(uid), legacyUser);
      return JSON.parse(legacyUser);
    }
    // 3) legado global muito antigo
    const legacy = localStorage.getItem('consig_contratos');
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length) {
        localStorage.setItem(contratosKey(uid), legacy);
        return parsed;
      }
    }
    return [];
  } catch { return []; }
}

function gravarContratosUsuario(uid: string, lista: Contrato[]) {
  // ❗ Não envia pra nuvem: análises/consultas são individuais por acesso simultâneo
  localStorage.setItem(contratosKey(uid), JSON.stringify(lista));
  try {
    const users = lerUsuarios();
    const idx = users.findIndex((u) => u.id === uid);
    if (idx !== -1) {
      users[idx].contratosCriados = lista.length;
      localStorage.setItem('consig_users', JSON.stringify(users));
    }
  } catch {}
}

function lerTaxaRefUsuario(uid: string): number {
  // 1) workspace desta sessão
  const v = parseFloat(localStorage.getItem(taxaRefKey(uid)) || 'NaN');
  if (!isNaN(v)) return v;
  // 2) legado por usuário
  const legacyUser = parseFloat(localStorage.getItem(`consig_taxaRef_${uid}`) || 'NaN');
  if (!isNaN(legacyUser)) {
    localStorage.setItem(taxaRefKey(uid), String(legacyUser));
    return legacyUser;
  }
  // 3) legado global antigo
  return parseFloat(localStorage.getItem('consig_taxaRef') || 'NaN');
}

function gravarTaxaRefUsuario(uid: string, v: number) {
  // ❗ Não envia pra nuvem: taxa é individual por acesso simultâneo
  if (isNaN(v)) localStorage.setItem(taxaRefKey(uid), '');
  else localStorage.setItem(taxaRefKey(uid), String(v));
}

// Contador global para chaves de slot — evita colisão de Date.now()+Math.random()
// (números ~1.7e12 têm precisão de float insuficiente para frações aleatórias)
let _slotSeq = 0;
function novaChaveSlot(): number {
  return ++_slotSeq;
}

function contarContratosDoUsuario(uid: string): number {
  try {
    const raw = localStorage.getItem(contratosKey(uid));
    if (!raw) return 0;
    return (JSON.parse(raw) as Contrato[]).length;
  } catch { return 0; }
}

export default function App() {
  useEffect(() => {
    const editavel = (elemento: EventTarget | null) => {
      const alvo = elemento as HTMLElement | null;
      return !!alvo?.closest('input, textarea, select, [contenteditable="true"]');
    };
    const bloquearMenu = (evento: MouseEvent) => {
      if (!editavel(evento.target)) evento.preventDefault();
    };
    const bloquearArraste = (evento: DragEvent) => {
      if (!editavel(evento.target)) evento.preventDefault();
    };
    const bloquearCopias = (evento: ClipboardEvent) => {
      if (!editavel(evento.target)) {
        evento.preventDefault();
        evento.clipboardData?.setData('text/plain', 'Conteúdo protegido.');
      }
    };
    const bloquearAtalhos = (evento: KeyboardEvent) => {
      if (editavel(evento.target)) return;
      const tecla = evento.key.toLowerCase();
      const inspecao = evento.key === 'F12' ||
        (evento.ctrlKey && evento.shiftKey && ['i', 'j', 'c'].includes(tecla)) ||
        (evento.ctrlKey && ['u', 's', 'c', 'x', 'p'].includes(tecla));
      if (inspecao) evento.preventDefault();
    };

    document.addEventListener('contextmenu', bloquearMenu);
    document.addEventListener('dragstart', bloquearArraste);
    document.addEventListener('copy', bloquearCopias);
    document.addEventListener('cut', bloquearCopias);
    document.addEventListener('keydown', bloquearAtalhos);
    return () => {
      document.removeEventListener('contextmenu', bloquearMenu);
      document.removeEventListener('dragstart', bloquearArraste);
      document.removeEventListener('copy', bloquearCopias);
      document.removeEventListener('cut', bloquearCopias);
      document.removeEventListener('keydown', bloquearAtalhos);
    };
  }, []);

  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [allUsers, setAllUsers] = useState<Usuario[]>([]);
  const [ocultarGrafico, setOcultarGrafico] = useState(false);
  const [ocultarPainelStats, setOcultarPainelStats] = useState(false);
  const [ocultarFormUsuario, setOcultarFormUsuario] = useState(false);
  const [ocultarListaUsuarios, setOcultarListaUsuarios] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginSenha, setLoginSenha] = useState('');
  const [loginErro, setLoginErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [avisoSessao, setAvisoSessao] = useState('');
  const [debugSessao, setDebugSessao] = useState<Record<string, unknown>>({});
  const modoDebug = false;

  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [taxaRef, setTaxaRef] = useState<number>(NaN);
  const [taxaRefInput, setTaxaRefInput] = useState<string>('');
  const [erro, setErro] = useState('');
  const [tabelasVersion, setTabelasVersion] = useState(0);

  const MAX_SLOTS = 15;
  interface FormSlot { key: number; banco: string; valorLiberado: string; parcela: string; prazo: string; mesesPagos: string; valorBrutoRestante: string; }
  const emptySlot = (): FormSlot => ({ key: novaChaveSlot(), banco: '', valorLiberado: '', parcela: '', prazo: '', mesesPagos: '', valorBrutoRestante: '' });
  const [slots, setSlots] = useState<FormSlot[]>([emptySlot()]);

  // OCR state per slot (keyed by slot.key)
  interface OcrState {
    imageUrl: string | null;
    fileName: string;
    loading: boolean;
    progress: number;
    dados: DadosExtraidos | null;
    erro: string;
    mostrarTexto: boolean;
    isPdf: boolean;
    calibragemManual: boolean;
    textoCalibragem: string;
    calibragemTipo: 'governo' | 'inss' | 'federal';
  }
  const [ocrMap, setOcrMap] = useState<Record<number, OcrState>>({});
  const ocrProcessando = useRef<Set<number>>(new Set());

  function updateSlot(key: number, field: keyof FormSlot, value: string) {
    setSlots(prev => prev.map(s => s.key === key ? { ...s, [field]: value } : s));
  }
  function addSlot() {
    if (slots.length >= MAX_SLOTS) return;
    setSlots(prev => [...prev, emptySlot()]);
  }
  function removeSlot(key: number) {
    if (slots.length <= 1) return;
    limparImagem(key);
    setSlots(prev => prev.filter(s => s.key !== key));
  }
  function clearAllSlots() {
    setSlots([emptySlot()]);
    setOcrMap({});
    setErro('');
  }

  const defaultOcr: OcrState = { imageUrl: null, fileName: '', loading: false, progress: 0, dados: null, erro: '', mostrarTexto: false, isPdf: false, calibragemManual: false, textoCalibragem: '', calibragemTipo: 'inss' };

  function getOcr(key: number): OcrState {
    return ocrMap[key] || defaultOcr;
  }

  function setOcr(key: number, patch: Partial<OcrState>) {
    setOcrMap(prev => {
      const current = prev[key] || defaultOcr;
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  async function handleImageUpload(slotKey: number, file: File) {
    if (ocrProcessando.current.has(slotKey)) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    if (!file || (!isImage && !isPdf)) {
      setOcr(slotKey, { erro: 'Selecione uma imagem (JPG/PNG) ou PDF.' });
      return;
    }
    ocrProcessando.current.add(slotKey);
    // PDF: não gera objectURL para <img> (quebraria); o OCR usa o File direto
    const url = isImage ? URL.createObjectURL(file) : null;
    setOcr(slotKey, { imageUrl: url, fileName: file.name, isPdf, loading: true, progress: 0, dados: null, erro: '', mostrarTexto: false });
    try {
      const dados = await extrairDadosDeImagem(file, (p) => {
        setOcr(slotKey, { progress: p });
      });
      setOcr(slotKey, { loading: false, progress: 100, dados });
    } catch (err: any) {
      setOcr(slotKey, { loading: false, erro: 'Erro ao processar arquivo: ' + (err.message || 'desconhecido') });
    } finally {
      ocrProcessando.current.delete(slotKey);
    }
  }

  function aplicarOcr(slotKey: number) {
    const ocr = getOcr(slotKey);
    if (!ocr.dados) return;
    const d = ocr.dados;
    setSlots(prev => prev.map(s => {
      if (s.key !== slotKey) return s;
      return {
        ...s,
        banco: d.banco || s.banco,
        valorLiberado: d.valorLiberado || s.valorLiberado,
        parcela: d.parcela || s.parcela,
        prazo: d.prazo || s.prazo,
        mesesPagos: d.mesesPagos || s.mesesPagos,
        valorBrutoRestante: d.valorBrutoRestante || s.valorBrutoRestante,
      };
    }));
  }

  function moedaParaInput(valor: string): string {
    const limpo = valor.replace(/[R$\s]/g, '').trim();
    if (!limpo) return '';
    const normalizado = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : /^\d{1,3}\.\d{3}$/.test(limpo)
        ? limpo.replace('.', '')
      : limpo.split('.').length > 2
        ? limpo.replace(/\.(?=.*\.)/g, '')
        : limpo;
    const num = Number(normalizado);
    if (!Number.isFinite(num) || num <= 0) return '';
    return fmtBRL(num);
  }

  function dataMesAno(valor: string): Date | null {
    const s = valor.trim();
    let m = s.match(/^(\d{1,2})[/-](\d{4})$/);
    if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(ano, Number(m[2]) - 1, 1);
    }
    return null;
  }

  function mesesEntre(inicio: Date, fim: Date): number {
    return (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
  }

  function datasDoTexto(valor: string): string[] {
    const s = valor.trim();
    const explicitas = s.match(/\d{1,2}[/-]\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g);
    if (explicitas?.length) return explicitas;
    const dig = s.replace(/\D/g, '');
    // Ex.: 092026082035 = 09/2026 + 08/2035
    if (dig.length === 12) return [`${dig.slice(0, 2)}/${dig.slice(2, 6)}`, `${dig.slice(6, 8)}/${dig.slice(8, 12)}`];
    if (dig.length === 6) return [`${dig.slice(0, 2)}/${dig.slice(2, 6)}`];
    return [];
  }

  function calcularPrazoPagas(prazoCampo: string, pagasCampo: string, extraCampo = ''): { prazo: string; pagas: string; bruto: string } {
    let prazo = prazoCampo.replace(/\D/g, '');
    let pagas = pagasCampo.replace(/\D/g, '');
    let bruto = moedaParaInput(extraCampo);

    const datas = [...datasDoTexto(prazoCampo), ...datasDoTexto(pagasCampo), ...datasDoTexto(extraCampo)];
    if (datas.length >= 2) {
      const d1 = dataMesAno(datas[0]);
      const d2 = dataMesAno(datas[1]);
      if (d1 && d2) {
        const inicio = d1 <= d2 ? d1 : d2;
        const fim = d1 <= d2 ? d2 : d1;
        const total = mesesEntre(inicio, fim) + 1;
        const pagos = Math.max(0, Math.min(mesesEntre(inicio, new Date()), total));
        prazo = String(total);
        pagas = String(pagos);
        // Se o campo extra era data, não é bruto restante.
        if (datasDoTexto(extraCampo).length) bruto = '';
      }
    } else if (datas.length === 1) {
      const inicio = dataMesAno(datas[0]);
      if (inicio) {
        pagas = String(Math.max(0, mesesEntre(inicio, new Date())));
      }
    }

    return { prazo, pagas, bruto };
  }

  function chaveModeloCalibragem(tipo: OcrState['calibragemTipo']) {
    return `consig_ocr_modelo_calibragem_${tipo}`;
  }

  function salvarModeloCalibragem(tipo: OcrState['calibragemTipo'], texto: string, contratos: DadosExtraidos['multiContratos']) {
    try {
      localStorage.setItem(chaveModeloCalibragem(tipo), JSON.stringify({
        tipo,
        texto,
        contratos,
        atualizadoEm: new Date().toISOString(),
        observacao: 'Modelo manual substitui a leitura automática para esta estrutura quando aplicado no anexo.',
      }));
    } catch { /* localStorage indisponível */ }
  }

  function carregarTextoModeloCalibragem(tipo: OcrState['calibragemTipo']): string {
    try {
      const raw = localStorage.getItem(chaveModeloCalibragem(tipo));
      if (!raw) return '';
      const data = JSON.parse(raw) as { texto?: string };
      return data.texto || '';
    } catch { return ''; }
  }

  function separarLinhaCalibragem(linha: string): string[] {
    const limpa = linha.trim().replace(/^\uFEFF/, '');
    // Ponto e vírgula, pipe e TAB não conflitam com casas decimais brasileiras.
    const delimitador = limpa.includes(';') ? ';' : limpa.includes('|') ? '|' : limpa.includes('\t') ? '\t' : '';
    if (delimitador) return limpa.split(delimitador).map(p => p.trim().replace(/^"|"$/g, ''));
    // Compatibilidade com colagem visual em que as colunas vêm separadas por 2+ espaços.
    return limpa.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
  }

  function normalizarCabecalhoCalibragem(valor: string): string {
    return valor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Calibragem manual autoritativa.
  * Formato principal (6 campos):
  *   BANCO;LIBERADO;PARCELA;PRAZO;INICIO;FIM
   *
   * Compatibilidade: se o usuário colar 6 campos com a coluna numérica
   * de prazo no meio (ex.: BANCO;LIB;PARC;108;INICIO;FIM), o sistema
   * ignora o prazo numérico da imagem e usa INICIO/FIM para calcular.
   */
  function aplicarCalibragemManual(slotKey: number) {
    const ocr = getOcr(slotKey);
    const linhas = ocr.textoCalibragem
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !/^#/.test(l));

    if (!linhas.length) {
      setOcr(slotKey, { erro: 'Cole pelo menos uma linha para calibrar.' });
      return;
    }

    const primeira = separarLinhaCalibragem(linhas[0]).map(normalizarCabecalhoCalibragem);
    const temCabecalho = primeira.some(p => /banco|liberado|emprestado|credito|parcela|prazo|inicio|fim|pagas|restante|apagar/.test(p));
    const mapaCabecalho: Record<string, number> = {};
    if (temCabecalho) {
      primeira.forEach((valor, i) => {
        if (/banco/.test(valor)) mapaCabecalho.banco = i;
        else if (/liberado|emprestado|credito/.test(valor)) mapaCabecalho.liberado = i;
        else if (/parcela/.test(valor)) mapaCabecalho.parcela = i;
        else if (/prazo|qtd|quantidade/.test(valor)) mapaCabecalho.prazo = i;
        else if (/inicio|pagas/.test(valor)) mapaCabecalho.inicio = i;
        else if (/fim/.test(valor)) mapaCabecalho.fim = i;
        else if (/restante|apagar|saldo/.test(valor)) mapaCabecalho.bruto = i;
      });
    }

    let invalidas = 0;
    const contratosCalibrados = linhas.slice(temCabecalho ? 1 : 0).map((linha) => {
      const partes = separarLinhaCalibragem(linha);
      if (partes.length < 5) { invalidas++; return null; }

      let banco = partes[mapaCabecalho.banco ?? 0] || '';
      let liberado = partes[mapaCabecalho.liberado ?? 1] || '';
      let parcela = partes[mapaCabecalho.parcela ?? 2] || '';
      let prazoOuFim = partes[mapaCabecalho.prazo ?? 3] || '';
      let pagasOuInicio = partes[mapaCabecalho.inicio ?? 4] || '';
      let brutoOuFim = partes[mapaCabecalho.bruto ?? 5] || '';

      // Aceita também a colagem direta da tabela marcada: contrato, banco,
      // situação, origem, início, fim, prazo, parcela e liberado.
      if (!temCabecalho && partes.length >= 7) {
        const datas = partes
          .map((valor, indice) => ({ valor, indice }))
          .filter(({ valor }) => datasDoTexto(valor).length > 0);
        const moedas = partes
          .map((valor, indice) => ({ valor, indice }))
          .filter(({ valor }) => /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*[,\.]\d{1,2}/.test(valor));
        const prazoTabela = partes.findIndex(valor => {
          const n = Number(valor.replace(/\D/g, ''));
          return /^\d{1,3}$/.test(valor.trim()) && n >= 6 && n <= 420;
        });
        if (datas.length >= 2 && moedas.length >= 2 && prazoTabela >= 0) {
          const textoBanco = partes.slice(0, datas[0].indice)
            .filter(valor => /[A-Za-zÀ-ú]/.test(valor) && !/ativo|origem|averba|situa[cç][aã]o/i.test(valor));
          banco = textoBanco[textoBanco.length - 1] || partes[1] || banco;
          parcela = moedas[moedas.length - 2].valor;
          liberado = moedas[moedas.length - 1].valor;
          prazoOuFim = partes[prazoTabela];
          pagasOuInicio = datas[0].valor;
          brutoOuFim = datas[1].valor;
        }
      }

      if (mapaCabecalho.fim !== undefined) {
        brutoOuFim = partes[mapaCabecalho.fim] || '';
        if (mapaCabecalho.prazo === undefined) prazoOuFim = '';
      }

      // Caso comum do print: a imagem possui uma coluna extra de prazo
      // numérico (108/96) que NÃO faz parte da saída calibrada.
      // Se vier 6 campos e os campos 5/6 forem datas, ignoramos o campo 4.
      const quartoEhNumero = /^\d{1,3}$/.test(prazoOuFim.replace(/\D/g, ''));
      const quintoTemData = datasDoTexto(pagasOuInicio).length > 0;
      const sextoTemData = datasDoTexto(brutoOuFim).length > 0;
      if (partes.length >= 6 && quartoEhNumero && quintoTemData && sextoTemData) {
        prazoOuFim = brutoOuFim;       // FIM
        pagasOuInicio = partes[4];     // INICIO
        brutoOuFim = '';
      }

      const calculado = calcularPrazoPagas(prazoOuFim, pagasOuInicio, brutoOuFim);
      const pzNum = Number(calculado.prazo);
      const pgNum = Number(calculado.pagas || 0);
      const libInput = moedaParaInput(liberado);
      const parcInput = moedaParaInput(parcela);
        const libNum = parseFloat(libInput.replace(/\./g, '').replace(',', '.')) || 0;
        const parcNum = parseFloat(parcInput.replace(/\./g, '').replace(',', '.')) || 0;
        if (!banco || !libInput || !parcInput || !(pzNum >= 6 && pzNum <= 420) || pgNum > pzNum ||
          !(parcNum < libNum) || parcNum * pzNum < libNum * 0.9) { invalidas++; return null; }
      return {
        banco,
        valorLiberado: libInput,
        parcela: parcInput,
        prazo: String(pzNum),
        mesesPagos: String(pgNum),
        valorBrutoRestante: calculado.bruto,
      };
    }).filter(Boolean) as NonNullable<DadosExtraidos['multiContratos'][number]>[];

    if (!contratosCalibrados.length) {
      setOcr(slotKey, { erro: 'Nenhuma linha válida. Use: BANCO;LIBERADO;PARCELA;PRAZO;PAGAS ou informe um cabeçalho na primeira linha.' });
      return;
    }

    salvarModeloCalibragem(ocr.calibragemTipo, ocr.textoCalibragem, contratosCalibrados);

    setOcr(slotKey, {
      erro: invalidas ? `${invalidas} linha(s) ignorada(s); revise a prévia antes de aplicar.` : '',
      dados: {
        ...contratosCalibrados[0],
        textoCompleto: ocr.textoCalibragem,
        confianca: 99,
        multiContratos: contratosCalibrados,
        colunasDetectadas: [`Calibragem manual ${ocr.calibragemTipo.toUpperCase()}: BANCO; LIBERADO; PARCELA; FIM/PRAZO; INICIO/PAGAS`],
        segmento: 'consignado',
        camposGenericos: {},
      },
    });
  }

  function aplicarMultiContratos(slotKey: number) {
    const ocr = getOcr(slotKey);
    if (!ocr.dados?.multiContratos?.length) return;
    const multi = ocr.dados.multiContratos;

    setSlots(prev => {
      const idx = prev.findIndex(s => s.key === slotKey);
      if (idx === -1) return prev;
      const limiteDisponivel = Math.max(0, MAX_SLOTS - (prev.length - 1));
      const usados = multi.slice(0, limiteDisponivel);
      if (!usados.length) return prev;

      const novos: FormSlot[] = usados.map((c: any) => ({
        key: novaChaveSlot(),
        banco: c.banco || '',
        valorLiberado: c.valorLiberado || '',
        parcela: c.parcela || '',
        prazo: c.prazo || '',
        mesesPagos: c.mesesPagos || '',
        valorBrutoRestante: c.valorBrutoRestante || '',
      }));

      const out = [...prev];
      out.splice(idx, 1, ...novos);
      return out;
    });

    limparImagem(slotKey);
  }

  function limparImagem(slotKey: number) {
    setOcrMap(prev => {
      const atual = prev[slotKey];
      if (atual?.imageUrl && !atual.isPdf) {
        try { URL.revokeObjectURL(atual.imageUrl); } catch { /* ignora */ }
      }
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
    // Reset dos file inputs deste slot (todos os 3 botões)
    ['ocr-input', 'ocr-input-retry', 'ocr-input-drop'].forEach(prefix => {
      const input = document.getElementById(`${prefix}-${slotKey}`) as HTMLInputElement | null;
      if (input) input.value = '';
    });
  }

  const [novoNome, setNovoNome] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [novoSenha, setNovoSenha] = useState('');
  const [novoRole, setNovoRole] = useState<Role>('comum');
  const [novoLimite, setNovoLimite] = useState('0');
  const [novoAcessos, setNovoAcessos] = useState(0);
  const [novoExpiracao, setNovoExpiracao] = useState('');
  const [novoPerms, setNovoPerms] = useState<Permissoes>(permissoesPadrao('comum'));
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [adminBusca, setAdminBusca] = useState('');
  const [adminMsg, setAdminMsg] = useState('');

  useEffect(() => {
    (async () => {
      // 1) Baixa usuários da nuvem (se configurada) antes de garantir o master
      try {
        const { sincronizarUsuariosDaNuvem } = await import('./utils/users');
        await sincronizarUsuariosDaNuvem();
      } catch { /* offline */ }

      const lista = garantirMaster();
      setAllUsers(lista);

      // O acesso nao e restaurado automaticamente ao recarregar a pagina.
      // O usuario precisa autenticar novamente pelo botao Entrar.
      limparSessao();

      // 3) Espelha as tabelas de coeficientes da nuvem (adiciona, atualiza
      //    E remove as que não existem mais no banco — evita acúmulo).
      //    Baixa as do escopo GLOBAL + as do usuário logado.
      try {
        const { nuvemBaixarTabelas, nuvemAtiva } = await import('./utils/cloudDb');
        if (nuvemAtiva()) {
          const { sincronizarTabelasDaNuvem } = await import('./utils/coeficientes');
          // Escopo global (Todos os usuários) — baixa sempre
          const tabsGlobal = await nuvemBaixarTabelas('global');
          if (tabsGlobal) {
            (['governo', 'siape', 'inss'] as const).forEach((conv) => {
              sincronizarTabelasDaNuvem(conv, tabsGlobal[conv] || [], 'global');
            });
          }
          // Escopo do usuário logado (se não for o master global)
          const uid = obterSessaoUsuario()?.id || 'global';
          if (uid !== 'global') {
            const tabsUser = await nuvemBaixarTabelas(uid);
            if (tabsUser) {
              (['governo', 'siape', 'inss'] as const).forEach((conv) => {
                sincronizarTabelasDaNuvem(conv, tabsUser[conv] || [], uid);
              });
            }
          }
          setTabelasVersion(v => v + 1);
        }
      } catch { /* offline */ }

      // 4) Envia automaticamente os dados locais para a nuvem (merge).
      //    Assim o que foi criado nesta máquina sobe para o banco e fica
      //    disponível em qualquer outro computador/navegador.
      try {
        const { enviarDadosLocaisParaNuvem, nuvemAtiva } = await import('./utils/cloudDb');
        if (nuvemAtiva()) await enviarDadosLocaisParaNuvem();
      } catch { /* offline — tenta de novo na próxima abertura */ }
    })();
  }, []);

  function recarregarUsuarios() {
    const lista = lerUsuarios();
    setAllUsers(lista);
    const sess = obterSessaoUsuario();
    if (sess) {
      setCurrentUser(sess);
    } else if (currentUser) {
      limparSessao();
      setCurrentUser(null);
      setContratos([]);
      setShowAdmin(false);
    }
  }

  /** Derruba a sessão local exibindo o motivo na tela de login */
  function derrubarSessao(mensagem: string) {
    // Remove o token do registro local SEM enviar à nuvem
    // (o dispositivo que assumiu é legítimo; não sobrescrever o token dele)
    const idSessao = obterSessaoId();
    if (idSessao) limparTokenSessaoLocal(idSessao);
    limparSessao();
    setCurrentUser(null);
    setContratos([]);
    setSlots([emptySlot()]);
    setOcrMap({});
    setShowAdmin(false);
    setAvisoSessao(mensagem);
  }

  // ══════════════════════════════════════════════════════
  //  HEARTBEAT — sessão única (1 acesso por vez)
  //  Verifica a cada 30s, ao voltar para a aba e em outras abas
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    if (!currentUser) return;

    let vivo = true;
    let checando = false; // evita requisições sobrepostas

    const checar = async () => {
      if (!vivo || checando) return;
      // Não gasta requisição se o navegador está offline
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      checando = true;
      try {
        const r = await validarSessaoAtiva();
        const dbg = depurarSessaoAtual();
        setDebugSessao(dbg);
        console.info('[sessao][heartbeat]', { ...dbg, resultado: r });
        if (!vivo) return;
        if (!r.ok) derrubarSessao(mensagemQueda(r.motivo));
      } catch { /* offline: mantém sessão */ }
      finally { checando = false; }
    };

    const intervalo = window.setInterval(checar, 30000);
    const aoFocar = () => { if (document.visibilityState === 'visible') checar(); };
    document.addEventListener('visibilitychange', aoFocar);
    window.addEventListener('focus', aoFocar);
    window.addEventListener('online', checar);

    // Detecta login em outra aba do mesmo navegador (localStorage sincroniza entre abas)
    const aoMudarStorage = (e: StorageEvent) => {
      if (e.key === 'consig_users' || e.key === 'consig_session_token') checar();
    };
    window.addEventListener('storage', aoMudarStorage);

    // Dá um tempo inicial para o token propagar e evita falso logout logo após login/refresh
    const atraso = window.setTimeout(checar, 12000);

    return () => {
      vivo = false;
      clearTimeout(atraso);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoFocar);
      window.removeEventListener('focus', aoFocar);
      window.removeEventListener('online', checar);
      window.removeEventListener('storage', aoMudarStorage);
    };
  }, [currentUser?.id]);

  // Libera os object URLs das imagens ao desmontar (evita vazamento de memória)
  useEffect(() => {
    return () => {
      Object.values(ocrMap).forEach(o => {
        if (o?.imageUrl && !o.isPdf) {
          try { URL.revokeObjectURL(o.imageUrl); } catch { /* ignora */ }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [toast, setToast] = useState<{ texto: string; ok: boolean } | null>(null);

  function mostrarToast(texto: string, ok = true) {
    setToast({ texto, ok });
    window.setTimeout(() => setToast(null), 4000);
  }

  async function revalidarSessaoAgora() {
    const info = depurarSessaoAtual();
    setDebugSessao(info);
    console.info('[sessao][manual-check]', info);
    const resultado = await validarSessaoAtiva();
    console.info('[sessao][manual-check-result]', resultado);
    if (!resultado.ok) {
      derrubarSessao(mensagemQueda(resultado.motivo));
      return;
    }
    mostrarToast('Sessão validada com sucesso no navegador atual.');
  }

  // Identificador da marca d'água (torna capturas de tela rastreáveis)
  const textoMarca = currentUser
    ? `${currentUser.nome} • ${currentUser.email} • ${descreverDispositivo()} • ${new Date().toLocaleDateString('pt-BR')} ${new Date().toTimeString().slice(0, 5)}`
    : `Acesso não identificado • ${descreverDispositivo()} • ${new Date().toLocaleDateString('pt-BR')} ${new Date().toTimeString().slice(0, 5)}`;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (entrando) return;
    setLoginErro('');
    setAvisoSessao('');
    setEntrando(true);

    // 1) Autentica com dados LOCAIS primeiro — nunca depende da nuvem
    const res = await autenticar(loginEmail, loginSenha);
    if ('erro' in res && res.erro) { setLoginErro(res.erro); setEntrando(false); return; }
    const u = res.usuario!;

    const sessoesAtivas = lerSessoesAtivas(u);
    const maxSessoes = limiteSessoes(u);
    if (sessoesAtivas.length >= maxSessoes) {
      const antiga = sessoesAtivas[0]?.dispositivo ? `\n\nA sessão mais antiga (${sessoesAtivas[0].dispositivo}) será desconectada.` : '';
      const ok = confirm(
        `Esta conta permite até ${maxSessoes} acesso(s) simultâneo(s).${antiga}\n\nContinuar?`
      );
      if (!ok) { setLoginErro('Login cancelado.'); setEntrando(false); return; }
    }

    // Cria novo token e AGUARDA o banco confirmar antes de liberar a sessão.
    await salvarSessao(u.id);
    setUsuarioCoeficientes(u.id);
    setTabelasVersion(v => v + 1);
    setCurrentUser({ ...u, sessaoDispositivo: descreverDispositivo() });

    // Workspace desta sessão (não sincroniza entre acessos simultâneos)
    const contratosFinais = lerContratosUsuario(u.id);
    const taxaFinal = lerTaxaRefUsuario(u.id);
    setContratos(contratosFinais);
    setTaxaRef(taxaFinal);
    setTaxaRefInput(isNaN(taxaFinal) ? '' : (taxaFinal * 100).toLocaleString('pt-BR'));

    // 3) SÓ DEPOIS de logado, sincroniza usuários com a nuvem
    try {
      const { sincronizarUsuariosDaNuvem } = await import('./utils/users');
      await sincronizarUsuariosDaNuvem();
    } catch { /* offline: mantém locais */ }

    // 4) Espelha as tabelas de coeficientes da nuvem (inclui remoções
    // feitas em outra máquina — evita acúmulo de remessas antigas).
    //    Baixa GLOBAL + tables do usuário logado.
    try {
      const { nuvemBaixarTabelas, nuvemAtiva } = await import('./utils/cloudDb');
      if (nuvemAtiva()) {
        const { sincronizarTabelasDaNuvem } = await import('./utils/coeficientes');
        // Escopo global (Todos os usuários)
        const tabsGlobal = await nuvemBaixarTabelas('global');
        if (tabsGlobal) {
          (['governo', 'siape', 'inss'] as const).forEach((conv) => {
            sincronizarTabelasDaNuvem(conv, tabsGlobal[conv] || [], 'global');
          });
        }
        // Escopo do usuário logado
        if (u.id !== 'global') {
          const tabsUser = await nuvemBaixarTabelas(u.id);
          if (tabsUser) {
            (['governo', 'siape', 'inss'] as const).forEach((conv) => {
              sincronizarTabelasDaNuvem(conv, tabsUser[conv] || [], u.id);
            });
          }
        }
        setTabelasVersion(v => v + 1);
      }
    } catch { /* offline */ }

    recarregarUsuarios();
    setLoginEmail('');
    setLoginSenha('');
    setEntrando(false);
  }

  function handleLogout() {
    // Libera a conta na nuvem para novo login em qualquer dispositivo
    encerrarSessao();
    setCurrentUser(null);
    setContratos([]);
    setSlots([emptySlot()]);
    setOcrMap({});
    setShowAdmin(false);
    setAvisoSessao('');
  }

  function atualizar(lista: Contrato[]) {
    if (!currentUser) return;
    // O limite só bloqueia CRESCIMENTO. Remoções sempre passam —
    // senão o usuário ficaria travado se o master reduzisse o limite.
    const cresceu = lista.length > contratos.length;
    if (cresceu && currentUser.limiteContratos > 0 && lista.length > currentUser.limiteContratos) {
      setErro(`⚠️ Limite de ${currentUser.limiteContratos} contratos atingido. Fale com o master.`);
      return;
    }
    setContratos(lista);
    gravarContratosUsuario(currentUser.id, lista);
    recarregarUsuarios();
  }

  function validarSlot(slot: FormSlot, idx: number): { ok: boolean; contrato?: Contrato; erro?: string } {
    const label = slots.length > 1 ? `Caixa ${idx + 1}: ` : '';
    const valorLiberadoNum = parseNum(slot.valorLiberado);
    const parcelaNum = parseNum(slot.parcela);
    const prazoNum = parseInt(slot.prazo);
    const mesesPagosInformado = slot.mesesPagos.trim().length > 0;
    const brutoRestanteInformado = slot.valorBrutoRestante.trim().length > 0;
    const mesesPagosNum = mesesPagosInformado ? parseInt(slot.mesesPagos) : NaN;
    const valorBrutoRestanteNum = brutoRestanteInformado ? parseNum(slot.valorBrutoRestante) : NaN;
    if (!(valorLiberadoNum > 0)) return { ok: false, erro: label + 'Valor liberado inválido.' };
    if (!(parcelaNum > 0)) return { ok: false, erro: label + 'Valor da parcela inválido.' };
    if (!(prazoNum >= 1)) return { ok: false, erro: label + 'Prazo inválido.' };
    if (!mesesPagosInformado && !brutoRestanteInformado) return { ok: false, erro: label + 'Informe parcelas já pagas ou o valor bruto restante.' };
    if (mesesPagosInformado) {
      if (!(mesesPagosNum >= 0)) return { ok: false, erro: label + 'Parcelas pagas inválidas.' };
      if (mesesPagosNum > prazoNum) return { ok: false, erro: label + 'Parcelas pagas não podem exceder o prazo total.' };
    }
    let restantesPorBruto = NaN;
    if (brutoRestanteInformado) {
      if (!(valorBrutoRestanteNum >= 0)) return { ok: false, erro: label + 'Valor bruto restante inválido.' };
      restantesPorBruto = valorBrutoRestanteNum / parcelaNum;
      const restantesArred = Math.round(restantesPorBruto);
      if (Math.abs(restantesPorBruto - restantesArred) > 0.02) return { ok: false, erro: label + 'O valor bruto restante deve ser compatível com o valor da parcela.' };
      if (restantesArred < 0 || restantesArred > prazoNum) return { ok: false, erro: label + 'Quantidade de parcelas fora do prazo total.' };
      restantesPorBruto = restantesArred;
    }
    if (mesesPagosInformado && brutoRestanteInformado) {
      const restantesPorPagos = prazoNum - mesesPagosNum;
      if (Math.abs(restantesPorPagos - restantesPorBruto) > 0.02) return { ok: false, erro: label + 'Parcelas pagas e valor bruto restante não conferem.' };
    }
    if (parcelaNum * prazoNum < valorLiberadoNum) return { ok: false, erro: label + 'Total das parcelas é menor que o valor liberado.' };
    return {
      ok: true,
      contrato: {
        id: Date.now() + Math.random().toString(16).slice(2),
        banco: slot.banco.trim() || 'Não informado',
        valorLiberado: valorLiberadoNum,
        parcela: parcelaNum,
        prazo: prazoNum,
        ...(mesesPagosInformado ? { mesesPagos: mesesPagosNum } : {}),
        ...(brutoRestanteInformado ? { valorBrutoRestante: valorBrutoRestanteNum } : {}),
      },
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!currentUser) return;
    if (!currentUser.permissoes.podeAdicionarContrato) {
      setErro('⚠️ Você não tem permissão para adicionar contratos.');
      return;
    }
    // Mantém o índice REAL da caixa para a mensagem de erro bater com a tela
    const preenchidos = slots
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.valorLiberado.trim() || s.parcela.trim() || s.prazo.trim() || s.banco.trim());

    if (preenchidos.length === 0) {
      setErro('⚠️ Preencha pelo menos uma caixa de contrato.');
      return;
    }

    const novos: Contrato[] = [];
    for (const { s, idx } of preenchidos) {
      const res = validarSlot(s, idx); // idx real, não do array filtrado
      if (!res.ok) {
        setErro('⚠️ ' + res.erro);
        // Rola até a caixa com problema
        document.getElementById(`slot-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      novos.push(res.contrato!);
    }

    const totalApos = contratos.length + novos.length;
    if (currentUser.limiteContratos > 0 && totalApos > currentUser.limiteContratos) {
      setErro(`⚠️ Limite de ${currentUser.limiteContratos} contratos. Você tem ${contratos.length} e está tentando adicionar ${novos.length}.`);
      return;
    }

    atualizar([...contratos, ...novos]);
    // Libera os object URLs das imagens antes de resetar
    Object.values(ocrMap).forEach(o => {
      if (o?.imageUrl && !o.isPdf) { try { URL.revokeObjectURL(o.imageUrl); } catch { /* ignora */ } }
    });
    setOcrMap({});
    setSlots([emptySlot()]);
    setErro('');
  }

  function removerContrato(id: string) {
    if (!currentUser?.permissoes.podeExcluirContrato) { setErro('⚠️ Sem permissão para excluir.'); return; }
    atualizar(contratos.filter((c) => String(c.id) !== String(id)));
  }

  function limparTudo() {
    if (!currentUser?.permissoes.podeExcluirContrato) return;
    if (confirm('Apagar TODOS os contratos cadastrados?')) atualizar([]);
  }

  function aplicarTaxaRef() {
    if (!currentUser) return;
    if (!currentUser.permissoes.podeDefinirTaxaRef) { setErro('⚠️ Sem permissão para definir taxa de referência.'); return; }

    // Campo vazio = remove a referência
    if (!taxaRefInput.trim()) {
      setTaxaRef(NaN);
      gravarTaxaRefUsuario(currentUser.id, NaN);
      setErro('');
      return;
    }

    const v = parseNum(taxaRefInput);
    if (isNaN(v) || v <= 0 || v > 100) {
      setErro('⚠️ Taxa de referência inválida. Informe um valor entre 0 e 100 (ex.: 1,80).');
      return;
    }

    setTaxaRef(v / 100);
    gravarTaxaRefUsuario(currentUser.id, v / 100);
    setErro('');
  }

  /** Remove caracteres fora do Latin-1 (que o jsPDF corrompe) */
  function latin1(s: string): string {
    return s
      .replace(/[\u2014\u2013]/g, '-')   // — – → -
      .replace(/[\u2018\u2019]/g, "'")   // ‘ ’ → '
      .replace(/[\u201C\u201D]/g, '"')   // “ ” → "
      .replace(/[\u2022\u25CF\u25CB]/g, '-') // • ● ○ → -
      .replace(/[\u2713\u2717]/g, '')    // ✓ ✗
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // emojis
      // Fallback: qualquer caractere fora do Latin-1
      .replace(/[^\u0000-\u00FF]/g, '');
  }

  function gerarPDF() {
    if (!currentUser?.permissoes.podeExportarPDF) { mostrarToast('Sem permissão para exportar PDF.', false); return; }
    if (!contratos.length) { mostrarToast('Cadastre pelo menos um contrato antes de exportar.', false); return; }

    try {
      const doc = new jsPDF();
      const BRL = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const PCTm = (v: number) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + '% a.m.';
      const PCTa = (v: number) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.a.';
      let y = 16;
      const linha = (txt: string, opts: { size?: number; bold?: boolean; x?: number; dy?: number } = {}) => {
        const { size = 10, bold = false, x = 14, dy = 6 } = opts;
        if (y > 280) { doc.addPage(); y = 16; }
        doc.setFontSize(size);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.text(latin1(txt), x, y);
        y += dy;
      };
      const div = () => { if (y > 280) { doc.addPage(); y = 16; } doc.setDrawColor(120, 160, 140); doc.setLineWidth(0.4); doc.line(14, y - 3, 196, y - 3); y += 4; };

      // Cabeçalho
      doc.setFillColor(6, 78, 59);
      doc.rect(14, 10, 182, 14, 'F');
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
      doc.text('RELATÓRIO - ANÁLISE DE EMPRÉSTIMO CONSIGNADO', 20, 19.5);
      y = 30;

      linha(`Usuário: ${currentUser.nome} (${currentUser.email})`, { size: 9, dy: 5 });
      linha('Gerado em ' + new Date().toLocaleString('pt-BR'), { size: 9, dy: 5 });
      if (!isNaN(taxaRef)) linha('Taxa de referência: ' + PCTm(taxaRef), { size: 9, dy: 5 });
      y += 4;

      // Por banco
      const grupos = agruparPorBanco(contratos);
      Object.keys(grupos).sort().forEach((chave) => {
        const lista = grupos[chave];
        const r = consolidar(lista);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(6, 78, 59);
        linha('BANCO: ' + (lista[0].banco || 'NAO INFORMADO').toUpperCase() + ` (${lista.length} contrato${lista.length > 1 ? 's' : ''})`, { size: 11, bold: true, dy: 6 });
        doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'normal');
        linha(`Consolidado: liberado ${BRL(r.liberadoTotal)} | parcelas/mes ${BRL(r.parcelaMensal)}`, { size: 9, x: 18 });
        linha(`Saldo devedor total: ${BRL(r.sdTotal)} | taxa media: ${PCTm(r.taxaMedia)} | juros a vencer: ${BRL(r.jurosAVencer)}`, { size: 9, x: 18, dy: 7 });
        lista.forEach((c, i) => {
          const a = analisar(c);
          const acima = !isNaN(taxaRef) && a.taxa > taxaRef;
          const flag = acima ? '   *** ACIMA DA REFERENCIA ***' : '';
          const crit = a.criterioSaldo === 'valorBrutoRestante' ? 'bruto restante' : 'parcelas pagas';
          const pagosArred = Math.round(a.pagosUtilizados * 100) / 100;
          const pagosTxt = Number.isInteger(pagosArred) ? String(pagosArred) : pagosArred.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (acima) doc.setTextColor(185, 28, 28); else doc.setTextColor(30, 41, 59);
          linha(`Contrato ${i + 1}: liberado ${BRL(c.valorLiberado)} | parcela ${BRL(c.parcela)} | prazo ${c.prazo}m | pagas ${pagosTxt}`, { size: 9, x: 22 });
          linha(`taxa ${PCTm(a.taxa)} (${PCTa(a.taxaAA)}) | saldo devedor ${BRL(a.sd)} | base ${crit}: ${BRL(a.brutoRestanteUtilizado)}${flag}`, { size: 9, x: 22, dy: 7 });
        });
        doc.setFont('helvetica', 'normal');
        div();
        y += 4;
      });

      // Resultado geral
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(6, 78, 59);
      const rg = consolidar(contratos);
      linha(`RESULTADO GERAL - ${rg.qtd} contrato(s)`, { size: 12, bold: true, dy: 6 });
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'normal');
      linha(`Total liberado: ${BRL(rg.liberadoTotal)} | Parcelas/mes: ${BRL(rg.parcelaMensal)}`, { size: 10, x: 18 });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(6, 78, 59);
      linha(`SALDO DEVEDOR TOTAL (quitacao): ${BRL(rg.sdTotal)}`, { size: 11, bold: true, x: 18 });
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
      linha(`Taxa media ponderada: ${PCTm(rg.taxaMedia)} (${PCTa(rg.taxaMediaAA)})`, { size: 10, x: 18 });
      linha(`Total ja pago: ${BRL(rg.totalPago)} | Juros a vencer: ${BRL(rg.jurosAVencer)}`, { size: 10, x: 18, dy: 10 });
      linha('Calculos pela Tabela Price. Para analise de juros abusivos, use o valor liquido creditado em conta.', { size: 8, dy: 4 });
      linha('Este relatorio e gerado pelo Analisador de Emprestimo Consignado e tem carater informativo.', { size: 8 });

      doc.save('relatorio-consignado.pdf');
      mostrarToast('PDF gerado com sucesso! Verifique seus downloads.');
    } catch (e: any) {
      mostrarToast('Erro ao gerar o PDF: ' + (e?.message || 'desconhecido'), false);
    }
  }

  const grupos = useMemo(() => agruparPorBanco(contratos), [contratos]);
  const chaves = Object.keys(grupos).sort();
  const dadosGrafico = useMemo(() => chaves.map((ch) => ({ nome: grupos[ch][0].banco, sd: consolidar(grupos[ch]).sdTotal })), [chaves, grupos]);
  const totalSd = dadosGrafico.reduce((s, d) => s + d.sd, 0);

  async function handleSalvarUsuario(e: React.FormEvent) {
    e.preventDefault();
    setAdminMsg('');
    try {
      const emailLimpo = novoEmail.trim().toLowerCase();
      // Expiração: fim do dia no fuso local (evita expirar 21h do dia anterior no BRT)
      let expIso = '';
      if (novoExpiracao) {
        const [a, m, d] = novoExpiracao.split('-').map(Number);
        expIso = new Date(a, m - 1, d, 23, 59, 59).toISOString();
      }

      const dados = {
        nome: novoNome.trim(), email: emailLimpo, senha: novoSenha,
        role: novoRole,
        bloqueado: false,
        limiteContratos: Math.max(0, parseInt(novoLimite) || 0),
        acessosSimultaneos: Math.max(0, Math.min(10, novoAcessos || 0)),
        dataExpiracao: expIso,
        permissoes: { ...novoPerms },
      };

      // ── Validações ──
      if (!dados.nome) throw new Error('Informe o nome.');
      if (!dados.email) throw new Error('Informe o e-mail.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email)) throw new Error('E-mail inválido.');
      if (!editandoId && !dados.senha) throw new Error('Informe a senha.');
      if (dados.senha && dados.senha.length < 6) throw new Error('A senha precisa ter no mínimo 6 caracteres.');
      if (expIso && new Date(expIso) < new Date()) throw new Error('A data de expiração já passou.');
      if (!Object.values(dados.permissoes).some(Boolean) && dados.role !== 'master') {
        throw new Error('Marque ao menos uma permissão para o usuário.');
      }

      if (editandoId) {
        const alvo = allUsers.find(u => u.id === editandoId);
        // Impede remover o último master do sistema
        if (alvo?.role === 'master' && dados.role !== 'master') {
          const masters = allUsers.filter(u => u.role === 'master').length;
          if (masters <= 1) throw new Error('Não é possível rebaixar o último master do sistema.');
        }

        const patch: Partial<Usuario> = {
          nome: dados.nome, email: dados.email, role: dados.role,
          limiteContratos: dados.limiteContratos,
          acessosSimultaneos: dados.acessosSimultaneos,
          dataExpiracao: dados.dataExpiracao,
          permissoes: dados.permissoes,
        };
        if (dados.senha) patch.senha = await hashSenha(dados.senha);
        const atualizado = atualizarUsuario(editandoId, patch);

        // Se editou a própria conta, reflete na sessão atual
        if (editandoId === currentUser?.id) setCurrentUser(atualizado);

        setAdminMsg(`✅ Usuário "${atualizado.nome}" atualizado com sucesso!`);
      } else {
        const novo = criarUsuario({ ...dados, senha: await hashSenha(dados.senha) } as any);
        setAdminMsg(`✅ Usuário "${novo.nome}" criado com sucesso!`);
      }

      setNovoNome(''); setNovoEmail(''); setNovoSenha(''); setNovoRole('comum');
      setNovoLimite('0'); setNovoAcessos(0); setNovoExpiracao(''); setNovoPerms(permissoesPadrao('comum'));
      setEditandoId(null);
      recarregarUsuarios();
    } catch (err: any) { setAdminMsg('⚠️ ' + (err.message || 'Erro ao salvar')); }
  }

  function iniciarEdicao(u: Usuario) {
    setEditandoId(u.id);
    setNovoNome(u.nome); setNovoEmail(u.email); setNovoSenha('');
    setNovoRole(u.role); setNovoLimite(String(u.limiteContratos)); setNovoAcessos(u.acessosSimultaneos ?? 0);
    setNovoExpiracao(u.dataExpiracao ? u.dataExpiracao.slice(0, 10) : '');
    setNovoPerms({ ...u.permissoes });
    setShowAdmin(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('formUsuario')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setNovoNome(''); setNovoEmail(''); setNovoSenha(''); setNovoRole('comum');
    setNovoLimite('0'); setNovoAcessos(0); setNovoExpiracao(''); setNovoPerms(permissoesPadrao('comum'));
    setAdminMsg('');
  }

  const usuariosFiltrados = useMemo(() => {
    const q = adminBusca.toLowerCase().trim();
    if (!q) return allUsers;
    return allUsers.filter((u) => u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.includes(q));
  }, [allUsers, adminBusca]);

  const stats = useMemo(() => {
    const total = allUsers.length;
    const ativos = allUsers.filter((u) => !u.bloqueado).length;
    const bloqueados = total - ativos;
    const masters = allUsers.filter((u) => u.role === 'master').length;
    const expirados = allUsers.filter((u) => u.dataExpiracao && new Date() > new Date(u.dataExpiracao)).length;
    return { total, ativos, bloqueados, masters, expirados, comuns: total - masters };
  }, [allUsers]);

  const podeVerAdmin = currentUser?.role === 'master';

  return (
    <>
      <FundoDinheiro />
      <style>{`
        :root{--verde:#10b981; --verde-esc:#064e3b; --verde-med:#047857; --verde-vivo:#34d399; --verde-ok:#22c55e; --ouro:#f59e0b; --ouro-claro:#fbbf24; --texto:#0f172a; --cinza:#64748b; --cinza-cl:#94a3b8; --borda:#e6ebf2; --vermelho:#ef4444; --sombra-sm:0 1px 2px rgba(2,44,34,.06),0 1px 3px rgba(2,44,34,.05); --sombra:0 4px 6px -1px rgba(2,44,34,.07),0 2px 4px -2px rgba(2,44,34,.05); --sombra-lg:0 20px 40px -12px rgba(2,44,34,.28),0 8px 16px -8px rgba(2,44,34,.16); --r:16px;}
        *{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
        body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:radial-gradient(1100px 700px at 12% -8%,rgba(16,185,129,.22),transparent 60%),radial-gradient(900px 600px at 92% 6%,rgba(251,191,36,.13),transparent 55%),radial-gradient(800px 900px at 50% 105%,rgba(6,182,212,.1),transparent 60%),linear-gradient(165deg,#021a15 0%,#032e24 40%,#04372c 100%);background-attachment:fixed;color:var(--texto);line-height:1.6;min-height:100vh;letter-spacing:-.011em;}
        h1,h2,h3{font-family:'Sora','Inter',system-ui,sans-serif;letter-spacing:-.025em;line-height:1.25}
        .dinheiro{position:absolute;top:0;user-select:none;animation:flutuar linear infinite;will-change:transform;filter:saturate(.85)}
        .moeda{border-radius:50%;background:radial-gradient(circle at 32% 28%,#fde68a,#f59e0b 55%,#b45309);box-shadow:inset 0 0 0 2px rgba(146,64,14,.4),0 6px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:#78350f;font-weight:800}
        @keyframes flutuar{0%{transform:translate(0,108vh) rotate(-12deg)}25%{transform:translate(3.5vw,78vh) rotate(10deg)}50%{transform:translate(-3.5vw,48vh) rotate(-8deg)}75%{transform:translate(3vw,18vh) rotate(12deg)}100%{transform:translate(0,-16vh) rotate(-10deg)}}
        @media (prefers-reduced-motion:reduce){.dinheiro{animation:none!important;opacity:.1!important}}
        .conteudo{position:relative;z-index:1}
        header{position:relative;overflow:hidden;text-align:center;color:#fff;padding:52px 20px 44px;background:linear-gradient(135deg,rgba(3,46,36,.88),rgba(4,120,87,.55));backdrop-filter:blur(20px) saturate(160%);border-bottom:1px solid rgba(255,255,255,.1);}
        header::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,var(--ouro-claro),var(--verde-vivo),transparent);opacity:.85}
        .eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a7f3d0;background:rgba(255,255,255,.08);border:1px solid rgba(167,243,208,.22);padding:6px 15px;border-radius:999px;margin-bottom:18px;backdrop-filter:blur(8px)}
        header h1{font-size:clamp(1.7rem,4.2vw,2.7rem);font-weight:800;margin:0}
        header h1 .ouro{background:linear-gradient(100deg,#fbbf24,#fcd34d 45%,#34d399);-webkit-background-clip:text;background-clip:text;color:transparent}
        header p{opacity:.68;font-size:.94rem;margin-top:12px;max-width:640px;margin-left:auto;margin-right:auto;font-weight:400}
        main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
        .card{background:rgba(255,255,255,.97);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.7);border-radius:var(--r);padding:26px;margin-bottom:22px;box-shadow:var(--sombra-lg);transition:box-shadow .3s ease,transform .3s ease;}
        .card:hover{box-shadow:0 26px 50px -14px rgba(2,44,34,.34),0 10px 20px -10px rgba(2,44,34,.2)}
        .card h2{font-size:1.14rem;font-weight:700;margin-bottom:18px;color:var(--verde-esc);display:flex;align-items:center;gap:9px}
        .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}
        label{font-size:.74rem;font-weight:700;color:var(--cinza);display:block;margin-bottom:7px;letter-spacing:.03em;text-transform:uppercase}
        input,select,textarea{width:100%;padding:12px 14px;border:1.5px solid var(--borda);border-radius:11px;font-size:.95rem;background:#fbfcfe;color:var(--texto);font-family:inherit;transition:border-color .18s,box-shadow .18s,background .18s;font-weight:500;}
        input::placeholder{color:var(--cinza-cl);font-weight:400}
        input:hover,select:hover{border-color:#cfe0d8}
        input:focus,select:focus{outline:none;border-color:var(--verde);background:#fff;box-shadow:0 0 0 4px rgba(16,185,129,.13)}
        .form-actions{margin-top:20px;display:flex;gap:11px;flex-wrap:wrap;align-items:center}
        button{cursor:pointer;border:none;border-radius:11px;padding:12px 22px;font-size:.88rem;font-weight:650;font-family:inherit;letter-spacing:-.01em;transition:transform .16s cubic-bezier(.34,1.56,.64,1),box-shadow .2s,filter .2s;display:inline-flex;align-items:center;gap:7px;}
        button:hover{transform:translateY(-2px)}button:active{transform:translateY(0) scale(.98)}
        .btn-primario{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 14px rgba(16,185,129,.36)}
        .btn-primario:hover{box-shadow:0 8px 22px rgba(16,185,129,.46)}
        .btn-ouro{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#422006;box-shadow:0 4px 14px rgba(245,158,11,.36)}
        .btn-ouro:hover{box-shadow:0 8px 22px rgba(245,158,11,.46)}
        .btn-perigo{background:linear-gradient(135deg,#f87171,#ef4444);color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.3)}
        .btn-perigo:hover{box-shadow:0 8px 22px rgba(239,68,68,.4)}
        .btn-neutro{background:#eef2f7;color:#334155;box-shadow:inset 0 0 0 1px rgba(15,23,42,.06)}
        .btn-neutro:hover{background:#e4eaf2}
        .btn-mini{padding:6px 13px;font-size:.75rem;border-radius:9px}
        .msg-erro{background:linear-gradient(135deg,#fef2f2,#fee2e2);color:#b91c1c;border:1px solid #fecaca;padding:13px 16px;border-radius:12px;margin-top:14px;font-size:.85rem;font-weight:600;animation:slideIn .3s ease}
        .msg-ok{background:linear-gradient(135deg,#ecfdf5,#d1fae5);color:#065f46;border:1px solid #a7f3d0;padding:13px 16px;border-radius:12px;margin-top:14px;font-size:.85rem;font-weight:600}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        .ref-bar{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
        .ref-bar>div{min-width:0;flex:0 0 150px;max-width:150px}
        .ref-bar>div input{padding:9px 12px;font-size:.88rem}
        .ref-bar .btn-primario{padding:9px 18px;font-size:.84rem}
        #barraUsuario{display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap}
        .pill{background:rgba(255,255,255,.14);backdrop-filter:blur(14px);border-radius:999px;padding:8px 17px;font-size:.78rem;font-weight:600;color:#d1fae5;border:1px solid rgba(255,255,255,.18)}
        .pill-master{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#422006;border:none;font-weight:800}
        .banco-header{background:linear-gradient(120deg,#043d2f,#059669 65%,#0d9488);color:#fff;padding:17px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;position:relative;overflow:hidden}
        .banco-header::before{content:'';position:absolute;inset:0;background:radial-gradient(560px 130px at 88% 0%,rgba(251,191,36,.28),transparent 70%)}
        .banco-header h2,.banco-header span{position:relative;color:#fff;margin:0}
        .banco-header h2{font-size:1.06rem;font-weight:700}
        .banco-header span{font-size:.76rem;opacity:.82;background:rgba(255,255,255,.15);padding:4px 12px;border-radius:999px;font-weight:600}
        .banco-bloco{border-radius:var(--r);margin-bottom:22px;overflow:hidden;background:rgba(255,255,255,.97);backdrop-filter:blur(16px);box-shadow:var(--sombra-lg);border:1px solid rgba(255,255,255,.7)}
        .banco-body{padding:22px}
        .resumo{background:linear-gradient(150deg,#f0fdf9,#ecfdf5);border:1px solid #b6f0dc;border-radius:14px;padding:18px 20px;margin-bottom:18px}
        .resumo h3{font-size:.9rem;color:var(--verde-esc);margin-bottom:14px;font-weight:700;letter-spacing:.01em}
        .resumo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:12px}
        .resumo-item{background:#fff;border-radius:12px;padding:14px 16px;border:1px solid var(--borda);box-shadow:var(--sombra-sm);transition:transform .2s,box-shadow .2s}
        .resumo-item:hover{transform:translateY(-2px);box-shadow:var(--sombra)}
        .resumo-item .lbl{font-size:.66rem;color:var(--cinza);font-weight:700;text-transform:uppercase;letter-spacing:.07em;line-height:1.4}
        .resumo-item .val{font-size:1.2rem;font-weight:750;margin-top:5px;font-family:'Sora',sans-serif;letter-spacing:-.03em}
        .destaque{background:linear-gradient(150deg,#ecfdf5,#d1fae5);border-color:#6ee7b7}
        .destaque .val{color:var(--verde-med)}
        .alerta-teto{margin-top:14px;background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid #fcd34d;padding:12px 16px;border-radius:12px;font-size:.82rem;font-weight:600;color:#78350f}
        .contrato{border:1px solid var(--borda);border-radius:14px;padding:18px 20px;margin-bottom:14px;background:#fff;box-shadow:var(--sombra-sm);transition:transform .2s,box-shadow .2s,border-color .2s}
        .contrato:hover{transform:translateY(-2px);box-shadow:var(--sombra);border-color:#c9e5d9}
        .contrato-topo{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;padding-bottom:13px;border-bottom:1px dashed var(--borda)}
        .contrato-topo strong{font-size:.92rem;font-weight:700;color:var(--verde-esc)}
        .badge{font-size:.66rem;font-weight:750;padding:5px 12px;border-radius:999px;letter-spacing:.045em;text-transform:uppercase}
        .badge-ok{background:#052e16;color:#4ade80;box-shadow:inset 0 0 0 1px #166534}
        .badge-alerta{background:#450a0a;color:#f87171;box-shadow:inset 0 0 0 1px #991b1b}
        .badge-role-master{background:linear-gradient(135deg,#451a03,#78350f);color:#fef3c7;border:1px solid #fbbf24}
        .badge-role-comum{background:#1e1b4b;color:#a5b4fc;border:1px solid #6366f1}
        .contrato-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;font-size:.85rem}
        .contrato-grid .lbl{font-size:.64rem;color:var(--cinza);font-weight:700;text-transform:uppercase;letter-spacing:.07em}
        .contrato-grid .val{font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
        .contrato-grid .val.grande{font-size:1.1rem;color:var(--verde-med);font-family:'Sora',sans-serif;letter-spacing:-.03em}
        .vazio{text-align:center;color:var(--cinza);padding:64px 20px;font-size:.95rem;font-weight:500;line-height:1.9}
        .acoes-gerais{display:flex;gap:11px;margin-bottom:22px;flex-wrap:wrap}
        .resumo-geral{background:linear-gradient(140deg,#032e24,#065f46 55%,#0f766e);border:1px solid rgba(251,191,36,.35);position:relative;overflow:hidden}
        .resumo-geral::before{content:'';position:absolute;inset:0;background:radial-gradient(680px 190px at 82% -12%,rgba(251,191,36,.2),transparent 70%)}
        .resumo-geral>*{position:relative}
        .resumo-geral h3{color:var(--ouro-claro);font-size:.94rem}
        .resumo-geral .resumo{background:transparent;border:none;padding:0;margin:0}
        .resumo-geral .resumo-item{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);backdrop-filter:blur(8px);box-shadow:none}
        .resumo-geral .resumo-item:hover{background:rgba(255,255,255,.11);transform:translateY(-2px)}
        .resumo-geral .resumo-item .lbl{color:rgba(209,250,229,.68)}
        .resumo-geral .resumo-item .val{color:#fff}
        .resumo-geral .destaque{background:rgba(251,191,36,.13);border-color:rgba(251,191,36,.3)}
        .resumo-geral .destaque .val{color:var(--ouro-claro)}
        .resumo-geral .alerta-teto{background:rgba(255,255,255,.09);border-color:rgba(251,191,36,.3);color:#fde68a}
        footer{position:relative;z-index:1;text-align:center;color:rgba(209,250,229,.42);font-size:.76rem;padding:28px 20px 40px;max-width:760px;margin:0 auto;line-height:1.8}
        ::-webkit-scrollbar{width:11px;height:11px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(16,185,129,.32);border-radius:99px;border:3px solid transparent;background-clip:content-box}
        ::-webkit-scrollbar-thumb:hover{background:rgba(16,185,129,.5);background-clip:content-box}
        .login-wrap{min-height:72vh;display:grid;place-items:center;padding:24px 16px}
        .login-card{max-width:480px;width:100%;background:rgba(255,255,255,.98);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.8);border-radius:20px;padding:32px;box-shadow:0 30px 80px -20px rgba(2,44,34,.4)}
        .login-card h2{font-size:1.45rem;font-weight:800;color:var(--verde-esc);margin-bottom:6px}
        .login-sub{font-size:.88rem;color:var(--cinza);margin-bottom:20px;line-height:1.55}
        .hint{font-size:.76rem;color:#065f46;background:#ecfdf5;border:1px dashed #6ee7b7;border-radius:10px;padding:10px 12px;margin-bottom:14px}
        .hint code{background:#d1fae5;padding:2px 6px;border-radius:6px;font-weight:700}
        .admin-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
        .admin-toolbar input{max-width:300px}
        .stat-master{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
        .stat-card{background:linear-gradient(145deg,#0f172a,#1e293b);border:1px solid #334155;border-radius:14px;padding:16px 18px;box-shadow:0 4px 12px rgba(0,0,0,.3)}
        .stat-card .s-lbl{font-size:.68rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em}
        .stat-card .s-val{font-size:1.8rem;font-weight:800;font-family:'Sora',sans-serif;letter-spacing:-.03em;margin-top:4px;color:#e2e8f0}
        .stat-card.master{background:linear-gradient(135deg,#451a03,#78350f);border-color:#fbbf24}
        .stat-card.master .s-val{color:#fef3c7}
        .user-list{display:grid;gap:12px}
        .user-item{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:16px 18px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,.25);transition:all .2s}
        .user-item:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.4);border-color:#475569}
        .user-item.bloqueado{opacity:.72;background:#3f1a1a;border-color:#7f1d1d}
        .user-main{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .avatar{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-weight:800;color:#fff;font-family:'Sora';background:linear-gradient(135deg,#10b981,#059669)}
        .avatar.master{background:linear-gradient(135deg,#f59e0b,#d97706)}
        .user-meta{font-size:.8rem;color:#94a3b8;margin-top:2px}
        .perm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:8px}
        .perm-item{display:flex;align-items:center;gap:9px;background:#334155;border:1px solid #475569;padding:9px 12px;border-radius:10px;font-size:.82rem;font-weight:600;color:#e2e8f0}
        .perm-item input{width:auto}
        .slot-card:hover{border-color:#6ee7b7!important;box-shadow:0 4px 16px rgba(16,185,129,.12)}
        .slot-card input:disabled{background:#f1f5f9;color:var(--cinza);cursor:not-allowed}
        .num-badge{display:inline-flex;align-items:center;justify-content:center;
          width:17px;height:17px;border-radius:5px;margin-right:6px;
          font-size:.66rem;font-weight:900;color:#fff;flex:0 0 auto;
          vertical-align:middle;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.18)}
        .num-badge.n1{background:linear-gradient(135deg,#22c55e,#16a34a)}
        .num-badge.n2{background:linear-gradient(135deg,#3b82f6,#1d4ed8)}
        .num-badge.n3{background:linear-gradient(135deg,#a855f7,#7c3aed)}
        .num-badge.n4{background:linear-gradient(135deg,#fbbf24,#d97706)}
        .num-badge.n5{background:linear-gradient(135deg,#f87171,#dc2626)}
        .num-badge.n6{background:linear-gradient(135deg,#475569,#1e293b)}
        .slot-card label{display:flex;align-items:center}
        .ocr-dropzone:hover{background:#dbeafe!important;border-color:#3b82f6!important;transform:translateY(-1px)}
        .ocr-spinner{display:inline-block;animation:spin 1.2s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @media (max-width:640px){header{padding:38px 18px 32px}main{padding:24px 14px 48px}.card,.banco-body{padding:18px}.resumo-item .val{font-size:1.06rem}.slot-card{padding:14px 14px 10px!important}}
        /* ══ IMPRESSÃO ORGANIZADA ═══════════════════════════ */
        .print-only{display:none}
        @media print{
          @page{size:A4;margin:11mm}
          /* ── Evita páginas em branco no início/fim ── */
          html,body{
            background:#fff!important;
            height:auto!important;
            min-height:0!important;
            margin:0!important;
            padding:0!important;
            overflow:visible!important
          }
          body{font-size:11px}
          *{-webkit-print-color-adjust:exact;print-color-adjust:exact}

          /* ── Esconde tudo que não é dados ── */
          header, #fundoDinheiro, .marca-dagua, .no-print,
          #barraUsuario, .login-wrap, footer,
          .admin-card, #formUsuario, .coef-manager, .cloud-config,
          [style*="position: fixed"]{display:none!important}

          /* ── Cabeçalho de relatório (só aparece na impressão) ── */
          .print-only{display:block!important;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #10b981;page-break-after:avoid;break-after:avoid-page}
          .print-only h1{font-family:'Sora',sans-serif;font-size:17px;font-weight:800;color:#064e3b;margin:0 0 3px}
          .print-only p{font-size:10px;color:#475569;margin:0}

          main{max-width:100%!important;padding:0!important;margin:0!important}
          main>*{margin-bottom:14px!important}
          main>*:last-child{margin-bottom:0!important}

          /* ── Cards: fundo branco, sem sombra, texto escuro ── */
          .card,.banco-bloco{background:#fff!important;border:1px solid #cbd5e1!important;box-shadow:none!important;backdrop-filter:none!important}
          .card h2,.card h3,.banco-body h3{color:#0f172a!important}
          .banco-bloco{break-inside:auto;page-break-inside:auto}

          /* ── Bloco de banco ── */
          .banco-header{
            -webkit-print-color-adjust:exact;print-color-adjust:exact;
            break-inside:avoid;page-break-inside:avoid;
            padding:10px 16px!important
          }
          .banco-body{padding:12px!important}

          /* ── Resumo por banco (claro na impressão) ── */
          .resumo{background:#f8fafc!important;border:1px solid #cbd5e1!important;margin-bottom:12px!important}
          .resumo h3{color:#064e3b!important}
          .resumo-item{background:#fff!important;box-shadow:none!important;border:1px solid #e2e8f0!important}
          .resumo-item .lbl{color:#64748b!important}
          .resumo-item .val{color:#0f172a!important;font-size:12px!important}
          .resumo-item.destaque{background:#ecfdf5!important;border-color:#10b981!important}
          .resumo-item.destaque .val{color:#047857!important}
          .alerta-teto{background:#fffbeb!important;border:1px solid #f59e0b!important;color:#92400e!important;margin-top:0!important}

          /* ── Resultado geral: verde claro com texto escuro ── */
          .resumo-geral{background:#fff!important;border:2px solid #10b981!important}
          .resumo-geral::before{display:none!important}
          .resumo-geral h3{color:#064e3b!important}
          .resumo-geral .resumo{background:transparent!important;border:none!important}
          .resumo-geral .resumo-item{background:#f0fdf4!important;border:1px solid #86efac!important}
          .resumo-geral .resumo-item .lbl{color:#475569!important}
          .resumo-geral .resumo-item .val{color:#0f172a!important}
          .resumo-geral .destaque{background:#d1fae5!important;border-color:#10b981!important}
          .resumo-geral .destaque .val{color:#047857!important}
          .resumo-geral .alerta-teto{background:#fffbeb!important;border:1px solid #f59e0b!important;color:#92400e!important}

          /* ── Cartões de contrato: não partir no meio ── */
          .contrato{break-inside:avoid;page-break-inside:avoid;border:1px solid #e2e8f0!important;box-shadow:none!important}
          .contrato-topo strong{color:#064e3b!important}
          .contrato-grid .lbl{color:#64748b!important}
          .contrato-grid .val{color:#0f172a!important}
          .contrato-grid .val.grande{color:#047857!important}
          .badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}

          /* ── Gráfico: manter na mesma página ── */
          .card:has(canvas){break-inside:avoid;page-break-inside:avoid}

          /* ── Tabela de amortização (se visível) ── */
          .overflow-x-auto{overflow:visible!important}
          table{break-inside:auto}
          thead{display:table-header-group}
          tr{break-inside:avoid;page-break-inside:avoid}

          a{text-decoration:none;color:inherit}
        }
      `}</style>

      {/* Marca d'água de sessão (rastreia capturas de tela) */}
      <Watermark texto={textoMarca} />

      {/* Toast genérico (sucesso/erro de ações) */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 300,
          background: toast.ok
            ? 'linear-gradient(135deg,#052e16,#14532d)'
            : 'linear-gradient(135deg,#450a0a,#7f1d1d)',
          border: `1.5px solid ${toast.ok ? '#22c55e' : '#ef4444'}`,
          color: toast.ok ? '#bbf7d0' : '#fecaca',
          padding: '12px 22px',
          borderRadius: 12,
          fontSize: '.86rem',
          fontWeight: 700,
          boxShadow: '0 10px 30px rgba(0,0,0,.45)',
          animation: 'slideIn .3s ease',
          maxWidth: '90%',
        }}>{toast.ok ? '✅ ' : '⚠️ '}{toast.texto}</div>
      )}

      <a
        href="https://wa.me/5569992657490?text=Olá,%20preciso%20de%20suporte%20no%20Analisador%20de%20Empréstimo%20Consignado."
        target="_blank"
        rel="noreferrer"
        className="no-print"
        style={{
          position: 'fixed', left: 18, bottom: 18, zIndex: 280,
          background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#052e16',
          borderRadius: 999, padding: '10px 16px', fontSize: '.84rem', fontWeight: 900,
          boxShadow: '0 10px 24px rgba(0,0,0,.35)', display: 'inline-flex', alignItems: 'center',
          gap: 8, textDecoration: 'none',
        }}
      >💬 Suporte WhatsApp</a>

      <div className="conteudo">
        <header>
          <span className="eyebrow">💰 Tabela Price · Análise financeira · Portabilidade</span>
          <h1>Analisador de <span className="ouro">Empréstimo Consignado</span></h1>
          <p>Taxa de juros real, saldo devedor e simulação de portabilidade com coeficientes oficiais — por contrato, por banco e consolidado.</p>
        </header>

        <main>
          {/* Cabeçalho de relatório — aparece SOMENTE na impressão */}
          {currentUser && (
            <div className="print-only">
              <h1>Analisador de Empréstimo Consignado</h1>
              <p>
                Relatório gerado em {new Date().toLocaleString('pt-BR')}
                {' • '}Usuário: <b>{currentUser.nome}</b> ({currentUser.email})
                {' • '}{contratos.length} contrato(s)
              </p>
            </div>
          )}
          {currentUser && modoDebug && (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 12,
              margin: '0 0 18px',
              padding: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
                <strong style={{ color: '#0f172a' }}>🔎 Diagnóstico da sessão atual</strong>
                <button type="button" className="btn-mini" onClick={revalidarSessaoAgora}>Revalidar</button>
              </div>
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '.72rem',
                color: '#0f172a',
                background: '#fff',
                borderRadius: 8,
                padding: 8,
                border: '1px solid #e2e8f0',
                maxHeight: 180,
                overflow: 'auto',
              }}>{JSON.stringify(debugSessao && Object.keys(debugSessao).length ? debugSessao : depurarSessaoAtual(), null, 2)}</pre>
            </div>
          )}
          {!currentUser ? (
            <div className="login-wrap">
              <div className="login-card">
                <h2>🔐 Entrar</h2>
                <p className="login-sub">Acesse com seu e-mail e senha. O master pode gerenciar limites, bloqueios e permissões de todos os usuários.</p>
                {avisoSessao && (
                  <div style={{
                    background: 'linear-gradient(135deg,#fffbeb,#fef3c7)',
                    border: '1.5px solid #fbbf24',
                    color: '#92400e',
                    padding: '12px 16px',
                    borderRadius: 12,
                    marginBottom: 16,
                    fontSize: '.84rem',
                    fontWeight: 700,
                    lineHeight: 1.5,
                  }}>{avisoSessao}</div>
                )}
                <div style={{
                  background: '#f0f9ff',
                  border: '1px dashed #7dd3fc',
                  color: '#075985',
                  padding: '9px 13px',
                  borderRadius: 10,
                  marginBottom: 14,
                  fontSize: '.75rem',
                  fontWeight: 600,
                  lineHeight: 1.5,
                }}>
                  🔒 <b>Acesso controlado:</b> cada conta respeita o limite de <b>acessos simultâneos</b> definido pelo master. Se o limite for excedido, a sessão mais antiga pode ser desconectada automaticamente.
                </div>
                {modoDebug && (
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 12,
                    marginBottom: 16,
                    padding: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <strong style={{ color: '#0f172a' }}>🔎 Diagnóstico de sessão</strong>
                      <button type="button" className="btn-mini" onClick={revalidarSessaoAgora}>Revalidar</button>
                    </div>
                    <pre style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '.72rem',
                      color: '#0f172a',
                      background: '#fff',
                      borderRadius: 8,
                      padding: 8,
                      border: '1px solid #e2e8f0',
                      maxHeight: 180,
                      overflow: 'auto',
                    }}>{depurarSessaoAtualTexto()}</pre>
                  </div>
                )}
                <form onSubmit={handleLogin}>
                  <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <label>E-mail</label>
                      <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="seu@email.com" required />
                    </div>
                    <div>
                      <label>Senha</label>
                      <input type="password" value={loginSenha} onChange={(e) => setLoginSenha(e.target.value)} placeholder="••••••••" required />
                    </div>
                  </div>
                  <div className="form-actions" style={{ marginTop: 18 }}>
                    <button type="submit" className="btn-primario" disabled={entrando} style={{ width: '100%', justifyContent: 'center', opacity: entrando ? 0.7 : 1 }}>
                      {entrando ? '⏳ Entrando…' : 'Entrar'}
                    </button>
                  </div>
                  {loginErro && <div className="msg-erro">{loginErro}</div>}
                </form>
                {allUsers.length === 0 && (
                  <div style={{ marginTop: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: '.76rem', color: '#94a3b8', marginBottom: 8 }}>
                      Nenhum usuário encontrado. Clique para recriar os padrões.
                    </div>
                    <button
                      type="button"
                      className="btn-ouro btn-mini"
                      onClick={() => {
                        localStorage.removeItem('consig_app_inicializado');
                        const lista = garantirMaster();
                        setAllUsers(lista);
                      }}
                    >🔄 Recriar usuários padrão (Master + Demo)</button>
                  </div>
                )}
                <p style={{ fontSize: '.74rem', color: 'var(--cinza)', marginTop: 14, textAlign: 'center' }}>
                  {allUsers.length} usuário(s) cadastrado(s) neste navegador • dados locais
                </p>
              </div>
            </div>
          ) : (
            <>
              <div id="barraUsuario" className="no-print">
                <span className="pill">💾 {currentUser.nome} — {currentUser.email}</span>
                <span className={`pill ${currentUser.role === 'master' ? 'pill-master' : ''}`}>{currentUser.role === 'master' ? '👑 MASTER' : '👤 USUÁRIO'} {currentUser.limiteContratos > 0 ? `• limite ${currentUser.limiteContratos} contratos` : '• ilimitado'} • 👥 {currentUser.acessosSimultaneos ?? 0}</span>
                <span className="pill">🏦 {contratos.length} contrato(s)</span>
                <span className="pill" title="Sessão única: apenas 1 acesso por vez">🔒 {descreverDispositivo()}</span>
                {podeVerAdmin && (
                  <button className={`btn-neutro btn-mini ${showAdmin ? 'btn-primario' : ''}`} onClick={() => setShowAdmin(!showAdmin)}>
                    {showAdmin ? '📊 Ver análises' : `👑 Painel Master (${stats.total} usuários)`}
                  </button>
                )}
                <button className="btn-perigo btn-mini" onClick={handleLogout}>Sair</button>
              </div>

              {podeVerAdmin && showAdmin ? (
                <>
                  <section className="card admin-card" style={{ background: '#0f172a', border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: ocultarPainelStats ? 0 : 16 }}>
                      <h2 style={{ color: '#e2e8f0', margin: 0 }}>👑 Painel Master — Gestão de Usuários</h2>
                      <button type="button" className="btn-neutro btn-mini" onClick={() => setOcultarPainelStats(v => !v)}>
                        {ocultarPainelStats ? '🔽 Mostrar' : '🔼 Ocultar'}
                      </button>
                    </div>
                    {!ocultarPainelStats && currentUser.email === 'master@consig.com' && (
                      <div style={{
                        background: 'linear-gradient(135deg,#451a03,#78350f)',
                        border: '1.5px solid #fbbf24',
                        color: '#fde68a',
                        padding: '12px 16px',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: '.82rem',
                        fontWeight: 600,
                        lineHeight: 1.55,
                      }}>
                        🔐 <b>Segurança:</b> você está usando a conta master padrão. Clique em <b>✏️ Editar</b> abaixo e troque o e-mail e a senha antes de publicar o site.
                      </div>
                    )}
                    {!ocultarPainelStats && (<>
                    <div className="stat-master">
                      <div className="stat-card master"><div className="s-lbl">Total de usuários</div><div className="s-val">{stats.total}</div></div>
                      <div className="stat-card"><div className="s-lbl">Ativos</div><div className="s-val" style={{ color: '#4ade80' }}>{stats.ativos}</div></div>
                      <div className="stat-card"><div className="s-lbl">Bloqueados</div><div className="s-val" style={{ color: '#f87171' }}>{stats.bloqueados}</div></div>
                      <div className="stat-card"><div className="s-lbl">Masters</div><div className="s-val">{stats.masters}</div></div>
                      <div className="stat-card"><div className="s-lbl">Comuns</div><div className="s-val">{stats.comuns}</div></div>
                      <div className="stat-card"><div className="s-lbl">Expirados</div><div className="s-val" style={{ color: stats.expirados ? '#f87171' : undefined }}>{stats.expirados}</div></div>
                    </div>
                    <div className="admin-toolbar">
                      <input type="text" placeholder="🔍 Buscar por nome, e-mail ou role..." value={adminBusca} onChange={(e) => setAdminBusca(e.target.value)} />
                      <button className="btn-neutro btn-mini" onClick={() => { setAdminBusca(''); recarregarUsuarios(); }}>🔄 Atualizar lista</button>
                      <span style={{ fontSize: '.78rem', color: 'var(--cinza)', fontWeight: 600 }}>{usuariosFiltrados.length} de {stats.total} usuários</span>
                    </div>
                    </>)}
                  </section>

                    {/* Banco de dados na nuvem */}
                    <CloudConfig onSync={() => { recarregarUsuarios(); setTabelasVersion(v => v + 1); }} />

                    {/* Botão resetar sistema */}
                    {allUsers.length === 0 && (
                      <div className="card" style={{ background: '#0f172a', border: '1px solid #f59e0b' }}>
                        <h2 style={{ color: '#fbbf24' }}>⚠️ Nenhum usuário encontrado</h2>
                        <p style={{ fontSize: '.82rem', color: '#94a3b8', marginBottom: 12 }}>
                          Todos os usuários foram removidos. Clique abaixo para recriar o Master Admin e o Demo.
                        </p>
                        <button
                          className="btn-ouro"
                          onClick={() => {
                            localStorage.removeItem('consig_app_inicializado');
                            const lista = garantirMaster();
                            setAllUsers(lista);
                            setAdminMsg('✅ Usuários padrão recriados!');
                          }}
                        >
                          🔄 Recriar usuários padrão
                        </button>
                      </div>
                    )}

                  {/* NOVA SEÇÃO: Analisar e substituir coeficientes - FUNCIONAL */}
                  <CoeficientesManager
                    usuarioAtual={currentUser}
                    usuarios={allUsers}
                    onTabelasAtualizadas={() => setTabelasVersion(v => v + 1)}
                  />

                  <section className="card" id="formUsuario" style={{ background: '#0f172a', border: editandoId ? '2px solid #fbbf24' : '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: ocultarFormUsuario ? 0 : 16 }}>
                      <h2 style={{ color: '#e2e8f0', margin: 0 }}>{editandoId ? '✏️ Editar usuário' : '➕ Adicionar usuário'}</h2>
                      <button type="button" className="btn-neutro btn-mini" onClick={() => setOcultarFormUsuario(v => !v)}>
                        {ocultarFormUsuario ? '🔽 Mostrar' : '🔼 Ocultar'}
                      </button>
                    </div>
                    {!ocultarFormUsuario && (<>
                    {editandoId && (() => {
                      const alvo = allUsers.find((u) => u.id === editandoId);
                      return (
                        <div style={{ background: 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '.85rem', fontWeight: 700, color: '#92400e' }}>
                          <span>🖊️ Editando: <b>{alvo?.nome}</b> ({alvo?.email}) — role {alvo?.role === 'master' ? '👑 Master' : '👤 Comum'}</span>
                          <button type="button" className="btn-neutro btn-mini" onClick={cancelarEdicao}>✕ Cancelar edição</button>
                        </div>
                      );
                    })()}
                    <form onSubmit={handleSalvarUsuario}>
                      <div className="form-grid">
                        <div><label>Nome *</label><input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: João Silva" required /></div>
                        <div><label>E-mail *</label><input type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} placeholder="email@exemplo.com" required /></div>
                        <div><label>Senha {editandoId ? '(deixe em branco para manter)' : '*'}</label><input type="password" value={novoSenha} onChange={(e) => setNovoSenha(e.target.value)} placeholder="mín. 6 caracteres" required={!editandoId} /></div>
                        <div><label>Role *</label><select value={novoRole} onChange={(e) => { const r = e.target.value as Role; setNovoRole(r); setNovoPerms(permissoesPadrao(r)); }}><option value="comum">👤 Usuário Comum</option><option value="master">👑 Master</option></select></div>
                        <div>
                          <label>Limite de contratos</label>
                          <input type="text" inputMode="numeric" value={novoLimite} onChange={(e) => setNovoLimite(e.target.value.replace(/\D/g, ''))} placeholder="0 = ilimitado" />
                          <span style={{ fontSize: '.72rem', color: parseInt(novoLimite) > 0 ? '#b45309' : '#15803d', fontWeight: 700, display: 'block', marginTop: 5 }}>
                            {parseInt(novoLimite) > 0 ? `🔒 Limite: ${parseInt(novoLimite).toLocaleString('pt-BR')} contrato(s)` : '🔓 Sem limite'}
                          </span>
                        </div>
                        <div>
                          <label>Acessos simultâneos</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button type="button" className="btn-neutro btn-mini" onClick={() => setNovoAcessos(v => Math.max(0, v - 1))}>−</button>
                            <div style={{ minWidth: 42, textAlign: 'center', fontWeight: 800, color: '#e2e8f0', fontSize: '1rem' }}>{novoAcessos}</div>
                            <button type="button" className="btn-neutro btn-mini" onClick={() => setNovoAcessos(v => Math.min(10, v + 1))}>+</button>
                          </div>
                          <span style={{ fontSize: '.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginTop: 5 }}>
                            {novoAcessos === 0 ? '🔒 Sessão única (1 dispositivo por vez)' : `👥 Até ${novoAcessos} acesso(s) simultâneo(s)`}
                          </span>
                        </div>
                        <div><label>Expira em (opcional)</label><input type="date" value={novoExpiracao} onChange={(e) => setNovoExpiracao(e.target.value)} /></div>
                      </div>
                      <div style={{ marginTop: 18 }}>
                        <label style={{ marginBottom: 10 }}>Permissões</label>
                        <div className="perm-grid">
                          {([
                            ['podeAdicionarContrato', '➕ Adicionar contratos'],
                            ['podeExcluirContrato', '🗑️ Excluir contratos / limpar tudo'],
                            ['podeExportarPDF', '📄 Exportar PDF / Imprimir'],
                            ['podeUsarPortabilidade', '🔁 Usar simulador de portabilidade'],
                            ['podeDefinirTaxaRef', '🎯 Definir taxa de referência'],
                            ['podeVerGrafico', '📊 Ver gráfico de composição'],
                          ] as const).map(([k, label]) => (
                            <label key={k} className="perm-item"><input type="checkbox" checked={novoPerms[k]} onChange={(e) => setNovoPerms({ ...novoPerms, [k]: e.target.checked })} />{label}</label>
                          ))}
                        </div>
                      </div>
                      <div className="form-actions"><button type="submit" className="btn-primario">{editandoId ? '💾 Salvar alterações' : '👤 Criar usuário'}</button>{editandoId && <button type="button" className="btn-neutro" onClick={cancelarEdicao}>Cancelar</button>}</div>
                      {adminMsg && <div className={adminMsg.startsWith('⚠️') ? 'msg-erro' : 'msg-ok'}>{adminMsg}</div>}
                    </form>
                    </>)}
                  </section>

                  <section className="card admin-card" style={{ background: '#0f172a', border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: ocultarListaUsuarios ? 0 : 12 }}>
                      <h2 style={{ color: '#e2e8f0', margin: 0 }}>👥 Usuários cadastrados — {usuariosFiltrados.length} de {stats.total}</h2>
                      <button type="button" className="btn-neutro btn-mini" onClick={() => setOcultarListaUsuarios(v => !v)}>
                        {ocultarListaUsuarios ? '🔽 Mostrar' : '🔼 Ocultar'}
                      </button>
                    </div>
                    {!ocultarListaUsuarios && (<>
                    <div className="user-list">
                      {usuariosFiltrados.map((u) => {
                        const qtd = contarContratosDoUsuario(u.id);
                        const expStatus = tempoRestanteExpiracao(u.dataExpiracao);
                        const isSelf = u.id === currentUser.id;
                        const expFut = u.dataExpiracao && new Date() > new Date(u.dataExpiracao);
                        const sessoesAtivas = lerSessoesAtivas(u);
                        const maxSess = limiteSessoes(u);
                        return (
                              <div key={u.id} className={`user-item ${u.bloqueado || expFut ? 'bloqueado' : ''}`}>
                            <div className="user-main">
                              <div className={`avatar ${u.role === 'master' ? 'master' : ''}`}>{u.nome.slice(0, 2).toUpperCase()}</div>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontWeight: 800, color: '#f1f5f9', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  {u.nome}
                                  <span className={`badge ${u.role === 'master' ? 'badge-role-master' : 'badge-role-comum'}`}>{u.role === 'master' ? '👑 MASTER' : '👤 COMUM'}</span>
                                  {u.bloqueado ? <span className="badge badge-alerta">⛔ BLOQUEADO</span> : <span className="badge badge-ok">✅ ATIVO</span>}
                                  {expFut && <span className="badge badge-alerta">⌛ EXPIRADO</span>}
                                </div>
                                <div className="user-meta">📧 {u.email} • 📦 {qtd} contrato(s) {u.limiteContratos > 0 ? `(limite: ${u.limiteContratos})` : '(ilimitado)'} • 👥 simultâneos: {u.acessosSimultaneos ?? 0} • 🕒 {expStatus} • 👁️ último acesso: {u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : 'nunca'}</div>
                                <div className="user-meta">
                                  {sessoesAtivas.length > 0
                                    ? <span style={{ color: '#4ade80', fontWeight: 700 }}>🟢 {sessoesAtivas.length}/{maxSess} sessão(ões) ativa(s){sessoesAtivas[0]?.dispositivo ? ` — ${sessoesAtivas[0].dispositivo}` : ''}</span>
                                    : <span style={{ color: '#64748b' }}>⚪ Sem sessão ativa</span>}
                                </div>
                                <div className="user-meta">🔑 {[
                                  u.permissoes.podeAdicionarContrato && 'add',
                                  u.permissoes.podeExcluirContrato && 'del',
                                  u.permissoes.podeExportarPDF && 'pdf',
                                  u.permissoes.podeUsarPortabilidade && 'port',
                                  u.permissoes.podeDefinirTaxaRef && 'taxa',
                                  u.permissoes.podeVerGrafico && 'graf',
                                ].filter(Boolean).join(' • ') || 'sem permissões'}</div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                className={`btn-mini ${u.bloqueado ? 'btn-ouro' : 'btn-neutro'}`}
                                disabled={isSelf}
                                title={isSelf ? 'Você não pode bloquear a si mesmo' : (u.bloqueado ? 'Liberar acesso' : 'Bloquear e derrubar a sessão ativa')}
                                onClick={() => {
                                  if (isSelf) return;
                                  try {
                                    alternarBloqueio(u.id);
                                    recarregarUsuarios();
                                    setAdminMsg(u.bloqueado ? `🔓 ${u.nome} desbloqueado.` : `⛔ ${u.nome} bloqueado e desconectado.`);
                                  } catch (e: any) { setAdminMsg('⚠️ ' + e.message); }
                                }}
                              >{u.bloqueado ? '🔓 Desbloquear' : '⛔ Bloquear'}</button>
                              <button
                                className="btn-mini btn-neutro"
                                disabled={sessoesAtivas.length === 0}
                                title={sessoesAtivas.length > 0 ? 'Encerrar TODAS as sessões ativas deste usuário' : 'Usuário sem sessão ativa'}
                                onClick={() => {
                                  if (sessoesAtivas.length === 0) return;
                                  if (confirm(`Desconectar ${u.nome}? ${sessoesAtivas.length} sessão(ões) ativa(s) será(ão) encerrada(s).`)) {
                                    try {
                                      atualizarUsuario(u.id, { sessaoToken: '[]', sessaoDispositivo: '' });
                                      if (u.id === currentUser.id) { limparSessao(); setCurrentUser(null); setContratos([]); setShowAdmin(false); }
                                      recarregarUsuarios();
                                      setAdminMsg(`🔌 Sessões de ${u.nome} encerradas.`);
                                    } catch (e: any) { setAdminMsg('⚠️ ' + e.message); }
                                  }
                                }}
                              >🔌 Desconectar</button>
                              <button className="btn-mini btn-neutro" onClick={() => iniciarEdicao(u)}>✏️ Editar</button>
                              <button
                                className="btn-mini btn-perigo"
                                onClick={async () => {
                                  const mastersCount = allUsers.filter(u => u.role === 'master').length;
                                  const isUltimoMaster = u.role === 'master' && mastersCount <= 1;

                                  if (isUltimoMaster) {
                                    setAdminMsg('⚠️ Não é possível excluir o último master. Crie outro master antes.');
                                    return;
                                  }
                                  if (confirm(`Remover ${u.nome} (${u.email})?\n\nEssa ação remove permanentemente.`)) {
                                    try {
                                      await removerUsuario(u.id);
                                      // Se deletou a si mesmo, limpa a sessão
                                      if (u.id === currentUser?.id) {
                                        encerrarSessao();
                                        setCurrentUser(null);
                                        setContratos([]);
                                        setShowAdmin(false);
                                      }
                                      recarregarUsuarios();
                                      setAdminMsg(`🗑️ ${u.nome} removido permanentemente.`);
                                    } catch (e: any) { setAdminMsg('⚠️ ' + e.message); }
                                  }
                                }}
                              >🗑️ Excluir</button>
                            </div>
                          </div>
                        );
                       })}
                    </div>
                    </>)}
                  </section>
                </>
              ) : (
                <>
                  <section className="card no-print">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                      <h2 style={{ margin: 0 }}>➕ Adicionar contrato{slots.length > 1 ? 's' : ''}</h2>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: '.78rem', color: 'var(--cinza)', fontWeight: 600 }}>
                          {slots.length} / {MAX_SLOTS} caixa{slots.length !== 1 ? 's' : ''}
                          {currentUser.limiteContratos > 0 && <> • {contratos.length} / {currentUser.limiteContratos} contratos usados</>}
                        </span>
                        <button
                          type="button"
                          className="btn-primario btn-mini"
                          onClick={addSlot}
                          disabled={!currentUser.permissoes.podeAdicionarContrato || slots.length >= MAX_SLOTS}
                          title={slots.length >= MAX_SLOTS ? `Máximo de ${MAX_SLOTS} caixas` : 'Adicionar mais uma caixa'}
                          style={{ fontSize: '1rem', padding: '6px 14px', lineHeight: 1 }}
                        >
                          ＋
                        </button>
                      </div>
                    </div>
                    <p style={{ fontSize: '.76rem', color: 'var(--cinza)', marginTop: 0, marginBottom: 16 }}>
                      Preencha uma ou mais caixas e clique em <b>Adicionar</b>. Use o botão <b>＋</b> para abrir mais caixas (até {MAX_SLOTS}).
                    </p>
                    <form onSubmit={handleSubmit}>
                      <datalist id="bancosConhecidos">{[...new Set(contratos.map((c: Contrato) => c.banco))].map((b, i) => (<option key={i} value={b} />))}</datalist>

                      <div style={{ display: 'grid', gap: 16 }}>
                        {slots.map((slot, idx) => {
                          const ocr = getOcr(slot.key);
                          return (
                          <div key={slot.key} id={`slot-${slot.key}`} className="slot-card" style={{
                            background: 'linear-gradient(145deg, #f8fdfb, #f0fdf4)',
                            border: '1.5px solid #d1f0e0',
                            borderRadius: 14,
                            padding: '18px 20px 14px',
                            position: 'relative',
                            transition: 'all .25s ease',
                          }}>
                            {/* Slot header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                              <span style={{ fontSize: '.78rem', fontWeight: 750, color: 'var(--verde-esc)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  background: 'linear-gradient(135deg, #10b981, #059669)',
                                  color: '#fff',
                                  width: 24, height: 24,
                                  borderRadius: 8,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '.72rem',
                                  fontWeight: 800,
                                }}>{idx + 1}</span>
                                Contrato {idx + 1}
                              </span>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                {/* Botão upload imagem */}
                                <label
                                  htmlFor={`ocr-input-${slot.key}`}
                                  title="Importar dados de imagem (OCR)"
                                  style={{
                                    background: ocr.imageUrl ? '#dbeafe' : '#eff6ff',
                                    border: ocr.imageUrl ? '1px solid #93c5fd' : '1px solid #bfdbfe',
                                    borderRadius: 8,
                                    width: 28, height: 28,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '.85rem',
                                    color: '#2563eb',
                                    cursor: ocr.loading ? 'wait' : 'pointer',
                                    padding: 0,
                                    transition: 'all .18s',
                                  }}
                                >
                                  📷
                                  <input
                                    id={`ocr-input-${slot.key}`}
                                    type="file"
                                    accept="image/*,.pdf,application/pdf"
                                    style={{ display: 'none' }}
                                    disabled={ocr.loading}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleImageUpload(slot.key, file);
                                    }}
                                  />
                                </label>
                                {slots.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeSlot(slot.key)}
                                    title="Remover esta caixa"
                                    style={{
                                      background: '#fee2e2',
                                      border: '1px solid #fca5a5',
                                      borderRadius: 8,
                                      width: 28, height: 28,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '.85rem',
                                      color: '#b91c1c',
                                      cursor: 'pointer',
                                      padding: 0,
                                      fontWeight: 800,
                                      transition: 'all .18s',
                                    }}
                                  >✕</button>
                                )}
                              </div>
                            </div>

                            {/* OCR area */}
                            {((ocr.imageUrl && !ocr.isPdf) || ocr.isPdf || ocr.loading) && (
                              <div style={{
                                background: '#fff',
                                border: '1px solid #e0e7ff',
                                borderRadius: 12,
                                padding: 14,
                                marginBottom: 14,
                              }}>
                                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                  {/* Thumbnail (imagem) ou ícone (PDF) */}
                                  {ocr.imageUrl && !ocr.isPdf && (
                                    <div style={{ flex: '0 0 auto' }}>
                                      <img
                                        src={ocr.imageUrl}
                                        alt="Preview"
                                        style={{
                                          width: 100, height: 80,
                                          objectFit: 'cover',
                                          borderRadius: 8,
                                          border: '1px solid #cbd5e1',
                                        }}
                                      />
                                      <div style={{ fontSize: '.68rem', color: 'var(--cinza)', marginTop: 4, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ocr.fileName}
                                      </div>
                                    </div>
                                  )}
                                  {ocr.isPdf && (
                                    <div style={{ flex: '0 0 auto' }}>
                                      <div style={{
                                        width: 100, height: 80,
                                        borderRadius: 8,
                                        border: '1px solid #cbd5e1',
                                        background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center',
                                        gap: 4,
                                      }}>
                                        <span style={{ fontSize: '1.6rem' }}>📕</span>
                                        <span style={{ fontSize: '.68rem', fontWeight: 800, color: '#b91c1c' }}>PDF</span>
                                      </div>
                                      <div style={{ fontSize: '.68rem', color: 'var(--cinza)', marginTop: 4, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ocr.fileName}
                                      </div>
                                    </div>
                                  )}

                                  <div style={{ flex: 1, minWidth: 200 }}>
                                    {/* Loading */}
                                    {ocr.loading && (
                                      <div>
                                        <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#2563eb', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <span className="ocr-spinner">⏳</span> Processando imagem... {ocr.progress}%
                                        </div>
                                        <div style={{ background: '#e0e7ff', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                                          <div style={{ background: 'linear-gradient(90deg, #3b82f6, #2563eb)', height: '100%', width: `${ocr.progress}%`, borderRadius: 99, transition: 'width .3s ease' }} />
                                        </div>
                                      </div>
                                    )}

                                    {/* Erro */}
                                    {ocr.erro && (
                                      <div style={{ fontSize: '.82rem', color: '#b91c1c', fontWeight: 600 }}>❌ {ocr.erro}</div>
                                    )}

                                    {/* Resultados */}
                                    {ocr.dados && !ocr.loading && (
                                      <div>
                                        {(() => {
                                          const d = ocr.dados!;
                                          const found = [d.banco, d.valorLiberado, d.parcela, d.prazo, d.mesesPagos, d.valorBrutoRestante].filter(Boolean).length;
                                          return (
                                            <div style={{ fontSize: '.78rem', fontWeight: 700, color: found >= 3 ? '#065f46' : '#92400e', marginBottom: 8 }}>
                                              {found >= 3 ? '✅' : '⚠️'} Leitura concluída — {found}/6 campos — confiança {d.confianca.toFixed(0)}%
                                              {d.colunasDetectadas?.length > 0 && (
                                                <span style={{ fontWeight: 500, display: 'block', fontSize: '.68rem', marginTop: 2, color: '#4338ca' }}>
                                                  📊 Colunas: {d.colunasDetectadas.join(' • ')}
                                                </span>
                                              )}
                                              <span style={{ fontWeight: 600, display: 'block', fontSize: '.7rem', marginTop: 3, color: '#0369a1' }}>
                                                🧭 Segmento detectado: {d.segmento}
                                              </span>
                                              <span style={{ fontWeight: 500, display: 'block', fontSize: '.7rem', marginTop: 3, color: 'var(--cinza)' }}>
                                                ✏️ Revise/corrija abaixo antes de aplicar:
                                              </span>
                                            </div>
                                          );
                                        })()}
                                        {Object.keys(ocr.dados.camposGenericos || {}).length > 0 && (
                                          <details style={{ marginBottom: 8, fontSize: '.74rem' }}>
                                            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>📄 Campos encontrados no documento</summary>
                                            <div style={{ display: 'grid', gap: 3, marginTop: 5 }}>
                                              {Object.entries(ocr.dados.camposGenericos).slice(0, 16).map(([campo, valor]) => (
                                                <div key={campo}><b>{campo.replace(/_/g, ' ')}</b>: {valor}</div>
                                              ))}
                                            </div>
                                          </details>
                                        )}
                                        {/* Campos EDITÁVEIS */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                                          {([
                                            ['banco', 'Banco', 'text', 1],
                                            ['valorLiberado', 'Valor liberado', 'money', 2],
                                            ['parcela', 'Parcela', 'money', 3],
                                            ['prazo', 'Prazo (meses)', 'num', 4],
                                            ['mesesPagos', 'Parcelas pagas', 'num', 5],
                                            ['valorBrutoRestante', 'Bruto restante', 'money', 6],
                                          ] as const).map(([campo, label, tipo, n]) => {
                                            const val = (ocr.dados as any)[campo] as string;
                                            return (
                                              <div key={campo} style={{
                                                background: val ? '#ecfdf5' : '#fef2f2',
                                                border: val ? '1px solid #a7f3d0' : '1px solid #fecaca',
                                                borderRadius: 8,
                                                padding: '5px 8px',
                                              }}>
                                                <div style={{ fontSize: '.62rem', fontWeight: 800, color: val ? '#047857' : '#b91c1c', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2, display: 'flex', alignItems: 'center' }}>
                                                  <span className={`num-badge n${n}`}>{n}</span>{label}
                                                </div>
                                                <input
                                                  type="text"
                                                  value={val}
                                                  placeholder={tipo === 'money' ? 'R$ 0,00' : tipo === 'num' ? '0' : '—'}
                                                  onChange={(e) => {
                                                    let v = e.target.value;
                                                    if (tipo === 'money') v = formatarMoedaInput(v);
                                                    if (tipo === 'num') v = v.replace(/\D/g, '');
                                                    setOcr(slot.key, { dados: { ...ocr.dados!, [campo]: v } });
                                                  }}
                                                  style={{
                                                    padding: '4px 7px', fontSize: '.8rem', fontWeight: 700,
                                                    border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff',
                                                    color: val ? '#065f46' : '#b91c1c', width: '100%',
                                                  }}
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>

                                        {/* Botão ver texto bruto */}
                                        <button
                                          type="button"
                                          onClick={() => setOcr(slot.key, { mostrarTexto: !ocr.mostrarTexto })}
                                          style={{
                                            marginTop: 8,
                                            fontSize: '.72rem',
                                            color: '#4338ca',
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px 0',
                                            fontWeight: 600,
                                            textDecoration: 'underline',
                                          }}
                                        >
                                          {ocr.mostrarTexto ? '🔽 Ocultar texto extraído' : '🔍 Ver texto extraído (OCR)'}
                                        </button>
                                        {ocr.mostrarTexto && (
                                          <pre style={{
                                            marginTop: 6,
                                            fontSize: '.72rem',
                                            background: '#f1f5f9',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: 8,
                                            padding: 10,
                                            maxHeight: 160,
                                            overflow: 'auto',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                            color: '#334155',
                                            lineHeight: 1.5,
                                          }}>{ocr.dados.textoCompleto || '(vazio)'}</pre>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Multi contratos detectados */}
                                {ocr.dados && !ocr.loading && ocr.dados.multiContratos.length > 1 && (
                                  <div style={{
                                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                                    border: '1px solid #93c5fd',
                                    borderRadius: 10,
                                    padding: '10px 14px',
                                    marginTop: 10,
                                    marginBottom: 4,
                                  }}>
                                    <div style={{ fontSize: '.8rem', fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>
                                      📋 {ocr.dados.multiContratos.length} contratos detectados na imagem/PDF
                                    </div>
                                    <div style={{ display: 'grid', gap: 4, fontSize: '.74rem' }}>
                                      {ocr.dados.multiContratos.slice(0, 8).map((c, ci) => (
                                        <div key={ci} style={{
                                          background: '#fff',
                                          border: '1px solid #bfdbfe',
                                          borderRadius: 6,
                                          padding: '5px 10px',
                                          display: 'flex',
                                          gap: 10,
                                          flexWrap: 'wrap',
                                          alignItems: 'center',
                                        }}>
                                          <span style={{ fontWeight: 800, color: '#1e40af', minWidth: 18 }}>#{ci + 1}</span>
                                          {c.banco && <span><b>{c.banco}</b></span>}
                                          {c.valorLiberado && <span><b style={{ color: '#1d4ed8' }}>2</b> {c.valorLiberado}</span>}
                                          {c.parcela && <span><b style={{ color: '#7c3aed' }}>3</b> {c.parcela}</span>}
                                          {c.prazo && <span><b style={{ color: '#d97706' }}>4</b> {c.prazo}m</span>}
                                          {c.mesesPagos && <span><b style={{ color: '#dc2626' }}>5</b> {c.mesesPagos}</span>}
                                          {c.valorBrutoRestante && <span><b style={{ color: '#1e293b' }}>6</b> {c.valorBrutoRestante}</span>}
                                        </div>
                                      ))}
                                      {ocr.dados.multiContratos.length > 8 && (
                                        <div style={{ color: '#6b7280', fontStyle: 'italic' }}>... e mais {ocr.dados.multiContratos.length - 8} contrato(s)</div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-primario btn-mini"
                                      onClick={() => aplicarMultiContratos(slot.key)}
                                      style={{ gap: 5, marginTop: 8 }}
                                    >
                                      🚀 Criar {ocr.dados.multiContratos.length} caixa(s) com todas as linhas lidas
                                    </button>
                                  </div>
                                )}

                                {/* Botões: Aplicar, Nova imagem e Limpar */}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {ocr.dados && !ocr.loading && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn-primario btn-mini"
                                        onClick={() => { aplicarOcr(slot.key); }}
                                        style={{ gap: 5 }}
                                      >
                                        ✅ Aplicar {ocr.dados.multiContratos.length > 1 ? '1º contrato' : 'valores'} nos campos
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ouro btn-mini"
                                        onClick={() => { aplicarOcr(slot.key); limparImagem(slot.key); }}
                                        style={{ gap: 5 }}
                                      >
                                        ⚡ Aplicar e fechar
                                      </button>
                                    </>
                                  )}
                                  <label
                                    htmlFor={`ocr-input-retry-${slot.key}`}
                                    className="btn-neutro btn-mini"
                                    style={{ gap: 5, cursor: ocr.loading ? 'wait' : 'pointer' }}
                                  >
                                    📷 {ocr.dados ? 'Trocar imagem' : 'Tentar outra'}
                                    <input
                                      id={`ocr-input-retry-${slot.key}`}
                                      type="file"
                                      accept="image/*,.pdf,application/pdf"
                                      style={{ display: 'none' }}
                                      disabled={ocr.loading}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleImageUpload(slot.key, file);
                                      }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="btn-neutro btn-mini"
                                    onClick={() => setOcr(slot.key, { calibragemManual: !ocr.calibragemManual })}
                                    disabled={ocr.loading}
                                    style={{ gap: 5, color: ocr.calibragemManual ? '#047857' : undefined }}
                                  >
                                    🎯 {ocr.calibragemManual ? 'Ocultar calibragem' : 'Calibragem manual'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-perigo btn-mini"
                                    onClick={() => limparImagem(slot.key)}
                                    disabled={ocr.loading}
                                    style={{ gap: 5 }}
                                  >
                                    🗑️ Limpar imagem
                                  </button>
                                </div>
                                {ocr.calibragemManual && (
                                  <div style={{
                                    marginTop: 12,
                                    background: '#f8fafc',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 10,
                                    padding: 12,
                                  }}>
                                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#064e3b', marginBottom: 6 }}>
                                      🎯 Calibragem manual desta imagem
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                                      {([
                                        ['governo', '🏛️ Governo'],
                                        ['inss', '👴 INSS'],
                                        ['federal', '🏢 Federal/SIAPE'],
                                      ] as const).map(([tipo, label]) => (
                                        <label key={tipo} style={{
                                          display: 'inline-flex', alignItems: 'center', gap: 6,
                                          padding: '6px 10px', borderRadius: 8,
                                          border: `1px solid ${ocr.calibragemTipo === tipo ? '#10b981' : '#cbd5e1'}`,
                                          background: ocr.calibragemTipo === tipo ? '#ecfdf5' : '#fff',
                                          color: ocr.calibragemTipo === tipo ? '#065f46' : '#334155',
                                          fontSize: '.76rem', fontWeight: 800, cursor: 'pointer',
                                        }}>
                                          <input
                                            type="radio"
                                            checked={ocr.calibragemTipo === tipo}
                                            onChange={() => setOcr(slot.key, { calibragemTipo: tipo })}
                                            style={{ width: 'auto' }}
                                          />
                                          {label}
                                        </label>
                                      ))}
                                    </div>
                                    <div style={{ fontSize: '.72rem', color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                                      Este modelo manual substitui totalmente a leitura automática deste anexo.<br />
                                      Aceita <code>;</code>, <code>|</code>, TAB ou colunas separadas por espaços. Formato recomendado: <code>BANCO;LIBERADO;PARCELA;PRAZO;INICIO;FIM</code>. Cabeçalhos permitem mudar a ordem.<br />
                                      As parcelas pagas são calculadas do INICIO até o mês atual: <code>09/2025 → 09/2026 = 12</code>. O prazo é validado pelas datas quando INICIO e FIM existem. Valores aceitam <code>90.750,68</code>, <code>R$ 90.750,68</code> e <code>90750.68</code>.
                                    </div>
                                    <textarea
                                      value={ocr.textoCalibragem}
                                      onChange={(e) => setOcr(slot.key, { textoCalibragem: e.target.value })}
                                      placeholder={'BANCO AGIBANK SA;90.750,68;1.050,60;108;09/2026;08/2035\nQI SOCIEDADE DE CREDITO DIRETO SA;2.632,01;58,99;96;05/2026;04/2034\nBANCO INBUSA SA;17.760,66;343,42;96;05/2026;04/2034\nNUBANK;698,18;14,74;96;05/2026;04/2034\nBANCO C6 CONSIGNADO SA;3.336,50;69,23;96;03/2025;02/2033'}
                                      style={{
                                        width: '100%', minHeight: 96, resize: 'vertical',
                                        border: '1px solid #cbd5e1', borderRadius: 8,
                                        padding: 10, fontSize: '.78rem', fontFamily: 'monospace',
                                        color: '#0f172a', background: '#fff',
                                      }}
                                    />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                      <button type="button" className="btn-primario btn-mini" onClick={() => aplicarCalibragemManual(slot.key)}>
                                        ✅ Aplicar calibragem nesta imagem
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-neutro btn-mini"
                                        onClick={() => {
                                          const texto = carregarTextoModeloCalibragem(ocr.calibragemTipo);
                                          if (texto) setOcr(slot.key, { textoCalibragem: texto });
                                          else setOcr(slot.key, { erro: `Nenhum modelo salvo para ${ocr.calibragemTipo.toUpperCase()}.` });
                                        }}
                                      >
                                        📌 Carregar modelo salvo
                                      </button>
                                      <button type="button" className="btn-neutro btn-mini" onClick={() => setOcr(slot.key, { textoCalibragem: '' })}>
                                        Limpar texto
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Drop zone quando não tem anexo */}
                            {!ocr.imageUrl && !ocr.isPdf && !ocr.loading && (
                              <label
                                htmlFor={`ocr-input-drop-${slot.key}`}
                                className="ocr-dropzone"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 8,
                                  padding: '10px 14px',
                                  marginBottom: 14,
                                  border: '1.5px dashed #93c5fd',
                                  borderRadius: 10,
                                  background: '#eff6ff',
                                  color: '#2563eb',
                                  fontSize: '.8rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  transition: 'all .2s',
                                }}
                              >
                                📷 Importar imagem ou PDF do contrato
                                <input
                                  id={`ocr-input-drop-${slot.key}`}
                                  type="file"
                                  accept="image/*,.pdf,application/pdf"
                                  style={{ display: 'none' }}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleImageUpload(slot.key, file);
                                  }}
                                />
                              </label>
                            )}

                            {/* Slot fields */}
                            <div className="form-grid">
                              <div>
                                <label><span className="num-badge n1">1</span>Banco <span style={{ fontWeight: 500, textTransform: 'none', color: 'var(--cinza-cl)', letterSpacing: 0 }}>(opcional)</span></label>
                                <input type="text" placeholder="Ex.: Banco Pan" list="bancosConhecidos" value={slot.banco}
                                  onChange={(e) => updateSlot(slot.key, 'banco', e.target.value)}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                              <div>
                                <label><span className="num-badge n2">2</span>Valor liberado *</label>
                                <input type="text" placeholder="R$ 0,00" inputMode="numeric" value={slot.valorLiberado}
                                  onChange={(e) => updateSlot(slot.key, 'valorLiberado', formatarMoedaInput(e.target.value))}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                              <div>
                                <label><span className="num-badge n3">3</span>Valor da parcela *</label>
                                <input type="text" placeholder="R$ 0,00" inputMode="numeric" value={slot.parcela}
                                  onChange={(e) => updateSlot(slot.key, 'parcela', formatarMoedaInput(e.target.value))}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                              <div>
                                <label><span className="num-badge n4">4</span>Prazo total (meses) *</label>
                                <input type="number" placeholder="Ex.: 84" min={1} step={1} value={slot.prazo}
                                  onChange={(e) => updateSlot(slot.key, 'prazo', e.target.value)}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                              <div>
                                <label><span className="num-badge n5">5</span>Parcelas já pagas</label>
                                <input type="number" placeholder="Ex.: 24" min={0} step={1} value={slot.mesesPagos}
                                  onChange={(e) => updateSlot(slot.key, 'mesesPagos', e.target.value)}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                              <div>
                                <label><span className="num-badge n6">6</span>Valor bruto restante</label>
                                <input type="text" placeholder="R$ 0,00" inputMode="numeric" value={slot.valorBrutoRestante}
                                  onChange={(e) => updateSlot(slot.key, 'valorBrutoRestante', formatarMoedaInput(e.target.value))}
                                  disabled={!currentUser.permissoes.podeAdicionarContrato} />
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>

                      {/* Botão + inline para adicionar mais caixas */}
                      {slots.length < MAX_SLOTS && currentUser.permissoes.podeAdicionarContrato && (
                        <button
                          type="button"
                          onClick={addSlot}
                          style={{
                            width: '100%',
                            marginTop: 12,
                            padding: '14px 0',
                            border: '2px dashed #b6f0dc',
                            borderRadius: 14,
                            background: 'rgba(240,253,249,.6)',
                            color: 'var(--verde-med)',
                            fontSize: '.88rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            transition: 'all .22s ease',
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#ecfdf5'; (e.currentTarget as HTMLElement).style.borderColor = '#6ee7b7'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(240,253,249,.6)'; (e.currentTarget as HTMLElement).style.borderColor = '#b6f0dc'; }}
                        >
                          <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>＋</span> Adicionar mais uma caixa ({slots.length}/{MAX_SLOTS})
                        </button>
                      )}

                      <p style={{ fontSize: '.76rem', color: 'var(--cinza)', marginTop: 12 }}>Informe <b>parcelas já pagas</b> ou <b>valor bruto restante</b>. Se preencher os dois, o sistema confere se eles são compatíveis.</p>

                      <div className="form-actions">
                        <button type="submit" className="btn-primario" disabled={!currentUser.permissoes.podeAdicionarContrato}>
                          {slots.filter(s => s.valorLiberado.trim() || s.parcela.trim()).length > 1
                            ? `Adicionar ${slots.filter(s => s.valorLiberado.trim() || s.parcela.trim()).length} contratos`
                            : 'Adicionar contrato'}
                        </button>
                        <button type="button" className="btn-neutro" onClick={clearAllSlots}>Limpar tudo</button>
                        {currentUser.limiteContratos > 0 && <span style={{ fontSize: '.8rem', color: 'var(--cinza)', fontWeight: 600 }}>{contratos.length} / {currentUser.limiteContratos} usados</span>}
                      </div>
                      {erro && <div className="msg-erro">{erro}</div>}
                      {!currentUser.permissoes.podeAdicionarContrato && <div className="msg-erro">⛔ Você não tem permissão para adicionar contratos.</div>}
                    </form>
                  </section>

                  <section className="card no-print">
                    <h2>🎯 Taxa de referência (opcional)</h2>
                    <div className="ref-bar">
                      <div><label htmlFor="taxaRef">Teto de juros % a.m.</label><input type="text" id="taxaRef" placeholder="Ex.: 1,80" inputMode="decimal" value={taxaRefInput} onChange={(e) => setTaxaRefInput(e.target.value)} disabled={!currentUser.permissoes.podeDefinirTaxaRef} /></div>
                      <button className="btn-primario" onClick={aplicarTaxaRef} disabled={!currentUser.permissoes.podeDefinirTaxaRef}>Aplicar</button>
                    </div>
                    <p style={{ fontSize: '.78rem', color: 'var(--cinza)', marginTop: 8 }}>Contratos acima da referência serão sinalizados em vermelho.</p>
                  </section>

                  {contratos.length > 0 && (
                    <div className="acoes-gerais no-print">
                      <button className="btn-ouro" onClick={gerarPDF} disabled={!currentUser.permissoes.podeExportarPDF}>📄 Exportar PDF</button>
                      <button className="btn-neutro" onClick={() => window.print()} disabled={!currentUser.permissoes.podeExportarPDF}>🖨️ Imprimir</button>
                      <button className="btn-perigo" onClick={limparTudo} disabled={!currentUser.permissoes.podeExcluirContrato}>🗑️ Apagar tudo</button>
                    </div>
                  )}

                  <div id="resultados">
                    {!contratos.length ? (
                      <div className="card vazio"><div style={{ fontSize: '3rem', lineHeight: 1, marginBottom: 14 }}>📋</div><strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--verde-esc)', fontFamily: "'Sora',sans-serif" }}>Nenhum contrato cadastrado</strong>Preencha o formulário acima para começar a análise.</div>
                    ) : (
                      chaves.map((chave) => {
                        const lista = grupos[chave];
                        const r = consolidar(lista);
                        return (
                          <div key={chave} className="banco-bloco">
                            <div className="banco-header"><h2>🏦 {lista[0].banco}</h2><span>{lista.length} contrato{lista.length > 1 ? 's' : ''}</span></div>
                            <div className="banco-body">
                              <div className="resumo">
                                <h3>Consolidado — {lista[0].banco}</h3>
                                <div className="resumo-grid">
                                  <div className="resumo-item"><div className="lbl">Contratos</div><div className="val">{r.qtd}</div></div>
                                  <div className="resumo-item"><div className="lbl">Total liberado</div><div className="val">{fmtBRL(r.liberadoTotal)}</div></div>
                                  <div className="resumo-item"><div className="lbl">Parcela mensal somada</div><div className="val">{fmtBRL(r.parcelaMensal)}</div></div>
                                  <div className="resumo-item destaque"><div className="lbl">💰 Saldo devedor (quitação)</div><div className="val">{fmtBRL(r.sdTotal)}</div></div>
                                  <div className="resumo-item destaque"><div className="lbl">Taxa média ponderada</div><div className="val">{fmtPct(r.taxaMedia)} a.m.</div></div>
                                  <div className="resumo-item"><div className="lbl">Taxa média anual</div><div className="val">{fmtPct(r.taxaMediaAA, 2)} a.a.</div></div>
                                  <div className="resumo-item"><div className="lbl">Total já pago</div><div className="val">{fmtBRL(r.totalPago)}</div></div>
                                  <div className="resumo-item"><div className="lbl">Juros a vencer</div><div className="val">{fmtBRL(r.jurosAVencer)}</div></div>
                                </div>
                                {!isNaN(taxaRef) && (
                                  <div className="alerta-teto">
                                    {r.taxaMedia > taxaRef ? `⚠️ Taxa média ACIMA da referência de ${fmtPct(taxaRef, 2)} a.m. — diferença de ${fmtPct(r.taxaMedia - taxaRef)} a.m.` : `✅ Taxa média dentro da referência de ${fmtPct(taxaRef, 2)} a.m.`}
                                  </div>
                                )}
                              </div>
                              {lista.map((c, i) => {
                                const ar = analisar(c);
                                const acima = !isNaN(taxaRef) && ar.taxa > taxaRef;
                                // Arredonda erro de ponto flutuante (ex.: 80.00000000000001 → 80)
                                const fmtQtd = (v: number) => {
                                  const r = Math.round(v * 100) / 100;
                                  return Number.isInteger(r) ? String(r) : r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                };
                                return (
                                  <div key={c.id} className="contrato">
                                    <div className="contrato-topo">
                                      <strong>Contrato {i + 1} — {c.banco}</strong>
                                      <div>
                                        {!isNaN(taxaRef) && (<span className={`badge ${acima ? 'badge-alerta' : 'badge-ok'}`}>{acima ? 'ACIMA DA REFERÊNCIA' : 'DENTRO DA REFERÊNCIA'}</span>)}{' '}
                                        <button className="btn-perigo btn-mini no-print" onClick={() => removerContrato(c.id)} disabled={!currentUser.permissoes.podeExcluirContrato}>Excluir</button>
                                      </div>
                                    </div>
                                    <div className="contrato-grid">
                                      <div><div className="lbl">Liberado</div><div className="val">{fmtBRL(c.valorLiberado)}</div></div>
                                      <div><div className="lbl">Parcela</div><div className="val">{fmtBRL(c.parcela)}</div></div>
                                      <div><div className="lbl">Prazo</div><div className="val">{c.prazo} meses</div></div>
                                      <div><div className="lbl">Pagas / restantes</div><div className="val">{fmtQtd(ar.pagosUtilizados)} / {fmtQtd(ar.restantes)}</div></div>
                                      <div><div className="lbl">Critério do saldo</div><div className="val">{ar.criterioSaldo === 'valorBrutoRestante' ? 'Valor bruto restante' : 'Parcelas pagas'}</div></div>
                                      <div><div className="lbl">Bruto restante usado</div><div className="val">{fmtBRL(ar.brutoRestanteUtilizado)}</div></div>
                                      <div><div className="lbl">Taxa de juros</div><div className="val grande">{fmtPct(ar.taxa)} a.m.</div></div>
                                      <div><div className="lbl">Taxa anual</div><div className="val">{fmtPct(ar.taxaAA, 2)} a.a.</div></div>
                                      <div><div className="lbl">Saldo devedor</div><div className="val grande">{fmtBRL(ar.sd)}</div></div>
                                      <div><div className="lbl">Total já pago</div><div className="val">{fmtBRL(ar.totalPago)}</div></div>
                                      <div><div className="lbl">Total do contrato</div><div className="val">{fmtBRL(ar.totalContrato)}</div></div>
                                      <div><div className="lbl">Juros totais</div><div className="val">{fmtBRL(ar.jurosTotal)}</div></div>
                                      <div><div className="lbl">Juros a vencer</div><div className="val">{fmtBRL(ar.jurosAVencer)}</div></div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {contratos.length > 0 && (
                    <div id="resumoGeral">
                      <div className="card resumo-geral">
                        {(() => {
                          const rg = consolidar(contratos);
                          const acimaGeral = !isNaN(taxaRef) && rg.taxaMedia > taxaRef;
                          return (
                            <div className="resumo">
                              <h3>📊 RESULTADO GERAL — {chaves.length} banco(s), {rg.qtd} contrato(s)</h3>
                              <div className="resumo-grid">
                                <div className="resumo-item"><div className="lbl">Contratos</div><div className="val">{rg.qtd}</div></div>
                                <div className="resumo-item"><div className="lbl">Total liberado</div><div className="val">{fmtBRL(rg.liberadoTotal)}</div></div>
                                <div className="resumo-item"><div className="lbl">Parcela mensal somada</div><div className="val">{fmtBRL(rg.parcelaMensal)}</div></div>
                                <div className="resumo-item destaque"><div className="lbl">💰 Saldo devedor (quitação)</div><div className="val">{fmtBRL(rg.sdTotal)}</div></div>
                                <div className="resumo-item destaque"><div className="lbl">Taxa média ponderada</div><div className="val">{fmtPct(rg.taxaMedia)} a.m.</div></div>
                                <div className="resumo-item"><div className="lbl">Taxa média anual</div><div className="val">{fmtPct(rg.taxaMediaAA, 2)} a.a.</div></div>
                                <div className="resumo-item"><div className="lbl">Total já pago</div><div className="val">{fmtBRL(rg.totalPago)}</div></div>
                                <div className="resumo-item"><div className="lbl">Juros a vencer</div><div className="val">{fmtBRL(rg.jurosAVencer)}</div></div>
                              </div>
                              {!isNaN(taxaRef) && (
                                <div className="alerta-teto">
                                  {acimaGeral ? `⚠️ Taxa média ACIMA da referência de ${fmtPct(taxaRef, 2)} a.m. — diferença de ${fmtPct(rg.taxaMedia - taxaRef)} a.m.` : `✅ Taxa média dentro da referência de ${fmtPct(taxaRef, 2)} a.m.`}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {currentUser.permissoes.podeUsarPortabilidade ? (
                    <Portabilidade saldoDevedorAuto={contratos.length ? consolidar(contratos).sdTotal : 0} parcelaAuto={contratos.length ? consolidar(contratos).parcelaMensal : 0} reloadKey={tabelasVersion} />
                  ) : (
                    <div className="card"><h2>🔁 Portabilidade</h2><div className="msg-erro">⛔ Você não tem permissão para usar o simulador de portabilidade.</div></div>
                  )}

                  {currentUser.permissoes.podeVerGrafico && dadosGrafico.length > 0 && (
                    <section id="graficoImpressao" className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ocultarGrafico ? 0 : 12 }}>
                        <h2 style={{ margin: 0 }}>📊 Composição da dívida por banco</h2>
                        <button type="button" className="btn-neutro btn-mini" onClick={() => setOcultarGrafico(v => !v)}>
                          {ocultarGrafico ? '🔽 Mostrar' : '🔼 Ocultar'}
                        </button>
                      </div>
                      {!ocultarGrafico && (
                      <div style={{ maxWidth: 420, margin: '0 auto', background: '#fff', padding: 12, borderRadius: 8 }}>
                        <Pie data={{ labels: dadosGrafico.map((d) => d.nome), datasets: [{ data: dadosGrafico.map((d) => Math.round(d.sd * 100) / 100), backgroundColor: dadosGrafico.map((_, i) => CORES[i % CORES.length]), borderColor: '#fff', borderWidth: 2 }] }} options={{ plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Saldo devedor total: ' + fmtBRL(totalSd) }, tooltip: { callbacks: { label: (ctx: any) => { const pct = totalSd ? ((ctx.parsed / totalSd) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0'; return ` ${ctx.label}: ${fmtBRL(ctx.parsed)} (${pct}%)`; } } } } }} />
                      </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
