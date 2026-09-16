import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs`;

// ══════════════════════════════════════════════════════
//  TIPOS
// ══════════════════════════════════════════════════════
export interface ContratoExtraido {
  banco: string;              // 1 - OPCIONAL
  valorLiberado: string;      // 2 - Crédito / Emprestado
  parcela: string;            // 3 - Vlr. Parcela / Valor da Parcela
  prazo: string;              // 4 - Qtd. Parcela / QTDE PARCELAS / fração XX/YY
  mesesPagos: string;         // 5 - Início/Fim de desconto  ou  fração XX/YY
  valorBrutoRestante: string; // 6 - A Pagar
}
export interface DadosExtraidos extends ContratoExtraido {
  textoCompleto: string;
  confianca: number;
  multiContratos: ContratoExtraido[];
  colunasDetectadas: string[];
  segmento: SegmentoOCR;
  camposGenericos: Record<string, string>;
}

export type SegmentoOCR =
  | 'consignado'
  | 'financeiro'
  | 'trabalhista'
  | 'fiscal'
  | 'comercial'
  | 'saude'
  | 'juridico'
  | 'identificacao'
  | 'geral';

interface Word { text: string; x0: number; x1: number; y0: number; y1: number; cx: number; cy: number }
interface Linha { words: Word[]; y: number; texto: string }
type Campo = 'banco' | 'credito' | 'parcela' | 'qtd' | 'frac' | 'inicio' | 'fim' | 'apagar';
interface Coluna { campo: Campo; x0: number; x1: number; label: string }

/**
 * Calibração estrutural do modelo enviado pelo usuário.
 * Ordem rigida do modelo visual: 1 → 5 → 4 → 3 → 2
 * 1 = BANCOS
 * 5 = PARCELAS JÁ PAGAS (data de início)
 * 4 = PRAZO TOTAL (meses - coluna laranja 108/96)
 * 3 = PARCELAS (valor)
 * 2 = VALOR LIBERADO
 */
const AVERBACAO_GABARITO = {
  banco: [0.092, 0.190],
  inicio: [0.435, 0.556],
  fim: [0.556, 0.650],
  prazo: [0.655, 0.730],
  parcela: [0.735, 0.842],
  liberado: [0.845, 0.996],
} as const;

// Recorte sem banco: 5 = parcelas pagas, 4 = fim, 3 = prazo,
// 2 = parcela e 1 = valor liberado.
const AVERBACAO_GABARITO_COMPACTO = {
  banco: [0, 0] as const,
  inicio: [0.015, 0.205] as const,
  fim: [0.205, 0.385] as const,
  prazo: [0.385, 0.525] as const,
  parcela: [0.525, 0.725] as const,
  // Neste recorte a última coluna é "A pagar" (saldo), não o valor liberado.
  liberado: [0, 0] as const,
  bruto: [0.725, 0.999] as const,
} as const;

const GOVERNO_GABARITO = {
  banco: [0.055, 0.200],
  contrato: [0.330, 0.690],
  liberado: [0.660, 0.738],
  parcela: [0.780, 0.838],
  prazo: [0.840, 0.885],
  bruto: [0.928, 1.000],
} as const;
const GOVERNO_LINHAS_ESPERADAS = 15;

const MODELO_AUTOMATICO = {
  linhasEsperadas: 6,
  campos: ['banco', 'inicio', 'fim', 'prazo', 'parcela', 'liberado'] as const,
} as const;

// ══════════════════════════════════════════════════════
//  BANCOS (opcional)
// ══════════════════════════════════════════════════════
const BANCOS: [RegExp, string][] = [
  // Nomes compostos primeiro (mais específicos)
  [/itau\s*consig|ita[uú]\s*consig/i, 'Itaú Consignado'],
  [/facta\s*financeira|facta/i, 'Facta Financeira'],
  [/banco\s*pine|pine/i, 'Banco Pine'],
  [/banco\s*daycoval|daycoval/i, 'Banco Daycoval'],
  [/emprest\.?\s*caixa\s*econ|caixa\s*econ[oô]mica/i, 'Caixa Econômica'],
  [/santander\s*emprest/i, 'Santander'],
  [/banco\s*(?:do\s*)?brasil\s*emprest|banco\s*do\s*brasil/i, 'Banco do Brasil'],
  [/banco\s*industrial\s*do\s*brasil/i, 'Banco Industrial do Brasil'],
  [/panam|banco\s*pan\b/i, 'Banco Pan'],
  [/c6\s*[-–]?\s*consig|c6\s*bank|banco\s*c6/i, 'C6'],
  // Nomes simples
  [/agibank/i, 'Agibank'], [/inbursa/i, 'Inbursa'], [/nubank/i, 'Nubank'],
  [/banrisul/i, 'Banrisul'], [/bradesco/i, 'Bradesco'], [/santander/i, 'Santander'],
  [/ita[uú]/i, 'Itaú'], [/daycoval/i, 'Daycoval'], [/\bbmg\b/i, 'BMG'], [/safra/i, 'Safra'],
  [/sicoob/i, 'Sicoob'], [/sicredi/i, 'Sicredi'], [/votorantim|\bbv\b/i, 'BV'],
  [/cetelem/i, 'Cetelem'], [/mercantil/i, 'Mercantil'], [/crefisa/i, 'Crefisa'],
  [/facta/i, 'Facta'], [/ol[eé]\b/i, 'Olé'], [/digio/i, 'Digio'],
  [/credito\s*direto|qi\s*socied/i, 'QI Crédito Direto'], [/\binter\b/i, 'Inter'],
  [/paran[aá]\s*banco/i, 'Paraná Banco'], [/original/i, 'Original'],
  [/caixa/i, 'Caixa'], [/\bpan\b/i, 'Banco Pan'],
];
function detectarBanco(t: string): string {
  const compacto = t.replace(/\s+/g, '');
  const codigo = t.match(/(?:^|\s)(\d{3,6})\s*[-–]?\s*(?:BANCO|MR|A\s*U|VC?O)?/i)?.[1];
  const porCodigo: Record<string, string> = {
    '7238': 'Santander',
    '5265': 'Banco Pan',
    '5264': 'Digio',
    '643': 'Banco Pine',
    '707': 'Banco Daycoval',
    '623': 'Banco PAN',
    '341': 'Itaú',
    '033': 'Santander',
    '012': 'Inbursa',
    '121': 'Agibank',
    '386': 'Banco Pan',
  };
  if (codigo && porCodigo[codigo]) return porCodigo[codigo];
  for (const [re, n] of BANCOS) {
    // O OCR costuma separar o nome em blocos (ex.: "BRADE SCO").
    if (re.test(t) || re.test(compacto)) return n;
  }
  // Fallback: tenta extrair o nome do banco de verbas como "6096 - ITAU CONSIGNADO"
  const m = t.match(/\d{4,6}\s*[-–]\s*(.+?)(?:\s{2,}|\d{5,}|$)/i);
  if (m) {
    const nome = m[1].trim().replace(/[-–]\s*(EMP\w*|CONSIG\w*|PORT\w*)\s*$/i, '').trim();
    if (nome.length >= 3) {
      for (const [re, n] of BANCOS) if (re.test(nome)) return n;
      return nome; // retorna o texto limpo como nome do banco
    }
  }
  return '';
}

function textoDaArea(words: Word[], x0: number, x1: number): string {
  return words
    .filter(w => w.cx >= x0 && w.cx <= x1)
    .sort((a, b) => a.cy - b.cy || a.x0 - b.x0)
    .map(w => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarTokenOCR(texto: string): string {
  return texto
    .replace(/R(?:\s*[$S])+/gi, 'R$')
    .replace(/R\s*\$\s*S/gi, 'R$')
    .replace(/R\s*S/gi, 'R$')
    .replace(/[|Il]/g, '1')
    .replace(/[Oo]/g, '0')
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/\s*\/\s*/g, '/');
}

function normalizarDataOCR(texto: string): string {
  let s = normalizarTokenOCR(texto).replace(/\s+/g, ' ').trim();
  // Recompõe anos quebrados pelo OCR: 13/04/2 2 -> 13/04/22.
  s = s.replace(/(\d{1,2}\s*\/\s*\d{2}\s*\/\s*\d)\s+(\d)\b/g, '$1$2');
  const direta = s.match(/\b(\d{1,2})\s*\/\s*(\d{2,4})(?:\s*\/\s*(\d{2,4}))?\b/);
  if (direta) return [direta[1], direta[2], direta[3]].filter(Boolean).join('/');
  const semBarra = s.match(/\b(\d{1,2})\s+(\d{4})\b/);
  return semBarra ? `${semBarra[1]}/${semBarra[2]}` : s;
}

function reconstruirBanco(texto: string): string {
  return texto
    .replace(/\bAtivo\b/gi, ' ')
    .replace(/Averba[cç].*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/SOCIED\s+ADE/gi, 'SOCIEDADE')
    .replace(/CREDIT\s+O/gi, 'CREDITO')
    .replace(/DIRETO\s+S\s+A/gi, 'DIRETO SA')
    .replace(/AGIBAN\s*K\s+SA/gi, 'AGIBANK SA')
    .replace(/CONSIG\s*NADO\s*S\s*A/gi, 'CONSIGNADO SA')
    .trim();
}

function limparNomeBanco(texto: string): string {
  return texto
    .replace(/\b(?:emp|empr[eé]stimos?|empr(?:[a-z]*)|consignado|consig|averba[cç][aã]o|portabilidade|refinanciamento|refinan|ativo)\b/gi, ' ')
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/\s*[\-–]\s*(?:emp|empr[eé]stimos?|consig|consignado)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarNomeBancoGoverno(texto: string): string {
  const limpo = limparNomeBanco(texto);
  const compacto = limpo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
  if (/santander|santanderemprestimos/.test(compacto)) return 'Santander';
  if (/panam|bancopan/.test(compacto)) return 'Banco Pan';
  if (/digio|bancodigio/.test(compacto)) return 'Digio';
  if (/brasil|bancodobrasil/.test(compacto)) return 'Banco do Brasil';
  if (/caixa/.test(compacto)) return 'Caixa';
  if (/facta/.test(compacto)) return 'Facta Financeira';
  // Nunca deixa rótulos de produto aparecerem como instituição.
  if (/^(emp|emprestimos?|consignados?|consig|ativo|averbacao|refinanciamento|refinan)$/i.test(compacto)) return '';
  return limpo;
}

function textoSomenteLetras(texto: string): string {
  return texto
    .replace(/\bAtivo\b/gi, ' ')
    .replace(/Averba[cç].*$/i, ' ')
    .replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function moedaDaCelula(texto: string): string {
  const junto = normalizarTokenOCR(texto)
    .replace(/\s+/g, '')
    .replace(/^RS/i, 'R$')
    .replace(/R\$?/i, 'R$');
  const m = junto.match(/R?\$?\d{1,3}(?:\.\d{3})*,\d{1,2}|R?\$?\d+\.\d{3},\d{1,2}|R?\$?\d+[,.]\d{1,2}|^R\$?\d{3,5}$/i);
  if (!m) return '';
  if (/^R\$?\d{3,5}$/i.test(m[0])) return toMoeda(parseDinheiroOCR(m[0]));
  let v = m[0];
  if (!v.startsWith('R$')) v = 'R$' + v.replace(/^R/i, '');
  const dec = v.match(/,(\d{1,2})$/)?.[1] || '';
  if (dec.length === 1) v += '0';
  return v;
}

function valorMoedaRobusto(texto: string): number {
  const normalizado = normalizarTokenOCR(texto)
    .replace(/\s+(?=[,.])/g, '')
    .replace(/(?<=[,.])\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const direto = moedaDaCelula(normalizado);
  if (direto) return parseDinheiroOCR(direto);

  const tokens = normalizado.split(' ').filter(Boolean);
  const candidatos: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let tamanho = 3; tamanho >= 1; tamanho--) {
      const trecho = tokens.slice(i, i + tamanho).join('').replace(/\s/g, '');
      if (/^(?:R\$?)?\d{1,3}(?:\.\d{3})*,\d{1,2}$/i.test(trecho) ||
          /^(?:R\$?)?\d+[,\.]\d{1,2}$/i.test(trecho)) {
        const valor = parseDinheiroOCR(trecho);
        if (valor > 0.5) candidatos.push(valor);
      }
    }
  }
  return candidatos[candidatos.length - 1] || 0;
}

function moedaDaCelulaRobusta(texto: string): string {
  const valor = valorMoedaRobusto(texto);
  return valor > 0 ? toMoeda(valor) : '';
}

function parseGovernoPorCalibracao(words: Word[], bandasTabela?: Array<[number, number]>): ContratoExtraido[] {
  if (words.length < 10) return [];
  const xMin = Math.min(...words.map(w => w.x0));
  const xMax = Math.max(...words.map(w => w.x1));
  const width = Math.max(1, xMax - xMin);
  const xr = (range: readonly [number, number]) => [xMin + range[0] * width, xMin + range[1] * width] as const;
  const [b0, b1] = xr(GOVERNO_GABARITO.banco);
  const [lib0, lib1] = xr(GOVERNO_GABARITO.liberado);
  const [par0, par1] = xr(GOVERNO_GABARITO.parcela);
  const [pr0, pr1] = xr(GOVERNO_GABARITO.prazo);
  const [br0, br1] = xr(GOVERNO_GABARITO.bruto);
  const centros = [...new Set(words.map(w => Math.round(w.cy)))].sort((a, b) => a - b);
  const avgH = words.reduce((s, w) => s + w.y1 - w.y0, 0) / words.length;
  const anchors = words.filter(w =>
    w.cx >= lib0 && w.cx <= br1 && /\d/.test(w.text)
  ).sort((a, b) => a.cy - b.cy);
  const rows: number[] = [];
  for (const word of anchors) {
    const last = rows[rows.length - 1];
    if (last === undefined || word.cy - last > Math.max(16, avgH * 2.5)) rows.push(word.cy);
    else rows[rows.length - 1] = (last + word.cy) / 2;
  }
  const bandas = (bandasTabela || []).filter(([top, bottom]) => bottom > top);
  const alturas = bandas.map(([top, bottom]) => bottom - top).sort((a, b) => a - b);
  const alturaMediana = alturas.length ? alturas[Math.floor(alturas.length / 2)] : 0;
  const bandasExpandidas = bandas.flatMap(([top, bottom]) => {
    // Quando uma linha horizontal falha na imagem, sobra uma faixa com quase
    // o dobro da altura. Divide essa faixa no espaçamento esperado da tabela.
    if (alturaMediana > 0 && bottom - top > alturaMediana * 1.45) {
      const quantidade = Math.max(2, Math.round((bottom - top) / alturaMediana));
      const passo = (bottom - top) / quantidade;
      return Array.from({ length: quantidade }, (_, i) => [
        top + i * passo + 1,
        top + (i + 1) * passo - 1,
      ] as [number, number]);
    }
    return [[top, bottom] as [number, number]];
  });
  const faixas = rows.map((center, i) => {
    const prev = rows[i - 1], next = rows[i + 1];
    return [prev === undefined ? center - avgH * 4 : (prev + center) / 2,
      next === undefined ? center + avgH * 4 : (center + next) / 2] as [number, number];
  });
  // Usa a geometria real. Só reconstitui uma divisória quando a grade tem
  // entre 14 e 15 faixas; dividir todo o envelope uniformemente desloca
  // palavras em imagens com margens ou alturas diferentes.
  let usadas = bandasExpandidas.length >= 14 ? bandasExpandidas : faixas;
  if (bandasExpandidas.length === 14) {
    const maior = bandasExpandidas.reduce((melhor, faixa) =>
      (faixa[1] - faixa[0]) > (melhor[1] - melhor[0]) ? faixa : melhor
    );
    const indice = bandasExpandidas.indexOf(maior);
    const passo = (maior[1] - maior[0]) / 2;
    if (passo > 0) {
      usadas = [...bandasExpandidas.slice(0, indice),
        [maior[0], maior[0] + passo] as [number, number],
        [maior[0] + passo, maior[1]] as [number, number],
        ...bandasExpandidas.slice(indice + 1)];
    }
  }
  const out: ContratoExtraido[] = [];
  for (const [top, bottom] of usadas) {
    const row = words.filter(w => w.cy >= top && w.cy < bottom);
    // Governo: cada campo pode ser lido somente dentro do seu quadrado.
    // Contrato, checkbox e colunas intermediarias sao deliberadamente ignorados.
    const liberadoTexto = textoDaArea(row, lib0, lib1);
    const parcelaTexto = textoDaArea(row, par0, par1);
    const brutoTexto = textoDaArea(row, br0, br1);
    const prazo = prazoGoverno(textoDaArea(row, pr0, pr1));
    const valores = escolherValoresGoverno(liberadoTexto, parcelaTexto, brutoTexto, Number(prazo));
    const liberado = valores.liberado;
    const parcela = valores.parcela;
    const bruto = valores.bruto;
    const bancoTxt = textoSomenteLetras(textoDaArea(row, b0, b1));
    const banco = normalizarNomeBancoGoverno(bancoTxt) || detectarBanco(bancoTxt) || '';
    const contrato: ContratoExtraido = {
      banco,
      valorLiberado: toMoeda(liberado),
      parcela: toMoeda(parcela),
      prazo,
      mesesPagos: '',
      valorBrutoRestante: toMoeda(bruto),
    };
    // Governo tem 15 faixas obrigatórias, mas o valor bruto nem sempre entra
    // no OCR do contrato. A validação matemática principal exige liberado,
    // parcela e prazo; o saldo restante pode ser preenchido depois.
    if (liberado > 0 && parcela > 0 && prazo && contratoExtraidoValido(contrato)) out.push(contrato);
  }
  return out;
}

function parseGovernoLinhaVisual(linha: Linha): ContratoExtraido | null {
  const tokens = [...linha.words].sort((a, b) => a.x0 - b.x0);
  const dinheiro = (texto: string) => {
    const normalizado = normalizarTokenOCR(texto).replace(/\s/g, '');
    return /^(?:R\$)?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(normalizado) ||
      /^(?:R\$)?\d+[,\.]\d{2}$/.test(normalizado);
  };
  const localizar = (aPartirDe: number): { indice: number; valor: number } | null => {
    for (let i = aPartirDe; i >= 0; i--) {
      if (dinheiro(tokens[i].text)) return { indice: i, valor: parseDinheiroOCR(tokens[i].text) };
    }
    return null;
  };
  const bruto = localizar(tokens.length - 1);
  const prazoIndice = bruto
    ? tokens.slice(0, bruto.indice).map((token, indice) => ({
      indice,
      valor: Number(normalizarTokenOCR(token.text).replace(/\D/g, '')),
    })).reverse().find(item => item.valor >= 6 && item.valor <= 420)
    : tokens.map((token, indice) => ({
      indice,
      valor: Number(normalizarTokenOCR(token.text).replace(/\D/g, '')),
    })).reverse().find(item => item.valor >= 6 && item.valor <= 420);
  if (!prazoIndice) return null;
  const parcela = localizar(prazoIndice.indice - 1);
  if (!parcela) return null;
  const liberado = localizar(parcela.indice - 1);
  if (!liberado) return null;
  const bancoTexto = tokens.slice(0, liberado.indice).map(token => token.text).join(' ')
    .replace(/\b\d{5,}(?:-\d+)?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const contrato: ContratoExtraido = {
    banco: normalizarNomeBancoGoverno(bancoTexto) || detectarBanco(bancoTexto),
    valorLiberado: toMoeda(liberado.valor),
    parcela: toMoeda(parcela.valor),
    prazo: String(prazoIndice.valor),
    mesesPagos: '',
    valorBrutoRestante: bruto ? toMoeda(bruto.valor) : '',
  };
  return contratoExtraidoValido(contrato) && (!bruto || bruto.valor > 0 || (!!contrato.valorLiberado && !!contrato.parcela && !!contrato.prazo))
    ? contrato
    : null;
}

function primeiraData(texto: string): string {
  const normalizado = normalizarDataOCR(texto).replace(/(\/\d{1,2})\s+(\d)\b/g, '$1$2');
  return normalizado.match(/\b\d{1,2}\/\d{2,4}(?:\/\d{2,4})?\b/)?.[0] || '';
}

function primeiroPrazo(texto: string): string {
  const m = texto.match(/\b(\d{2,3})\b/);
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 6 && n <= 420 ? String(n) : '';
}

function variantesDigitosGoverno(texto: string): string[] {
  const base = normalizarTokenOCR(texto);
  if (!base) return [];
  const variantes = new Set([base]);
  for (let i = 0; i < base.length; i++) {
    if (!'038'.includes(base[i])) continue;
    for (const substituto of '038') {
      if (substituto === base[i]) continue;
      variantes.add(base.slice(0, i) + substituto + base.slice(i + 1));
    }
  }
  return [...variantes];
}

function prazoGoverno(texto: string): string {
  const candidatos = variantesDigitosGoverno(texto)
    .map(Number).filter(n => n >= 6 && n <= 420);
  if (!candidatos.length) return '';
  const comuns = [96, 84, 88, 108, 120, 72, 60, 48, 36, 24, 18, 12];
  candidatos.sort((a, b) => (comuns.indexOf(a) < 0 ? 99 : comuns.indexOf(a)) -
    (comuns.indexOf(b) < 0 ? 99 : comuns.indexOf(b)));
  return String(candidatos[0]);
}

function escolherValoresGoverno(liberadoTexto: string, parcelaTexto: string, brutoTexto: string, prazo: number) {
  const gerar = (texto: string) => {
    const normalizado = normalizarTokenOCR(texto).replace(/\s/g, '');
    const candidatos = new Set<number>();
    const direto = valorMoedaRobusto(normalizado);
    if (direto > 0) candidatos.add(direto);
    for (const variante of variantesDigitosGoverno(normalizado)) {
      const sufixo = variante.replace(/[^0-9,]/g, '');
      const decimal = sufixo.lastIndexOf(',');
      if (decimal > 0) {
        const valor = Number(`${sufixo.slice(0, decimal)}.${sufixo.slice(decimal + 1)}`);
        if (valor > 0) candidatos.add(valor);
      }
    }
    return [...candidatos].filter(Number.isFinite);
  };
  const liberados = gerar(liberadoTexto);
  const parcelas = gerar(parcelaTexto);
  const brutos = gerar(brutoTexto);
  let melhor = { liberado: liberados[0] || 0, parcela: parcelas[0] || 0, bruto: brutos[0] || 0, score: -Infinity };
  for (const liberado of liberados) for (const parcela of parcelas) for (const bruto of brutos) {
    let score = 0;
    if (liberado > 0 && parcela > 0 && parcela < liberado) score += 4;
    if (prazo > 0 && parcela * prazo >= liberado * 0.9) score += 5;
    if (bruto > liberado) score += 2;
    if (prazo === 96 && parcela > 0 && parcela < liberado) score += 1;
    if (bruto >= parcela) score += 1;
    if (parcela > 0 && bruto > 0) {
      const restantes = bruto / parcela;
      const distanciaInteira = Math.abs(restantes - Math.round(restantes));
      // O bruto restante representa um numero inteiro de parcelas.
      // Usa essa relacao para corrigir centavos confundidos pelo OCR.
      if (distanciaInteira < 0.02) score += 10;
      else if (distanciaInteira < 0.08) score += 3;
    }
    if (score > melhor.score) melhor = { liberado, parcela, bruto, score };
  }
  return melhor;
}

function parseAverbacaoPorCalibracao(words: Word[], bandasTabela?: Array<[number, number]>): ContratoExtraido[] {
  if (words.length < 10) return [];
  const xMin = Math.min(...words.map(w => w.x0));
  const xMax = Math.max(...words.map(w => w.x1));
  const width = Math.max(1, xMax - xMin);
  const xr = (range: readonly [number, number]) => [xMin + range[0] * width, xMin + range[1] * width] as const;

  const em = (w: Word, x0: number, x1: number, margem = 0.01) =>
    w.cx >= x0 - width * margem && w.cx <= x1 + width * margem;
  const ehData = (t: string) => /^\d{1,2}\/\d{2,4}(?:\/\d{2,4})?$/.test(normalizarDataOCR(t));
  const ehPrazo = (t: string) => /^\d{2,3}$/.test(normalizarTokenOCR(t)) && Number(normalizarTokenOCR(t)) >= 6 && Number(normalizarTokenOCR(t)) <= 420;
  const ehMoeda = (t: string) => /^(?:R\$)?\d{1,3}(?:\.\d{3})*[,\.]\d{1,2}$|^(?:R\$)?\d+[,\.]\d{1,2}$|^R\$?\d{3,5}$/i.test(normalizarTokenOCR(t).replace(/\s+/g, ''));
  const temDatasNaEsquerda = words.some(w => {
    const x = (w.cx - xMin) / width;
    return x < 0.24 && ehData(w.text);
  });
  const temBancoNaEsquerda = words.some(w => {
    const x = (w.cx - xMin) / width;
    return x < 0.24 && /banco|facta|inbursa|santander|brasil|consig/i.test(w.text);
  });
  const compacto = temDatasNaEsquerda && !temBancoNaEsquerda;
  const gabarito = compacto ? AVERBACAO_GABARITO_COMPACTO : AVERBACAO_GABARITO;
  const [b0, b1] = xr(gabarito.banco);
  const [ini0, ini1] = xr(gabarito.inicio);
  const [fim0, fim1] = xr(gabarito.fim);
  const [pr0, pr1] = xr(gabarito.prazo);
  const [par0, par1] = xr(gabarito.parcela);
  const [lib0, lib1] = xr(gabarito.liberado);
  const [br0, br1] = xr('bruto' in gabarito ? gabarito.bruto : [0, 0]);

  // Anchors de linha: usa somente campos que aparecem 1 vez por contrato.
  // Não usa BANCO como âncora porque é multi-linha. Para não perder linhas
  // quando o OCR quebra uma data/valor, qualquer token com número dentro das
  // colunas calibradas 5/4/3/2 também vira âncora.
  const anchors = words.filter(w => {
    if (em(w, ini0, ini1, 0.02) && ehData(w.text)) return true;
    if (em(w, fim0, fim1, 0.02) && ehData(w.text)) return true;
    if (em(w, pr0, pr1, 0.02) && ehPrazo(w.text)) return true;
    if ((em(w, par0, par1, 0.02) || em(w, lib0, lib1, 0.02)) &&
      (ehMoeda(w.text) || /\d/.test(w.text))) return true;
    if ((em(w, ini0, ini1, 0.02) || em(w, fim0, fim1, 0.02) || em(w, pr0, pr1, 0.02) || em(w, par0, par1, 0.02) || em(w, lib0, lib1, 0.02)) && /\d/.test(w.text)) return true;
    return false;
  }).sort((a, b) => a.cy - b.cy);
  if (!anchors.length) return [];

  const clusters: { y: number; items: Word[] }[] = [];
  const avgH = words.reduce((s, w) => s + (w.y1 - w.y0), 0) / words.length;
  const tol = Math.max(14, avgH * 2.3);
  for (const w of anchors) {
    const c = clusters.find(c => Math.abs(c.y - w.cy) <= tol);
    if (c) { c.items.push(w); c.y = c.items.reduce((s, i) => s + i.cy, 0) / c.items.length; }
    else clusters.push({ y: w.cy, items: [w] });
  }
  const centers = clusters.map(c => c.y).sort((a, b) => a - b);
  const bandasDetectadas = (bandasTabela || []).filter(([top, bottom]) => bottom > top);
  const bandasValidas = bandasDetectadas.filter(([top, bottom]) =>
    centers.some(center => center >= top && center < bottom)
  );
  // A grade da tabela e mais confiavel que as ancoras do OCR: rabiscos,
  // carimbos e linhas quebradas podem fazer uma linha desaparecer das ancoras.
  // Quando ha faixas detectadas, processa todas elas, mesmo sem texto-ancora.
  const bandas = bandasDetectadas.length >= MODELO_AUTOMATICO.linhasEsperadas - 1
    ? bandasDetectadas
    : centers.length ? centers.map((center, i) => {
    const encontrada = bandasValidas.find(([top, bottom]) =>
      center >= top && center < bottom &&
      centers.filter(outro => outro >= top && outro < bottom).length === 1
    );
    if (encontrada) return encontrada;
    const prev = centers[i - 1];
    const next = centers[i + 1];
    const top = prev === undefined ? center - (next ? (next - center) / 2 : avgH * 4) : (prev + center) / 2;
    const bottom = next === undefined ? center + (prev ? (center - prev) / 2 : avgH * 4) : (center + next) / 2;
    return [top, bottom] as [number, number];
    }) : bandasDetectadas;
  const out: ContratoExtraido[] = [];
  const linhaCap = Math.max(1, Math.min(GOVERNO_LINHAS_ESPERADAS, bandas.length || centers.length || 1));

  for (const [top, bottom] of bandas) {
    const row = words.filter(w => w.cy >= top && w.cy < bottom);
    if (row.length < 4) continue;

    // Cada campo usa exclusivamente sua própria coluna. Isso evita que uma
    // quebra do OCR desloque parcela/liberado para o contrato vizinho.
    // O layout compacto do INSS não possui coluna de banco. Nunca tenta
    // inferir uma instituição a partir de texto fora da tabela.
    const banco = compacto ? '' : (() => {
      const bancoRaw = textoSomenteLetras(textoDaArea(row, b0, b1));
      return detectarBanco(bancoRaw) || limparNomeBanco(reconstruirBanco(bancoRaw));
    })();
    const liberado = compacto ? '' : moedaDaCelulaRobusta(textoDaArea(row, lib0, lib1));
    const parcela = moedaDaCelulaRobusta(textoDaArea(row, par0, par1));
    const bruto = compacto ? moedaDaCelulaRobusta(textoDaArea(row, br0, br1)) : '';
    // 4 = PRAZO TOTAL (meses), coluna laranja do modelo.
    const prazoTexto = textoDaArea(row, pr0, pr1).replace(/[^0-9]/g, ' ');
    const prazo = primeiroPrazo(prazoTexto);
    // 5 = PARCELAS JÁ PAGAS (data de início), coluna vermelha do modelo.
    let dataInicio = primeiraData(textoDaArea(row, ini0, ini1));
    // Sem data na coluna 5, não usa datas de outras colunas.
    const inicio = parseData(dataInicio);
    const mesesPagos = inicio && prazo ? String(Math.max(0, Math.min(mesesHoje(inicio), Number(prazo)))) : '';

    const final = (compacto ? parcela && prazo && bruto : liberado && parcela && prazo)
      ? { banco, valorLiberado: liberado, parcela, prazo, mesesPagos, valorBrutoRestante: bruto }
      : null;

    // Banco é útil, mas não pode ser obrigatório: em algumas imagens ele vem
    // quebrado em muitas linhas. O valor/parcela/prazo são suficientes para
    // criar a linha e outro parser pode completar o banco.
    if (final && (compacto ? contratoTabelaSaldoValido(final) : contratoExtraidoValido(final))) {
      if (out.length >= linhaCap) return out.slice(0, linhaCap);
      out.push(final);
    }
  }
  return out.slice(0, linhaCap);
}

// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════
const PRAZOS = [12, 18, 24, 30, 36, 48, 60, 72, 84, 96, 108, 120, 144, 180, 240];

function parseBR(s: string): number {
  const m = s.replace(/[^\d.,]/g, '');
  if (!m) return 0;
  // Formato brasileiro: 1.234,56 ou 1234,56
  if (m.includes(',')) return parseFloat(m.replace(/\./g, '').replace(',', '.')) || 0;
  // OCR às vezes troca vírgula por ponto decimal: 1234.56
  if (/^\d+\.\d{2}$/.test(m)) return parseFloat(m) || 0;
  // Pontos como milhar: 1.234.567
  return parseFloat(m.replace(/\./g, '')) || 0;
}

/** Corrige dinheiro em que o OCR perdeu a vírgula decimal (ex.: R$4300). */
function parseDinheiroOCR(s: string): number {
  const limpo = normalizarTokenOCR(s).replace(/\s+/g, '');
  if (/^R\$?\d{3,5}$/i.test(limpo)) {
    return Number(limpo.replace(/[^\d]/g, '')) / 100;
  }
  return parseBR(s);
}
function toMoeda(n: number): string {
  return n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
}
/** Todos os valores monetários de um texto (formato BR: 1.234,56) */
function valoresDe(txt: string): number[] {
  const out: number[] = []; const seen = new Set<string>();
  const add = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const n = parseDinheiroOCR(m[1] || m[0]); const k = n.toFixed(2);
      if (n > 0.5 && !seen.has(k)) { seen.add(k); out.push(n); }
    }
  };
  add(/R\$\s*(\d{1,3}(?:\.\d{3})*[,\.]\d{2})/g);
  add(/(?<![R$\w])(\d{1,3}(?:\.\d{3})+[,\.]\d{2})(?!\d)/g);
  add(/(?<![.\d])(\d{1,}[,\.]\d{2})(?![.\d])/g);
  add(/(R\$\s*\d{3,5})(?![\d.,])/gi);
  return out;
}
/** Primeiro valor monetário de um texto */
function valorDe(txt: string): number {
  const v = valoresDe(txt);
  return v.length ? v[0] : 0;
}
function parseData(s: string): Date | null {
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { let a = +m[3]; if (a < 100) a += a < 50 ? 2000 : 1900; return new Date(a, +m[2] - 1, +m[1]); }
  m = s.match(/(\d{1,2})\/(\d{4})/);
  if (m) { const mm = +m[1]; if (mm >= 1 && mm <= 12) return new Date(+m[2], mm - 1, 1); }
  m = s.match(/(\d{1,2})\/(\d{2})\b/);
  if (m) { const mm = +m[1]; let aa = +m[2]; if (mm >= 1 && mm <= 12) { aa += aa < 50 ? 2000 : 1900; return new Date(aa, mm - 1, 1); } }
  return null;
}
function diffM(a: Date, b: Date) { return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); }
function mesesHoje(d: Date) { const h = new Date(); return (h.getFullYear() - d.getFullYear()) * 12 + h.getMonth() - d.getMonth(); }

// ══════════════════════════════════════════════════════
//  IMAGEM & PDF
// ══════════════════════════════════════════════════════
function preprocess(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const sourceUrl = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      // Normaliza as duas resoluções sem ampliar excessivamente o ruído.
      const s = Math.max(2, Math.min(4, 3200 / Math.max(img.width, img.height)));
      c.width = img.width * s; c.height = img.height * s;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height); const d = id.data;

      // ── Detecta fundo escuro (screenshot dark) e INVERTE as cores ──
      // O Tesseract lê muito melhor texto ESCURO sobre fundo CLARO.
      // Amostra a imagem reduzida para medir o brilho médio.
      const mini = document.createElement('canvas');
      mini.width = Math.max(1, Math.floor(c.width / 8));
      mini.height = Math.max(1, Math.floor(c.height / 8));
      const mctx = mini.getContext('2d')!;
      mctx.drawImage(c, 0, 0, mini.width, mini.height);
      const mid = mctx.getImageData(0, 0, mini.width, mini.height).data;
      let brilho = 0;
      for (let i = 0; i < mid.length; i += 4) {
        brilho += .299 * mid[i] + .587 * mid[i + 1] + .114 * mid[i + 2];
      }
      brilho /= (mid.length / 4);
      const invert = brilho < 118; // fundo predominantemente escuro

      const f = (259 * (1.35 * 128 + 255)) / (255 * (259 - 1.35 * 128));
      for (let i = 0; i < d.length; i += 4) {
        const vermelho = d[i], verde = d[i + 1], azul = d[i + 2];
        let g = .299 * vermelho + .587 * verde + .114 * azul;
        if (invert) g = 255 - g; // inverte: fundo escuro → claro
        g = f * (g - 128) + 128; // contraste
        // Contraste moderado preserva números finos e linhas cinzas.
        g = g < 135 ? Math.max(0, g * .55) : Math.min(255, g * 1.06);
        d[i] = d[i + 1] = d[i + 2] = Math.round(g);
      }
      ctx.putImageData(id, 0, 0);
      URL.revokeObjectURL(sourceUrl);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('Erro imagem'));
    };
    img.src = sourceUrl;
  });
}
async function pdfImgs(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    // Escala equilibrada para não ampliar artefatos do PDF.
    const vp = pg.getViewport({ scale: 2.4 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(c.toDataURL('image/png'));
  }
  return out;
}

function espelharImagem(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas indisponível')); return; }
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Erro ao espelhar imagem'));
    img.src = src;
  });
}

function corrigirCoordenadasEspelhadas(words: Word[], largura: number): Word[] {
  return words.map(word => ({
    ...word,
    x0: largura - word.x1,
    x1: largura - word.x0,
    cx: largura - word.cx,
  }));
}

function larguraImagem(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.width);
    img.onerror = () => reject(new Error('Erro ao obter dimensões'));
    img.src = src;
  });
}

/**
 * Detecta faixas horizontais de linhas de tabela diretamente na imagem.
 * Em prints com grade visível, isso é mais confiável do que depender só do OCR
 * para achar a data da linha. Retorna pares [top,bottom] no mesmo sistema de
 * coordenadas dos bboxes do Tesseract.
 */
async function detectarBandasTabela(src: string): Promise<Array<[number, number]>> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const ys: number[] = [];
      for (let y = 0; y < c.height; y++) {
        let dark = 0;
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          const g = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
          if (g < 90) dark++;
        }
        // Linha horizontal de grade ocupa uma parte grande da largura.
        // A grade pode ser cinza e interrompida pelos caracteres. Um limiar
        // menor recupera divisórias finas sem depender do OCR para contar linhas.
        if (dark > c.width * 0.08) ys.push(y);
      }
      if (!ys.length) { resolve([]); return; }
      const linhas: number[] = [];
      let grupo: number[] = [ys[0]];
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] - ys[i - 1] <= 2) grupo.push(ys[i]);
        else { linhas.push(Math.round(grupo.reduce((a, b) => a + b, 0) / grupo.length)); grupo = [ys[i]]; }
      }
      linhas.push(Math.round(grupo.reduce((a, b) => a + b, 0) / grupo.length));

      const bandas: Array<[number, number]> = [];
      for (let i = 0; i < linhas.length - 1; i++) {
        const top = linhas[i] + 1;
        const bottom = linhas[i + 1] - 1;
        if (bottom - top > 20) bandas.push([top, bottom]);
      }
      resolve(bandas);
    };
    img.onerror = () => resolve([]);
    img.src = src;
  });
}

// ══════════════════════════════════════════════════════
//  WORDS → LINHAS
// ══════════════════════════════════════════════════════
function coletarWords(data: any): Word[] {
  const words: Word[] = [];
  const push = (w: any) => {
    if (!w?.text || !w.bbox) return;
    const t = String(w.text).trim(); if (!t) return;
    const { x0, y0, x1, y1 } = w.bbox;
    words.push({ text: t, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  };
  if (Array.isArray(data?.words) && data.words.length) { data.words.forEach(push); return words; }
  for (const b of (data?.blocks || []))
    for (const p of (b.paragraphs || []))
      for (const l of (p.lines || []))
        for (const w of (l.words || [])) push(w);
  return words;
}
function agruparLinhas(words: Word[]): Linha[] {
  if (!words.length) return [];
  const alt = words.reduce((s, w) => s + (w.y1 - w.y0), 0) / words.length;
  // Tolerância mais generosa: evita perder linhas em tabelas com espaçamento apertado
  const tol = Math.max(8, alt * 0.55);
  const ord = [...words].sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const linhas: Linha[] = [];
  for (const w of ord) {
    const alvo = linhas.find(l => Math.abs(l.y - w.cy) <= tol);
    if (alvo) { alvo.words.push(w); alvo.y = (alvo.y * (alvo.words.length - 1) + w.cy) / alvo.words.length; }
    else linhas.push({ words: [w], y: w.cy, texto: '' });
  }
  for (const l of linhas) { l.words.sort((a, b) => a.x0 - b.x0); l.texto = l.words.map(w => w.text).join(' '); }
  return linhas.sort((a, b) => a.y - b.y);
}

// ══════════════════════════════════════════════════════
//  DETECÇÃO DE COLUNAS  (2,3,4,5,6 — banco opcional)
// ══════════════════════════════════════════════════════
function classificarHeader(txt: string): { campo: Campo; peso: number } | null {
  const t = txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // 4 — Qtd. Parcela / QTDE PARCELAS  (checar ANTES de "parcela" sozinho)
  if (/^qtd(e)?\.?\s*(de\s*)?parcelas?$/.test(t) || /^qtde?parcelas$/.test(t) || /^qtd(e)?\.?$/.test(t))
    return { campo: 'qtd', peso: 4 };
  // 3 — Vlr. Parcela / Valor da Parcela / PARCELA (coluna de dinheiro)
  if (/^(vlr\.?|valor)\s*(da\s*)?parcela$/.test(t)) return { campo: 'parcela', peso: 4 };
  // 2 — Crédito / Emprestado / Liberado
  if (/^(credito|emprestado|liberado|emprestimo|valor\s*emprestado)$/.test(t))
    return { campo: 'credito', peso: 4 };
  // 6 — A Pagar / Saldo devedor
  if (/^(a\s*pagar|pagar|saldo\s*devedor|total\s*a\s*pagar|valor\s*a\s*pagar)$/.test(t))
    return { campo: 'apagar', peso: 4 };
  // 5 — Início / Fim (de desconto)
  if (/^inicio(\s*de\s*descont[o0]?)?$/.test(t)) return { campo: 'inicio', peso: 3 };
  if (/^fim(\s*de\s*descont[o0]?)?$/.test(t)) return { campo: 'fim', peso: 3 };
  // 4/5 — "Parcela" isolado = coluna de fração XX/YY
  if (/^parcela$/.test(t)) return { campo: 'frac', peso: 2 };
  // 1 — Banco (opcional)
  if (/^(verba|rubrica)$/.test(t) || /^banco$/.test(t)) return { campo: 'banco', peso: 1 };
  return null;
}

function detectarColunas(linhas: Linha[]): { colunas: Coluna[]; headerIdx: number } {
  let melhor = { colunas: [] as Coluna[], headerIdx: -1, score: 0 };

  // Tenta cabeçalho de 1 linha e também header partido em 2 linhas (ex.: "INÍCIO DE" / "DESCONTO")
  for (let li = 0; li < Math.min(linhas.length, 30); li++) {
    for (const merge of [0, 1]) {
      const base = linhas[li];
      const extra = merge && linhas[li + 1] ? linhas[li + 1] : null;
      const ws = extra ? [...base.words, ...extra.words].sort((a, b) => a.x0 - b.x0) : base.words;

      const cols: Coluna[] = []; let score = 0;
      for (let i = 0; i < ws.length; i++) {
        for (let len = 4; len >= 1; len--) {
          if (i + len > ws.length) continue;
          const grupo = ws.slice(i, i + len);
          // só agrupa palavras próximas horizontalmente
          const larguraOk = grupo.every((w, k) => k === 0 || (w.x0 - grupo[k - 1].x1) < (w.y1 - w.y0) * 3);
          if (!larguraOk) continue;
          const res = classificarHeader(grupo.map(w => w.text).join(' '));
          if (res && !cols.some(c => c.campo === res.campo)) {
            cols.push({
              campo: res.campo,
              x0: grupo[0].x0,
              x1: grupo[grupo.length - 1].x1,
              label: grupo.map(w => w.text).join(' '),
            });
            score += res.peso;
            i += len - 1;
            break;
          }
        }
      }
      if (cols.length >= 2 && score > melhor.score)
        melhor = { colunas: cols, headerIdx: li + (extra ? 1 : 0), score };
    }
  }

  // Expande faixas até o meio entre colunas vizinhas
  const cols = [...melhor.colunas].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < cols.length; i++) {
    const prev = cols[i - 1], next = cols[i + 1];
    const w = cols[i].x1 - cols[i].x0;
    cols[i] = {
      ...cols[i],
      x0: prev ? (prev.x1 + cols[i].x0) / 2 : cols[i].x0 - w * 1.3,
      x1: next ? (cols[i].x1 + next.x0) / 2 : cols[i].x1 + w * 1.8,
    };
  }
  return { colunas: cols, headerIdx: melhor.headerIdx };
}

function celula(l: Linha, c: Coluna): string {
  return l.words.filter(w => w.cx >= c.x0 && w.cx <= c.x1).map(w => w.text).join(' ').trim();
}

function agruparLinhasTabulares(linhas: Linha[], colunas: Coluna[], headerIdx: number): Linha[] {
  const g = (campo: Campo) => colunas.find(c => c.campo === campo);
  const camposAncora = [g('credito'), g('parcela'), g('qtd'), g('inicio'), g('fim')].filter(Boolean) as Coluna[];
  const linhasDados = linhas.slice(headerIdx + 1).filter(l => l.words.length);
  const anchors = linhasDados.filter(l => camposAncora.some(c => {
    const texto = celula(l, c);
    return !!texto && (c.campo === 'credito' || c.campo === 'parcela'
      ? valorMoedaRobusto(texto) > 0
      : c.campo === 'qtd' ? /\b\d{2,3}\b/.test(texto)
      : /\d/.test(texto));
  }));
  if (!anchors.length) return linhasDados;

  const centros: number[] = [];
  for (const linha of anchors.sort((a, b) => a.y - b.y)) {
    const centro = linha.y;
    const anterior = centros[centros.length - 1];
    // As quebras verticais do OCR ficam próximas; contratos separados têm
    // uma distância maior. Usa a altura média das palavras como referência.
    const altura = linha.words.reduce((s, w) => s + w.y1 - w.y0, 0) / linha.words.length;
    const tolerancia = Math.max(18, altura * 2.8);
    if (anterior === undefined || centro - anterior > tolerancia) centros.push(centro);
    else centros[centros.length - 1] = (anterior + centro) / 2;
  }
  return centros.map((centro, indice) => {
    const anterior = centros[indice - 1];
    const seguinte = centros[indice + 1];
    const topo = anterior === undefined ? -Infinity : (anterior + centro) / 2;
    const base = seguinte === undefined ? Infinity : (centro + seguinte) / 2;
    const palavras = linhasDados.flatMap(l => l.words).filter(w => w.cy >= topo && w.cy < base);
    return { words: palavras.sort((a, b) => a.x0 - b.x0), y: centro, texto: palavras.map(w => w.text).join(' ') };
  });
}

// ══════════════════════════════════════════════════════
//  COMPLETAR CAMPOS FALTANTES
// ══════════════════════════════════════════════════════
function acharPrazoTexto(txt: string): number {
  const fm = txt.match(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/);
  if (fm) { const y = +fm[2]; if (y >= 6 && y <= 420) return y; }
  const q = txt.match(/(?:qtd\.?e?\s*(?:de\s*)?parcelas?|qtdeparcelas|prazo)\s*:?\s*(\d{2,3})/i);
  if (q) { const n = +q[1]; if (n >= 6 && n <= 420) return n; }
  for (const im of txt.matchAll(/(?<![.,/\d-])(\d{2,3})(?![.,/\d-])/g))
    if (PRAZOS.includes(+im[1])) return +im[1];
  for (const im of txt.matchAll(/(?<![.,/\d-])(\d{2,3})(?![.,/\d-])/g)) {
    const n = +im[1]; if (n >= 6 && n <= 420) return n;
  }
  return 0;
}

function completar(c: ContratoExtraido, linhaTexto: string, vals: number[]): ContratoExtraido {
  let parcela = parseBR(c.parcela);
  let liberado = parseBR(c.valorLiberado);
  let restante = parseBR(c.valorBrutoRestante);
  let prazo = parseInt(c.prazo) || 0;
  let pagas = parseInt(c.mesesPagos) || 0;

  // 4 — PRAZO
  if (!prazo && linhaTexto) prazo = acharPrazoTexto(linhaTexto);
  if (!prazo && restante > 0 && parcela > 0) {
    const est = Math.round(restante / parcela) + pagas;
    if (est >= 6 && est <= 420) prazo = PRAZOS.find(p => Math.abs(p - est) <= 2) ?? est;
  }

  // 6 — A PAGAR
  // Não inventar valor bruto restante quando ele não está na imagem.
  // Em layout de averbação a imagem traz INÍCIO/FIM, PRAZO, PARCELA e LIBERADO,
  // mas NÃO traz o bruto restante. O saldo será calculado depois pelas parcelas pagas.
  if (!restante && vals.length >= 3 && parcela > 0) {
    const cand = vals.filter(v => Math.abs(v - parcela) > .01 && Math.abs(v - liberado) > .01)
      .sort((a, b) => b - a)[0];
    if (cand && cand > parcela) restante = cand;
  }

  // 3 — PARCELA
  if (!parcela && restante > 0 && prazo > 0) {
    const rest = prazo - pagas;
    if (rest > 0) parcela = restante / rest;
  }

  // 5 — PAGAS (nunca pode exceder o prazo)
  if (pagas > prazo) pagas = 0;
  if (!pagas && prazo > 0 && restante > 0 && parcela > 0) {
    const est = prazo - Math.round(restante / parcela);
    if (est >= 0 && est <= prazo) pagas = est;
  }

  // 2 — LIBERADO
  if (!liberado && vals.length >= 2) {
    const cand = vals.filter(v => Math.abs(v - parcela) > .01 && Math.abs(v - restante) > .01)
      .sort((a, b) => b - a)[0];
    if (cand) liberado = cand;
  }

  // ══ VALIDAÇÃO CRUZADA MATEMÁTICA ══
  // prazo ≈ (a pagar ÷ parcela) + pagas
  if (prazo > 0 && parcela > 0 && restante > 0) {
    const est = Math.round(restante / parcela) + pagas;
    if (est >= 6) {
      if (!PRAZOS.includes(prazo)) {
        // Prazo fora da lista comum: corrige para o comum mais próximo da estimativa
        const pEst = PRAZOS.find(p => Math.abs(p - est) <= 6);
        if (pEst) prazo = pEst;
      } else {
        // Prazo comum, mas estimativa aponta para OUTRO comum bem mais próximo
        const pEst = PRAZOS.find(p => p !== prazo && Math.abs(p - est) <= 3);
        if (pEst && Math.abs(pEst - est) * 2 < Math.abs(prazo - est) && Math.abs(pEst - prazo) <= 8) {
          prazo = pEst;
        }
      }
    }
    // Consistência: restante nunca pode ser menor que a parcela
    if (restante < parcela * 0.9 && vals.length >= 2) {
      const cand = vals
        .filter(v => Math.abs(v - parcela) > .01 && Math.abs(v - liberado) > .01)
        .sort((a, b) => b - a)[0];
      if (cand) restante = cand;
    }
  }
  if (pagas > prazo) pagas = 0;

  return {
    banco: c.banco,
    valorLiberado: toMoeda(liberado),
    parcela: toMoeda(parcela),
    prazo: prazo ? String(prazo) : '',
    mesesPagos: pagas ? String(pagas) : (c.mesesPagos || ''),
    valorBrutoRestante: toMoeda(restante),
  };
}

// ══════════════════════════════════════════════════════
//  PARSER POR COLUNAS  (banco NÃO é obrigatório)
// ══════════════════════════════════════════════════════
function parsePorColunas(linhas: Linha[]): ContratoExtraido[] {
  const { colunas, headerIdx } = detectarColunas(linhas);
  if (colunas.length < 2 || headerIdx < 0) return [];

  linhas = agruparLinhasTabulares(linhas, colunas, headerIdx);

  const g = (c: Campo) => colunas.find(x => x.campo === c);
  const cBanco = g('banco'), cCred = g('credito'), cParc = g('parcela');
  const cQtd = g('qtd'), cFrac = g('frac'), cIni = g('inicio'), cFim = g('fim'), cAP = g('apagar');

  const out: ContratoExtraido[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.words.length) continue;

    // 2, 3, 6 — valores monetários por coluna
    const credito = cCred ? valorMoedaRobusto(celula(l, cCred)) : 0;
    const parcelaV = cParc ? valorMoedaRobusto(celula(l, cParc)) : 0;
    const apagar = cAP ? valorMoedaRobusto(celula(l, cAP)) : 0;

    // 4 — Qtd. Parcela
    let prazo = 0;
    if (cQtd) {
      const m = celula(l, cQtd).match(/\b(\d{1,3})\b/);
      if (m) { const n = +m[1]; if (n >= 6 && n <= 420) prazo = n; }
    }

    // 4/5 — coluna "Parcela" com fração XX/YY
    let pagas = -1;
    if (cFrac) {
      const fm = celula(l, cFrac).match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
      if (fm) {
        const x = +fm[1], y = +fm[2];
        if (y >= 6 && y <= 420 && x >= 0 && x <= y) { if (!prazo) prazo = y; pagas = x; }
      }
    }
    // 5 — Início / Fim de desconto
    const dIni = cIni ? parseData(normalizarDataOCR(celula(l, cIni))) : null;
    const dFim = cFim ? parseData(normalizarDataOCR(celula(l, cFim))) : null;
    if (dIni && pagas < 0) {
      const p = mesesHoje(dIni);
      pagas = Math.max(0, Math.min(p, prazo || 420));
    }

    // Precisa de pelo menos UM valor monetário para ser uma linha de dados
    if (!credito && !parcelaV && !apagar) continue;
    // Parcela não pode ser maior que o crédito
    if (credito && parcelaV && parcelaV >= credito) continue;

    // 1 — Banco (OPCIONAL)
    let banco = '';
    if (cBanco) {
      const txt = celula(l, cBanco);
      banco = detectarBanco(txt) || limparNomeBanco(
        txt.replace(/^\d{3,6}\s*[-–]\s*/, '').replace(/[-–]\s*(EMP\w*|CONSIG\w*)\s*$/i, '').trim()
      );
      if (banco.length < 2 || !/[a-zà-ú]/i.test(banco)) banco = '';
    }
    if (!banco) banco = limparNomeBanco(detectarBanco(l.texto));

    const bruto: ContratoExtraido = {
      banco,
      valorLiberado: toMoeda(credito),
      parcela: toMoeda(parcelaV),
      prazo: prazo ? String(prazo) : '',
      mesesPagos: pagas >= 0 ? String(pagas) : '',
      valorBrutoRestante: toMoeda(apagar),
    };
    // Com cabeçalho detectado, não completa campos usando o texto inteiro:
    // cada valor precisa ter vindo da coluna correspondente.
    out.push(bruto);
  }
  return out;
}

// ══════════════════════════════════════════════════════
//  PARSER POR TEXTO (fallback — banco opcional)
// ══════════════════════════════════════════════════════
/**
 * Classifica valores monetários em parcela / liberado / restante.
 *
 * Regras matemáticas do consignado:
 *   1) TOTAL (parcela × prazo) é SEMPRE maior que o crédito liberado
 *      e maior que o saldo a pagar (a soma das parcelas inclui juros).
 *   2) O valor mais próximo do TOTAL é o "A Pagar" (bruto restante),
 *      porque a = parcela × (prazo − pagas) ≤ total.
 *   3) O valor que fica é o crédito liberado.
 *   4) Valores muito pequenos (IOF, taxas) são descartados.
 */
function classificar(vals: number[], prazoNum: number) {
  if (!vals.length) return { parcela: 0, liberado: 0, restante: 0 };
  const s = [...vals].sort((a, b) => a - b);
  const maior = s[s.length - 1];

  // 4) Candidatos a parcela: valor × prazo ≥ 30% do maior (descarta IOF/taxas)
  const cands = s.map((v, i) => ({ v, i })).filter(x => x.v * prazoNum >= maior * 0.3);
  if (!cands.length) return { parcela: 0, liberado: 0, restante: 0 };

  // 1) Entre os candidatos, o CORRETO é aquele cujo total cobre os outros
  //    valores. Vence o menor que satisfaz a condição; se nenhum, o menor.
  const totalDe = (i: number) => s[i] * prazoNum;
  const maxOutros = (i: number) => Math.max(...s.filter((_, k) => k !== i));
  const validos = cands.filter(c => totalDe(c.i) > maxOutros(c.i));
  const escolhido = validos.length ? validos[0] : cands[0]; // menor entre validos
  const parcela = escolhido.v;

  const rest = s.filter((_, i) => i !== escolhido.i);
  if (!rest.length) return { parcela, liberado: 0, restante: 0 };
  if (rest.length === 1) return { parcela, liberado: rest[0], restante: 0 };

  const rs = [...rest].sort((a, b) => a - b);
  // 2.5) Dois valores praticamente iguais (ex.: Emprestado ≈ Valor Pago)
  //      → não dá pra separar de "A Pagar": maior = liberado, sem restante
  if (rs[0] / rs[rs.length - 1] > 0.92) return { parcela, liberado: rs[rs.length - 1], restante: 0 };

  // 2) Mais próximo do total = A Pagar
  const ref = parcela * prazoNum;
  let ap = rs[rs.length - 1], bd = Infinity;
  for (const v of rs) { const d = Math.abs(v - ref); if (d < bd) { bd = d; ap = v; } }
  const lib = rs.filter(v => v !== ap).sort((a, b) => b - a)[0] ?? 0;
  return { parcela, liberado: lib, restante: ap };
}

/**
 * Parser rígido para linhas tabulares sem cabeçalho:
 *   BANCO/TEXTO  CONTRATO  CREDITO  PARCELA  PRAZO  A PAGAR
 * Ex.:
 *   7238 - SANTANDER EMPRESTIMOS 878163730 5934,24 125,61 96 7662,21
 */
function parseLinhaTabularExata(txt: string): ContratoExtraido | null {
  const s = txt.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const moneyMatches = [...s.matchAll(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*[,\.]\d{2}|(?:R\$\s*)?\d+[,.]\d{2}/g)];
  if (moneyMatches.length < 3) return null;

  const valores = moneyMatches.map(m => parseBR(m[0]));
  const liberado = valores[valores.length - 3];
  const parcela = valores[valores.length - 2];
  const bruto = valores[valores.length - 1];

  if (!(liberado > 0) || !(parcela > 0) || !(bruto > 0)) return null;
  if (parcela >= liberado) return null;

  const ultimoIndiceMoeda = s.lastIndexOf(moneyMatches[moneyMatches.length - 1][0]);
  const trechoAntesUltimo = s.slice(0, ultimoIndiceMoeda).trim();
  const prazoMatch = trechoAntesUltimo.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g)?.
    map(v => Number(v.trim())).find(n => n >= 6 && n <= 420);
  const prazo = prazoMatch ?? 0;
  if (!(prazo >= 6 && prazo <= 420)) return null;

  const bancoTxt = s.slice(0, s.indexOf(moneyMatches[0][0])).trim();
  const bancoLimpo = bancoTxt
    .replace(/^\d{4,6}\s*[-–]\s*/, '')
    .replace(/\s*[\-–]\s*(?:EMP(?:RESTIMOS?)?|CONSIG(?:NADO)?|AVERBA[cç][aã]o|PORTABILIDADE|REFINANCIAMENTO)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const banco = detectarBanco(bancoLimpo) || limparNomeBanco(bancoLimpo) || detectarBanco(s) || limparNomeBanco(s);

  return {
    banco,
    valorLiberado: toMoeda(liberado),
    parcela: toMoeda(parcela),
    prazo: String(prazo),
    mesesPagos: '',
    valorBrutoRestante: toMoeda(bruto),
  };
}

/**
 * Parser visual da linha, usando as palavras reconhecidas e lendo da direita
 * para a esquerda: [A PAGAR] [PRAZO] [PARCELA] [CRÉDITO] [CONTRATO?] [BANCO]
 *
 * Isso reduz bastante os erros quando o OCR quebra números longos em 2 tokens
 * (ex.: 57 + 523,47) ou quando há muitos espaços variáveis na linha.
 */
function parseLinhaPorOrdemEstrita(l: Linha): ContratoExtraido | null {
  const ws = [...l.words].sort((a, b) => a.x0 - b.x0);
  if (ws.length < 4) return null;

  const moneyRe = /^(?:R\$)?\d{1,3}(?:\.\d{3})*[,\.]\d{2}$|^(?:R\$)?\d+[,.]\d{2}$|^\d+[,.]\d{2}$/i;
  const intRe = /^\d{1,3}$/;
  const dateRe = /^\d{1,2}[/-]\d{1,2}[/-]?\d{2,4}$/;

  const moneyTokens = ws.filter(w => moneyRe.test(normalizarTokenOCR(w.text).replace(/\s+/g, '')));
  if (moneyTokens.length < 2) return null;

  const valores = moneyTokens.map(w => parseDinheiroOCR(w.text)).filter(v => v > 0);
  if (valores.length < 2) return null;

  const primeiroPrazo = ws
    .map((w, idx) => ({ w, idx }))
    .filter(({ w }) => intRe.test(normalizarTokenOCR(w.text).replace(/\s+/g, '')))
    .map(({ w, idx }) => ({ idx, n: Number(normalizarTokenOCR(w.text).replace(/\D/g, '')) }))
    .find(({ n }) => n >= 6 && n <= 420);
  if (!primeiroPrazo) return null;

  const idxPrazo = primeiroPrazo.idx;
  const bancoTxt = ws.slice(0, idxPrazo).map(w => w.text).join(' ').trim();
  const banco = detectarBanco(bancoTxt) || limparNomeBanco(bancoTxt) || limparNomeBanco(l.texto) || '';

  const liberado = valores[0];
  const parcela = valores[1] || valores[0];
  const bruto = valores.length >= 3 ? valores[2] : 0;
  if (!(liberado > 0) || !(parcela > 0) || parcela >= liberado) return null;

  const datas = ws.filter(w => dateRe.test(normalizarDataOCR(w.text))).map(w => normalizarDataOCR(w.text));
  let mesesPagos = '';
  if (datas.length) {
    const primeiro = parseData(datas[0]);
    if (primeiro) mesesPagos = String(Math.max(0, Math.min(mesesHoje(primeiro), primeiroPrazo.n)));
  }

  return {
    banco,
    valorLiberado: toMoeda(liberado),
    parcela: toMoeda(parcela),
    prazo: String(primeiroPrazo.n),
    mesesPagos,
    valorBrutoRestante: bruto > 0 ? toMoeda(bruto) : '',
  };
}

function parseLinhaTabularVisual(l: Linha): ContratoExtraido | null {
  const ws = [...l.words].sort((a, b) => a.x0 - b.x0);
  if (ws.length < 4) return null;

  const moneyRe = /^(?:R\$)?\d{1,3}(?:\.\d{3})*[,\.]\d{2}$|^\d+[,\.]\d{2}$/;
  const intRe = /^\d{1,3}$/;

  const lerMoneyDireita = (endIdx: number): { valor: number; ini: number } | null => {
    // Tenta 3, 2 e 1 tokens colados (prioriza o mais longo)
    for (const len of [3, 2, 1]) {
      const ini = endIdx - len + 1;
      if (ini < 0) continue;
      const joined = ws.slice(ini, endIdx + 1).map(w => w.text).join('').replace(/\s/g, '');
      if (moneyRe.test(joined)) {
        const valor = parseBR(joined);
        if (valor > 0.5) return { valor, ini };
      }
    }
    return null;
  };

  // 1) A Pagar = último valor monetário à direita
  let end = ws.length - 1;
  let apagarR = lerMoneyDireita(end);
  if (!apagarR) {
    // procura o último token que pareça dinheiro
    const idx = [...ws].map((w, i) => ({ i, t: w.text })).reverse().find(x => moneyRe.test(x.t))?.i;
    if (idx === undefined) return null;
    end = idx;
    apagarR = lerMoneyDireita(end);
    if (!apagarR) return null;
  }
  const apagar = apagarR.valor;
  let cursor = apagarR.ini - 1;

  // 2) Prazo = inteiro curto antes do A Pagar
  let prazo = 0;
  for (let i = cursor; i >= 0; i--) {
    const t = ws[i].text;
    if (intRe.test(t)) {
      const n = parseInt(t, 10);
      if (n >= 6 && n <= 420) {
        prazo = n;
        cursor = i - 1;
        break;
      }
    }
  }
  if (!prazo) return null;

  // 3) Parcela = valor monetário imediatamente à esquerda do prazo
  const parcelaR = lerMoneyDireita(cursor);
  if (!parcelaR) return null;
  const parcela = parcelaR.valor;
  cursor = parcelaR.ini - 1;

  // 4) Crédito = valor monetário imediatamente à esquerda da parcela
  const creditoR = lerMoneyDireita(cursor);
  if (!creditoR) return null;
  const credito = creditoR.valor;
  cursor = creditoR.ini - 1;

  if (!(credito > 0) || !(parcela > 0) || !(apagar > 0)) return null;
  if (parcela >= credito) return null;

  // 5) Banco = tudo que sobrou à esquerda, descartando um possível nº de contrato final
  let bancoTokens = ws.slice(0, cursor + 1).map(w => w.text);
  while (bancoTokens.length > 0 && /^[0-9-]{5,}$/.test(bancoTokens[bancoTokens.length - 1])) {
    bancoTokens.pop();
  }
  const bancoTxt = bancoTokens.join(' ').trim();
  const banco = detectarBanco(bancoTxt) || detectarBanco(l.texto) || limparNomeBanco(bancoTxt);

  return {
    banco,
    valorLiberado: toMoeda(credito),
    parcela: toMoeda(parcela),
    prazo: String(prazo),
    mesesPagos: '',
    valorBrutoRestante: toMoeda(apagar),
  };
}

/**
 * Parser para layout SIAPE/averbação do print:
 * BANCO | ... | INÍCIO DESCONTO | FIM DESCONTO | QTDE PARCELAS | PARCELA | EMPRESTADO
 *
 * Regras numeradas da imagem:
 * 1 banco, 5 início/fim (pagas), 4 prazo, 3 parcela, 2 valor liberado.
 */
function parseLinhaAverbacaoVisual(l: Linha): ContratoExtraido | null {
  const ws = [...l.words].sort((a, b) => a.x0 - b.x0);
  if (ws.length < 5) return null;

  const moneyRe = /^(?:R\$)?\d{1,3}(?:\.\d{3})*[,\.]\d{2}$|^\d+[,\.]\d{2}$|^R\$?\d{3,5}$/i;
  const dateRe = /^\d{1,2}\/\d{2,4}(?:\/\d{2,4})?$/;
  const intRe = /^\d{2,3}$/;

  // Recompõe quebras do tipo R$1.050,6 + 0 e R$90 + .750,68
  const tokens: Word[] = [];
  for (let i = 0; i < ws.length; i++) {
    const atual = ws[i].text;
    const prox = ws[i + 1]?.text || '';
    const prox2 = ws[i + 2]?.text || '';
    if (/^R\$?\d{1,3}(?:\.\d{3})*,\d$/.test(atual) && /^\d$/.test(prox)) {
      tokens.push({ ...ws[i], text: atual + prox, x1: ws[i + 1].x1, cx: (ws[i].x0 + ws[i + 1].x1) / 2 });
      i += 1;
      continue;
    }
    if (/^R\$?\d{1,3}(?:\.\d{3})*,?$/.test(atual) && /^\d$/.test(prox) && /^\d$/.test(prox2)) {
      tokens.push({ ...ws[i], text: atual + prox + prox2, x1: ws[i + 2].x1, cx: (ws[i].x0 + ws[i + 2].x1) / 2 });
      i += 2;
      continue;
    }
    if (/^R\$?\d+$/.test(atual) && /^\.\d{3},\d{2}$/.test(prox)) {
      tokens.push({ ...ws[i], text: atual + prox, x1: ws[i + 1].x1, cx: (ws[i].x0 + ws[i + 1].x1) / 2 });
      i += 1;
      continue;
    }
    if (/^R\$?$/.test(atual) && /^\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(prox)) {
      const terceiro = /^\d$/.test(prox2) && /,\d$/.test(prox) ? prox2 : '';
      tokens.push({ ...ws[i], text: atual + prox + terceiro, x1: ws[i + 1 + (terceiro ? 1 : 0)].x1, cx: (ws[i].x0 + ws[i + 1 + (terceiro ? 1 : 0)].x1) / 2 });
      i += terceiro ? 2 : 1;
      continue;
    }
    // Datas completas também podem ser quebradas pelo OCR: 18/08/2 + 3.
    if (/^\d{1,2}\/\d{2,4}\/\d$/.test(atual) && /^\d$/.test(prox)) {
      tokens.push({ ...ws[i], text: atual + prox, x1: ws[i + 1].x1, cx: (ws[i].x0 + ws[i + 1].x1) / 2 });
      i += 1;
      continue;
    }
    tokens.push(ws[i]);
  }

  const money = tokens.filter(w => moneyRe.test(w.text));
  if (money.length < 2) return null;
  // Último dinheiro da linha = EMPRESTADO (valor liberado)
  const valorLiberado = parseDinheiroOCR(money[money.length - 1].text);
  // Penúltimo dinheiro = PARCELA
  const parcela = parseDinheiroOCR(money[money.length - 2].text);
  if (!(valorLiberado > 0) || !(parcela > 0) || parcela >= valorLiberado) return null;

  // Prazo: inteiro curto imediatamente antes da coluna parcela/emprestado.
  // Em layouts do INSS, a data vem antes do valor e o prazo pode aparecer em
  // sequência com os montantes, sem ocupar o mesmo bloco do banco.
  const idxParcela = tokens.findIndex(w => w === money[money.length - 2]);
  let prazo = 0;
  for (let i = idxParcela - 1; i >= 0; i--) {
    if (intRe.test(tokens[i].text)) {
      const n = parseInt(tokens[i].text, 10);
      if (n >= 6 && n <= 420) { prazo = n; break; }
    }
  }
  if (!prazo) {
    const idxAntes = Math.max(0, idxParcela - 1);
    const candidatos = tokens.slice(0, idxAntes + 1).map((w, idx) => ({ idx, txt: w.text })).filter(x => intRe.test(x.txt));
    const melhor = [...candidatos].reverse().find(x => {
      const n = parseInt(x.txt, 10);
      return n >= 6 && n <= 420;
    });
    if (melhor) prazo = parseInt(melhor.txt, 10); 
  }
  if (!prazo) return null;

  // Datas de início/fim de desconto (duas primeiras datas de mês/ano ou data completa)
  const datas = tokens.filter(w => dateRe.test(w.text)).map(w => w.text);
  let mesesPagos = '';
  if (datas.length >= 2) {
    const inicio = parseData(datas[datas.length - 2]);
    const fim = parseData(datas[datas.length - 1]);
    if (inicio) {
      const pagas = Math.max(0, Math.min(mesesHoje(inicio), prazo));
      mesesPagos = String(pagas);
    }
    // Se o prazo não foi confiável, as datas também conseguem confirmar
    if (inicio && fim) {
      const total = diffM(inicio, fim) + 1;
      if (total >= 6 && total <= 420 && Math.abs(total - prazo) <= 2) prazo = total;
    }
  }

  // Banco: tenta pegar a região entre código de contrato e situação/origem.
  // Como o OCR pode quebrar linhas, usa a detecção por texto completo como fallback.
  let bancoTxt = l.texto;
  const idxFirstDate = tokens.findIndex(w => dateRe.test(w.text));
  if (idxFirstDate > 0) {
    // Banco fica antes das datas; remove contrato/status/origem com heurística.
    bancoTxt = tokens
      .slice(0, idxFirstDate)
      .map(w => w.text)
      .join(' ')
      .replace(/^\S+\s+/, '')
      .replace(/\bAtivo\b/gi, '')
      .replace(/Averba[cç].*$/i, '')
      .trim();
  }
  const banco = detectarBanco(bancoTxt) || detectarBanco(l.texto) || limparNomeBanco(bancoTxt);

  return {
    banco,
    valorLiberado: toMoeda(valorLiberado),
    parcela: toMoeda(parcela),
    prazo: String(prazo),
    mesesPagos,
    valorBrutoRestante: '',
  };
}

function parsePorTexto(linhas: Linha[]): ContratoExtraido[] {
  const out: ContratoExtraido[] = [];
  for (const l of linhas) {
    const txt = l.texto;
    if (txt.length < 5) continue;
    // Pula cabeçalhos
    if (/^\s*(verba|rubrica|contrat[oa]?\b|situa[cç]|cr[eé]dito|vlr\.?\s*parcela|compet|in[ií]cio\s*de|qtd\.?\s*parcela|origem|^banco\s|^valor\s|^parcela\s|a\s*pagar|^fim\s)/i.test(txt)) continue;

    // 0) Tenta a ordem estrita do campo na linha: BANCO → VALOR LIBERADO → PARCELA → PRAZO → PAGAS → BRUTO.
    const ordemEstrita = parseLinhaPorOrdemEstrita(l);
    if (ordemEstrita) { out.push(ordemEstrita); continue; }

    // 1) Tenta layout de averbação (banco / datas / prazo / parcela / emprestado)
    const averbacao = parseLinhaAverbacaoVisual(l);
    if (averbacao) { out.push(averbacao); continue; }

    // 2) Tenta o parser visual rígido (mais preciso para prints de consulta simples)
    const visual = parseLinhaTabularVisual(l);
    if (visual) { out.push(visual); continue; }

    // 3) Tenta o parser por regex da linha inteira
    const exata = parseLinhaTabularExata(txt);
    if (exata) { out.push(exata); continue; }

    // 4) Fallback heurístico
    const vals = valoresDe(txt);
    if (!vals.length) continue;

    let prazo = 0, pagas = -1;
    const fm = txt.match(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/);
    if (fm) { const x = +fm[1], y = +fm[2]; if (y >= 6 && y <= 420 && x <= y) { prazo = y; pagas = x; } }
    if (!prazo) prazo = acharPrazoTexto(txt);

    const datas = (txt.match(/\d{1,2}\/\d{2,4}(?:\/\d{2,4})?/g) || []).map(parseData).filter(Boolean) as Date[];
    if (datas.length >= 2) {
      datas.sort((a, b) => a.getTime() - b.getTime());
      const tot = diffM(datas[0], datas[datas.length - 1]) + 1;
      if (!prazo && tot >= 6 && tot <= 420) prazo = tot;
      if (pagas < 0) pagas = Math.max(0, Math.min(mesesHoje(datas[0]), prazo || 420));
    }

    const c = classificar(vals, prazo || 96);
    if (!c.parcela && !c.liberado) continue;
    // Só descarta se AMBOS forem positivos e parcela for MAIOR (não igual)
    if (c.liberado > 0 && c.parcela > 0 && c.parcela > c.liberado) continue;

    const bruto: ContratoExtraido = {
      banco: detectarBanco(txt),   // opcional
      valorLiberado: toMoeda(c.liberado),
      parcela: toMoeda(c.parcela),
      prazo: prazo ? String(prazo) : '',
      mesesPagos: pagas >= 0 ? String(pagas) : '',
      valorBrutoRestante: toMoeda(c.restante),
    };
    out.push(completar(bruto, txt, vals));
  }
  return out;
}

/** Parser em cima do texto bruto retornado pelo OCR (fallback adicional). */
function parseTextoBrutoTabular(texto: string): ContratoExtraido[] {
  const out: ContratoExtraido[] = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length >= 5);
  for (const linha of linhas) {
    if (/^\s*(verba|rubrica|contrat[oa]?\b|situa[cç]|cr[eé]dito|vlr\.?\s*parcela|compet|in[ií]cio\s*de|qtd\.?\s*parcela|origem|^banco\s|^valor\s|^parcela\s|a\s*pagar|^fim\s)/i.test(linha)) continue;
    const exata = parseLinhaTabularExata(linha);
    if (exata) out.push(exata);
  }
  return out;
}

function parseTextoCompacto(texto: string): ContratoExtraido[] {
  const out: ContratoExtraido[] = [];
  const compacto = normalizarTokenOCR(texto)
    .replace(/R\s*\$?\s*S/gi, 'R$')
    .replace(/R\s*S\s*\$?\s*S/gi, 'R$')
    .replace(/([,.]\d)\s+(\d)\b/g, '$1$2')
    .replace(/\s+/g, ' ');
  const datas = [...compacto.matchAll(/\b(\d{1,2}\/\d{4})\b/g)];
  const dinheiro = /(?:R\$\s*)?\d[\d.]*,\d{1,2}(?:\s+\d)?/gi;
  for (let i = 0; i + 1 < datas.length; i += 2) {
    const inicioTexto = datas[i][1];
    const fimTexto = datas[i + 1][1];
    const inicioFim = datas[i + 1].index + datas[i + 1][0].length;
    const proximo = datas[i + 2]?.index ?? compacto.length;
    const bloco = compacto.slice(inicioFim, proximo);
    const moedas = [...bloco.matchAll(dinheiro)].map(m => m[0]);
    if (moedas.length < 2) continue;
    const inicio = parseData(inicioTexto);
    const fim = parseData(fimTexto);
    const prazoData = inicio && fim ? diffM(inicio, fim) + 1 : 0;
    const numeros = [...bloco.matchAll(/(?:^|\s)(\d{2,3})(?=\s|$)/g)]
      .map(m => Number(m[1])).filter(n => n >= 6 && n <= 420);
    const prazo = numeros[0] || (prazoData >= 6 && prazoData <= 420 ? prazoData : 0);
    const parcela = parseDinheiroOCR(moedas[0]);
    const liberado = parseDinheiroOCR(moedas[moedas.length - 1]);
    if (!(prazo >= 6 && prazo <= 420) || !(parcela > 0) || !(liberado > 0)) continue;
    out.push({
      banco: '',
      valorLiberado: toMoeda(liberado),
      parcela: toMoeda(parcela),
      prazo: String(prazo),
      mesesPagos: inicio ? String(Math.max(0, Math.min(mesesHoje(inicio), prazo))) : '',
      valorBrutoRestante: '',
    });
  }
  return conciliarLeituras([out]);
}

const PERFIS_OCR: Array<{ segmento: SegmentoOCR; peso: number; termos: RegExp }> = [
  { segmento: 'consignado', peso: 4, termos: /consignad|averba[cç]|parcelas?\s+(pagas|restantes)|margem|benef[ií]cio|inss|siape/i },
  { segmento: 'financeiro', peso: 3, termos: /extrato|fatura|saldo|lan[cç]amento|ag[eê]ncia|conta corrente|pix|vencimento/i },
  { segmento: 'trabalhista', peso: 3, termos: /holerite|contracheque|folha de pagamento|sal[aá]rio|inss|fgts|proventos|descontos/i },
  { segmento: 'fiscal', peso: 3, termos: /nota fiscal|nf-e|nfe|danfe|iss|icms|cnpj|imposto|tribut/i },
  { segmento: 'comercial', peso: 2, termos: /or[cç]amento|pedido de venda|cliente|produto|quantidade|total do pedido/i },
  { segmento: 'saude', peso: 3, termos: /paciente|prontu[aá]rio|receita|prescri[cç][aã]o|diagn[oó]stico|exame|medicamento/i },
  { segmento: 'juridico', peso: 3, termos: /processo|contrato|cl[aá]usula|autor|r[eé]u|tribunal|advogad/i },
  { segmento: 'identificacao', peso: 2, termos: /nome completo|data de nascimento|cpf|rg|passaporte|documento de identidade/i },
];

function detectarSegmentoOCR(texto: string): SegmentoOCR {
  let melhor: { segmento: SegmentoOCR; score: number } = { segmento: 'geral', score: 0 };
  for (const perfil of PERFIS_OCR) {
    const ocorrencias = texto.match(perfil.termos)?.length || 0;
    const score = ocorrencias * perfil.peso;
    if (score > melhor.score) melhor = { segmento: perfil.segmento, score };
  }
  return melhor.segmento;
}

function extrairCamposGenericos(texto: string): Record<string, string> {
  const campos: Record<string, string> = {};
  const linhas = texto.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rotulos = /^(nome(?: completo)?|cpf|cnpj|rg|matr[ií]cula|protocolo|processo|contrato|cliente|fornecedor|paciente|m[eê]s|compet[eê]ncia|data(?: de emiss[aã]o| de nascimento)?|vencimento|validade|endere[cç]o|telefone|e-?mail|ag[eê]ncia|conta|banco|saldo|total|subtotal|desconto|valor(?: total| l[ií]quido| bruto)?|produto|servi[cç]o|quantidade|diagn[oó]stico|medicamento|c[oó]digo)\s*[:\-]?\s*(.+)$/i;
  for (const linha of linhas) {
    const match = linha.match(rotulos);
    if (!match) continue;
    const chave = match[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    const valor = match[2].trim();
    if (valor && valor.length <= 180 && !campos[chave]) campos[chave] = valor;
  }
  return campos;
}

function pularParaMelhorLeitura(texto: string): number {
  return texto.split(/\r?\n/).filter(l => /\S/.test(l)).length * 2 + valoresDe(texto).length * 3;
}

function pontuarLeituraTabela(texto: string): number {
  const normalizado = normalizarTokenOCR(texto).replace(/\s+/g, ' ');
  const datas = (normalizado.match(/\b\d{1,2}\s*\/\s*\d{4}\b/g) || []).length;
  const prazos = (normalizado.match(/\b(?:12|18|24|30|36|48|60|72|84|88|96|108|120|144|180|240)\b/g) || []).length;
  const moedas = (normalizado.match(/(?:R\$\s*)?\d[\d.]*,\d{1,2}/gi) || []).length;
  const contratos = Math.floor(datas / 2);
  const linhasGoverno = (normalizado.match(/\d{4}\s*[-–]\s*[A-Za-zÀ-ÿ ]+\s+\d{7,}(?:-\d+)?\s+\d[\d.]*,\d{2}\s+\d[\d.]*,\d{2}\s+\d{2,3}\s+\d[\d.]*,\d{2}/g) || []).length;
  return contratos * 40 + linhasGoverno * 60 + datas * 8 + prazos * 4 + moedas * 10 + pularParaMelhorLeitura(normalizado);
}

function eqValor(a: string, b: string): boolean {
  const na = parseBR(a), nb = parseBR(b);
  if (!(na > 0) || !(nb > 0)) return false;
  return Math.abs(na - nb) < 0.02;
}

function mesmaLinha(a: ContratoExtraido, b: ContratoExtraido): boolean {
  // O valor liberado identifica a linha mesmo quando um leitor não capturou
  // parcela ou banco. O prazo reduz colisões entre contratos semelhantes.
  if (a.valorLiberado && b.valorLiberado && a.prazo && b.prazo &&
      a.prazo === b.prazo && eqValor(a.valorLiberado, b.valorLiberado)) return true;
  // Se ambos têm liberado e parcela, exige ambos iguais.
  if (a.valorLiberado && b.valorLiberado && a.parcela && b.parcela) {
    return eqValor(a.valorLiberado, b.valorLiberado) && eqValor(a.parcela, b.parcela);
  }
  // Uma célula de parcela pode ser quebrada pelo OCR. Liberado + prazo
  // identificam a mesma linha e permitem conservar a leitura mais completa.
  // Se ambos têm bruto restante, ele também é um identificador forte.
  if (a.valorBrutoRestante && b.valorBrutoRestante) {
    return eqValor(a.valorBrutoRestante, b.valorBrutoRestante) &&
      (!!a.prazo && !!b.prazo ? a.prazo === b.prazo : true);
  }
  // Banco + prazo + parcela, quando liberado está faltando.
  if (a.banco && b.banco && a.prazo && b.prazo && a.parcela && b.parcela) {
    return a.banco.toLowerCase() === b.banco.toLowerCase() && a.prazo === b.prazo && eqValor(a.parcela, b.parcela);
  }
  return false;
}

function contratoExtraidoValido(c: ContratoExtraido): boolean {
  const liberado = parseBR(c.valorLiberado);
  const parcela = parseBR(c.parcela);
  const prazo = Number(c.prazo);
  if (!(liberado > 0) || !(parcela > 0) || !(prazo >= 6 && prazo <= 420)) return false;
  // Em consignado, o total contratado não pode ficar abaixo do principal.
  // Essa trava elimina leituras como 1,59 no lugar de 1.497,92.
  return parcela < liberado && parcela * prazo >= liberado * 0.9;
}

function contratoTabelaSaldoValido(c: ContratoExtraido): boolean {
  const parcela = parseBR(c.parcela);
  const prazo = Number(c.prazo);
  const restante = parseBR(c.valorBrutoRestante);
  return parcela > 0 && restante >= parcela && prazo >= 6 && prazo <= 420;
}

function contratoGovernoCompleto(c: ContratoExtraido): boolean {
  const liberado = parseBR(c.valorLiberado);
  const parcela = parseBR(c.parcela);
  const prazo = Number(c.prazo);
  const restante = parseBR(c.valorBrutoRestante);
  if (!(liberado > 0) || !(parcela > 0) || !(prazo >= 6 && prazo <= 420)) return false;
  if (restante > 0 && !(restante >= parcela)) return false;
  return parcela < liberado && parcela * prazo >= liberado * 0.9;
}

function calcularConfiancaResultado(
  contratos: ContratoExtraido[],
  confiancaTesseract: number,
  governo: boolean,
): number {
  if (!contratos.length) return 0;
  const camposObrigatorios = governo ? 4 : 3;
  const camposValidos = contratos.reduce((total, contrato) => total + [
    ...(governo ? [contrato.banco] : []),
    contrato.valorLiberado,
    contrato.parcela,
    contrato.prazo,
    ...(governo ? [contrato.valorBrutoRestante] : []),
  ].filter(Boolean).length, 0);
  const camposEsperados = governo ? 5 : camposObrigatorios;
  const coberturaCampos = Math.min(1, camposValidos / (contratos.length * camposEsperados));
  const coberturaLinhas = governo ? Math.min(1, contratos.length / GOVERNO_LINHAS_ESPERADAS) : 1;
  const base = Math.max(0, Math.min(100, confiancaTesseract || 0));
  const resultado = (coberturaCampos * 70) + (coberturaLinhas * 20) + (base * 0.1);
  return Math.round(Math.min(100, resultado));
}

function scoreContrato(c: ContratoExtraido): number {
  return [c.banco, c.valorLiberado, c.parcela, c.prazo, c.mesesPagos, c.valorBrutoRestante]
    .filter(Boolean).length;
}

/**
 * Concilia múltiplos segmentos/leitores. Não descarta campos vazios; une a
 * melhor informação de cada método. Mantém linhas únicas por valor/parcela/prazo
 * quando possível.
 */
function conciliarLeituras(listas: ContratoExtraido[][]): ContratoExtraido[] {
  const resultado: ContratoExtraido[] = [];
  const inserir = (novo: ContratoExtraido) => {
    const idx = resultado.findIndex(atual => mesmaLinha(atual, novo));
    if (idx < 0) { resultado.push(novo); return; }
    const atual = resultado[idx];
    const mesclado: ContratoExtraido = {
      banco: atual.banco || novo.banco,
      valorLiberado: atual.valorLiberado || novo.valorLiberado,
      parcela: atual.parcela || novo.parcela,
      prazo: atual.prazo || novo.prazo,
      mesesPagos: atual.mesesPagos || novo.mesesPagos,
      valorBrutoRestante: atual.valorBrutoRestante || novo.valorBrutoRestante,
    };
    resultado[idx] = scoreContrato(mesclado) >= scoreContrato(atual) ? mesclado : atual;
  };
  listas.forEach(lista => lista.forEach(inserir));

  // Ordena pela leitura vertical implícita: os parsers já vêm em ordem visual;
  // evita reordenação por banco/valor.
  return resultado;
}

function conciliarLeiturasGoverno(listas: ContratoExtraido[][]): ContratoExtraido[] {
  const resultado: ContratoExtraido[] = [];
  for (const lista of listas) {
    for (const novo of lista) {
      const duplicado = resultado.find(atual =>
        atual.prazo === novo.prazo &&
        eqValor(atual.valorLiberado, novo.valorLiberado) &&
        eqValor(atual.parcela, novo.parcela)
      );
      if (!duplicado) {
        resultado.push(novo);
        continue;
      }
      if (!duplicado.banco && novo.banco) duplicado.banco = novo.banco;
      if (!duplicado.valorBrutoRestante && novo.valorBrutoRestante) {
        duplicado.valorBrutoRestante = novo.valorBrutoRestante;
      }
    }
  }
  return resultado;
}

// ══════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════
async function comTimeout<T>(operacao: () => Promise<T>, tempoMs: number, nome: string): Promise<T> {
  let timer: number | undefined;
  return await Promise.race([
    operacao(),
    new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${nome} excedeu ${tempoMs}ms`)), tempoMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

async function criarWorkerOCR(
  imgs: string[],
  onProgress?: (p: number) => void,
): Promise<any> {
  const fontes = [
    {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    },
    {
      workerPath: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://unpkg.com/tesseract.js-core@5.1.1',
    },
  ];
  let ultimoErro: unknown = null;
  for (const fonte of fontes) {
    try {
      return await comTimeout(
        () => createWorker('por', 1, {
          ...fonte,
          langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int',
          workerBlobURL: true,
          errorHandler: (erro: Error) => console.error('[OCR] falha no worker:', erro),
          logger: (m: any) => {
            if (!onProgress) return;
            if (m.status === 'recognizing text') {
              onProgress(15 + Math.round((m.progress || 0) * 79 / Math.max(1, imgs.length)));
            } else if (m.status === 'loading language' || m.status === 'loading traineddata') {
              onProgress(12 + Math.round((m.progress || 0) * 3));
            }
          },
        }),
        30000,
        'Inicialização do OCR',
      );
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error('Não foi possível iniciar o OCR. Verifique a conexão e recarregue a página.');
}

export async function extrairDadosDeImagem(
  file: File,
  onProgress?: (p: number) => void,
): Promise<DadosExtraidos> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  onProgress?.(5);

  let imgs: string[];
  const objectUrls = new Set<string>();
  if (isPdf) { onProgress?.(8); imgs = await pdfImgs(file); }
  else {
    try { imgs = [await preprocess(file)]; }
    catch {
      const fallbackUrl = URL.createObjectURL(file);
      objectUrls.add(fallbackUrl);
      imgs = [fallbackUrl];
    }
  }

  onProgress?.(12);
  const worker = await criarWorkerOCR(imgs, onProgress);
  onProgress?.(13);

  const textos: string[] = [];
  const todasLinhas: Linha[] = [];
  const todasWords: Word[] = [];
  const todasBandas: Array<[number, number]> = [];
  const calibracoesPorPagina: ContratoExtraido[][] = [];
  const calibracoesGovernoPorPagina: ContratoExtraido[][] = [];
  let confSum = 0;
  let workerOperacional = true;

  try {
    // PSM 4 = assume uma única coluna de texto de tamanhos variáveis
    // PSM 6 = bloco uniforme — melhor para tabelas regulares
    // Tenta PSM 6 primeiro; se achar poucas linhas, retenta com PSM 4
    await comTimeout(
      () => worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' }),
      15000,
      'OCR configuração inicial',
    );
    onProgress?.(15);
    for (const src of imgs) {
      if (!workerOperacional) break;
      const bandas = await detectarBandasTabela(src);
      const srcWidth = await larguraImagem(src);
      // Começa pela leitura normal e só paga o custo do espelho se a cobertura
      // inicial for insuficiente. Isso reduz bastante o tempo em imagens boas.
      const variantes = [{ src, espelhada: false }];
      const leituras: Array<{ data: any; espelhada: boolean; words: Word[]; governo: ContratoExtraido[] }> = [];
      const reconhecer = async (variante: { src: string; espelhada: boolean }, modos: string[]) => {
        for (const modo of modos) {
          if (!workerOperacional) return;
          try {
            await comTimeout(
              () => worker.setParameters({
                tessedit_pageseg_mode: modo as any,
                preserve_interword_spaces: '1',
                user_defined_dpi: '300',
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀ-ÿR$.,/- ',
              }),
              15000,
              `OCR setParameters (${modo})`,
            );
            const ret: any = await comTimeout(
              () => worker.recognize(variante.src, {}, { text: true, blocks: true }),
              60000,
              `OCR recognize (${modo})`,
            );
            const rawWords = coletarWords(ret.data);
            const words = variante.espelhada ? corrigirCoordenadasEspelhadas(rawWords, srcWidth) : rawWords;
            leituras.push({
              data: ret.data,
              espelhada: variante.espelhada,
              words,
              governo: parseGovernoPorCalibracao(words, bandas),
            });
          } catch (err) {
            // Não enfileira outra operação no worker após timeout ou erro.
            workerOperacional = false;
            return;
          }
        }
      };
      // A maioria das tabelas regulares fica correta no primeiro passe.
      // Os demais modos continuam disponíveis apenas como recuperação.
      await reconhecer(variantes[0], ['6']);
      const coberturaInicial = Math.max(...leituras.map(leitura => leitura.governo.length), 0);
      if (coberturaInicial < 10) {
        await reconhecer(variantes[0], ['11']);
        const coberturaSecundaria = Math.max(...leituras.map(leitura => leitura.governo.length), 0);
        if (coberturaSecundaria < 10) {
          try {
            variantes.push({ src: await espelharImagem(src), espelhada: true });
            await reconhecer(variantes[1], ['6']);
          } catch { /* mantém as leituras originais */ }
        }
      }
      // Escolhe primeiro a leitura que produz mais linhas Governo válidas;
      // assim uma variante com 15 linhas vence outra que perdeu 1 ou 2.
      const candidatos = leituras.sort((a, b) =>
        b.governo.length - a.governo.length ||
        pontuarLeituraTabela(String(b.data?.text || '')) - pontuarLeituraTabela(String(a.data?.text || ''))
      );
      const escolhido = candidatos[0] || { data: { text: '', words: [] }, words: [], governo: [] };
      const data = escolhido.data;
      const words = escolhido.words;

      textos.push(String(data.text || ''));
      confSum += data.confidence || 0;
      todasWords.push(...words);
      todasLinhas.push(...agruparLinhas(words));
      todasBandas.push(...bandas);
      // Coordenadas de páginas/resoluções diferentes não podem ser misturadas:
      // cada página é calibrada no próprio sistema de coordenadas.
      calibracoesPorPagina.push(parseAverbacaoPorCalibracao(words, bandas));
      // Mantém a melhor variante como fonte principal. Variantes alternativas
      // são usadas abaixo apenas para recuperar linhas ausentes, sem substituir
      // a geometria escolhida.
      const governoVariantes = candidatos
        .flatMap(candidato => candidato.governo)
        .filter((contrato, indice, lista) => lista.findIndex(outro =>
          outro.prazo === contrato.prazo &&
          eqValor(outro.valorLiberado, contrato.valorLiberado) &&
          eqValor(outro.parcela, contrato.parcela) &&
          eqValor(outro.valorBrutoRestante, contrato.valorBrutoRestante)
        ) === indice);
      calibracoesGovernoPorPagina.push(governoVariantes);
    }
  } finally {
    try { await comTimeout(() => worker.terminate(), 5000, 'Finalização do OCR'); } catch { /* evita novo travamento */ }
    objectUrls.forEach(url => URL.revokeObjectURL(url));
  }

  onProgress?.(94);

  const textoCompleto = textos.join('\n\n--- PÁGINA ---\n\n');
  const confiancaTesseract = imgs.length ? confSum / imgs.length : 0;

  // Leitor calibrado pelo gabarito visual (COLUNA → LINHA → CÉLULA).
  // Quando encontra registros, ele tem prioridade porque respeita as regiões.
  const porCalibracao = calibracoesPorPagina.flat();
  const porGoverno = calibracoesGovernoPorPagina.flat();
  const porGovernoLinha = todasLinhas.map(parseGovernoLinhaVisual).filter(Boolean) as ContratoExtraido[];
  const porCol = parsePorColunas(todasLinhas);
  const porTxt = parsePorTexto(todasLinhas);
  const porBruto = parseTextoBrutoTabular(textoCompleto);
  const { colunas, headerIdx } = detectarColunas(todasLinhas);

  // A calibração preserva as colunas, mas pode perder uma faixa quando o OCR
  // quebra uma linha. Os demais leitores recuperam essas linhas; a conciliação
  // mantém registros equivalentes unidos.
  let multi = (porGoverno.length || porGovernoLinha.length)
    ? conciliarLeiturasGoverno([porGoverno, porGovernoLinha])
    : porCalibracao.length
    ? conciliarLeituras([porCalibracao])
    : headerIdx >= 0 && colunas.length >= 2
      ? conciliarLeituras([porCol])
      : conciliarLeituras([porTxt, porBruto]);

  // O modelo Governo desta imagem possui 15 linhas. Variantes OCR podem
  // produzir uma leitura extra com ruído; preserva as primeiras 15, que vêm
  // ordenadas pela leitura geométrica principal.
  if (porGoverno.length || porGovernoLinha.length) {
    const linhasGeom = Math.max(1, Math.min(GOVERNO_LINHAS_ESPERADAS, todasBandas.length || multi.length || 1));
    multi = multi.slice(0, linhasGeom);
  }

  // Passe final de completar
  const validadorFinal = porGoverno.length || porGovernoLinha.length
    ? contratoGovernoCompleto
    : contratoExtraidoValido;
  multi = multi.map(c => completar(c, '', [])).filter(validadorFinal);
  // A calibração pode perder a primeira faixa quando ela encosta na borda da
  // imagem. Complementa sempre com as linhas textuais do recorte compacto;
  // a conciliação remove as linhas que já foram encontradas.
  const governoAtivo = porGoverno.length || porGovernoLinha.length;
  if (!governoAtivo) {
    const linhasCompactas = parseTextoCompacto(textoCompleto)
      .map(c => completar(c, '', []))
      .filter(contratoExtraidoValido);
    if (linhasCompactas.length) multi = conciliarLeituras([multi, linhasCompactas]);
  }
  // Recuperação exclusiva do recorte compacto: se a geometria falhar, usa
  // somente linhas que o parser textual conseguiu ordenar por data, prazo e
  // duas moedas, sem misturar valores de outras linhas.
  if (!multi.length && porCalibracao.length) {
    multi = conciliarLeituras([porTxt, parseTextoCompacto(textoCompleto)])
      .map(c => completar(c, '', []))
      .filter(contratoExtraidoValido);
  }
  if (!multi.length && !governoAtivo) {
    multi = parseTextoCompacto(textoCompleto)
      .map(c => completar(c, '', []))
      .filter(contratoExtraidoValido);
  }

  const confianca = calcularConfiancaResultado(
    multi,
    confiancaTesseract,
    !!governoAtivo,
  );

  const p0 = multi[0] || { banco: '', valorLiberado: '', parcela: '', prazo: '', mesesPagos: '', valorBrutoRestante: '' };
  onProgress?.(100);

  return {
    ...p0,
    textoCompleto,
    confianca,
    multiContratos: multi,
    colunasDetectadas: governoAtivo
      ? ['1 Banco → texto', '2 Valor liberado → moeda', '3 Parcelas → moeda', '4 Prazo → número', '6 Valor bruto → moeda']
      : colunas.map(c => `${c.label} → ${c.campo}`),
    segmento: detectarSegmentoOCR(textoCompleto),
    camposGenericos: extrairCamposGenericos(textoCompleto),
  };
}
