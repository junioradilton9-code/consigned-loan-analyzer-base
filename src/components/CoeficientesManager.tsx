import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs`;

import {
  restaurarTabelasPadrao, resumoTabelas, substituirLoteTabelas,
  remapearPrazos, removerTabela, TABELAS, normalizarDataISO, obterTabela,
  type Convenio, type TabelaFator,
} from '../utils/coeficientes';
import type { Usuario } from '../utils/users';

interface LinhaExtraida {
  dataBase: string;
  primeiroVenc: string;
  txCet: number;
  fatores: Record<number, number>;
}

interface TabelaDetectada {
  id: number;
  nome: string;
  linhas: LinhaExtraida[];
  prazos: number[];
  preview: TabelaFator;
}

export default function CoeficientesManager({
  onTabelasAtualizadas,
  usuarioAtual,
  usuarios,
}: {
  onTabelasAtualizadas?: () => void;
  usuarioAtual: Usuario;
  usuarios: Usuario[];
}) {
  const [convenio, setConvenio] = useState<Convenio>('inss');
  const [codigoBase, setCodigoBase] = useState('');
  const [prazosInput, setPrazosInput] = useState('96, 108');
  const [tcInput, setTcInput] = useState('0');
  const [empregador, setEmpregador] = useState('INSS');
  const [msg, setMsg] = useState('');
  const [expandido, setExpandido] = useState(false);
  const [anexoNome, setAnexoNome] = useState('');
  const [anexoSize, setAnexoSize] = useState(0);
  const [anexoExt, setAnexoExt] = useState('');
  const [tabelasDetectadas, setTabelasDetectadas] = useState<TabelaDetectada[]>([]);
  const [tabelasSelecionadas, setTabelasSelecionadas] = useState<number[]>([]);
  const [modoAdicionar, setModoAdicionar] = useState(false);
  // Lista TODOS os outros usuários para aplicar tabelas
  const OPCAO_TODOS = '__todos__';
  const usuariosAlvo = usuarios.filter(u => u.id !== usuarioAtual.id);
  const podeTodos = usuarioAtual.role === 'master';
  const [usuarioAlvoId, setUsuarioAlvoId] = useState(
    usuarioAtual.role === 'master' ? OPCAO_TODOS : usuarioAtual.id
  );
  const usuarioAlvo = usuarios.find(u => u.id === usuarioAlvoId) || null;
  // "global" = aplica a TODOS (inclui novos usuários automaticamente)
  const escopoCoef = usuarioAlvoId === OPCAO_TODOS ? 'global' : (usuarioAlvo?.id || usuarioAtual.id);
  // Alvo válido: master pode escolher "todos" ou outro usuário; comum só pode escolher outro
  const alvoValido = usuarioAtual.role === 'master'
    ? !!usuarioAlvoId
    : !!usuarioAlvoId;
  const [mostrarAtivas, setMostrarAtivas] = useState(false);
  const [versaoAtivas, setVersaoAtivas] = useState(0);
  const [editandoPrazos, setEditandoPrazos] = useState<{ codigo: string; valor: string } | null>(null);

  function formatarTamanho(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  const prazos = prazosInput.split(',').map(p => parseInt(p.trim())).filter(n => n > 0);

  // Se a lista de usuários mudar (novo usuário criado) ou o alvo atual deixar
  // de existir, seleciona automaticamente um usuário válido (exceto Master Admin).
  useEffect(() => {
    // Master deve manter "Todos os usuários" como padrão para aplicar a atuais e futuros
    if (usuarioAtual.role === 'master' && !usuarioAlvoId) {
      setUsuarioAlvoId(OPCAO_TODOS);
      return;
    }
    // Usuário comum usa o próprio escopo
    if (usuarioAtual.role !== 'master' && usuarioAlvoId !== usuarioAtual.id) {
      setUsuarioAlvoId(usuarioAtual.id);
      return;
    }
    // Se "Todos" não está marcado e o selecionado não existe mais, escolhe o primeiro
    if (usuarioAlvoId !== OPCAO_TODOS && usuariosAlvo.length > 0 && !usuariosAlvo.some(u => u.id === usuarioAlvoId)) {
      setUsuarioAlvoId(usuariosAlvo[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios.length, usuarioAtual.id]);

  // ==================== EXCEL (cada aba = uma tabela) ====================
  async function lerExcel(file: File): Promise<{ nome: string; conteudo: string }[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const tabelas: { nome: string; conteudo: string }[] = [];

          workbook.SheetNames.forEach((sheetName, index) => {
            const sheet = workbook.Sheets[sheetName];
            const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
            const linhas: string[] = [];

            json.forEach((row) => {
              const limpa = row.map(c => (c || '').toString().trim()).filter(Boolean);
              if (limpa.length >= 4) {
                linhas.push(limpa.join(';'));
              }
            });

            if (linhas.length > 0) {
              tabelas.push({
                nome: sheetName || `Sheet${index + 1}`,
                conteudo: linhas.join('\n'),
              });
            }
          });

          resolve(tabelas);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // ==================== PDF ====================
  async function lerPDF(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let texto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      texto += pageText + '\n';
    }
    return texto;
  }

  // ==================== UPLOAD ====================
  async function handleAnexo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnexoNome(file.name);
    setAnexoSize(file.size);
    setAnexoExt(file.name.split('.').pop()?.toUpperCase() || 'ARQ');
    setMsg(`Processando ${file.name}...`);

    try {
      let tabelas: TabelaDetectada[] = [];

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const texto = await lerPDF(file);
        tabelas = detectarMultiplasTabelas(texto);
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel' ||
        file.name.toLowerCase().endsWith('.xlsx') ||
        file.name.toLowerCase().endsWith('.xls')
      ) {
        // Excel: cada aba vira uma tabela separada
        const abas = await lerExcel(file);
        tabelas = abas.map((aba, idx) => {
          const linhas = processarBloco(aba.conteudo.split('\n'));
          return criarTabelaDetectada(idx + 1, linhas, aba.nome);
        }).filter(t => t.linhas.length > 0);
      } else if (file.type.startsWith('text/') || file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        const texto = await file.text();
        tabelas = detectarMultiplasTabelas(texto);
      } else {
        setMsg('⚠️ Formato não suportado. Use PDF, Excel, CSV ou TXT.');
        return;
      }

      setTabelasDetectadas(tabelas);
      setTabelasSelecionadas(tabelas.map((_, i) => i));

      setMsg(`✅ ${file.name} carregado! ${tabelas.length} tabela(s) detectada(s).`);
    } catch (err: any) {
      setMsg('❌ Erro ao processar arquivo: ' + (err.message || 'desconhecido'));
    }
  }

  // ==================== DETECTAR MÚLTIPLAS TABELAS ====================
  function detectarMultiplasTabelas(texto: string): TabelaDetectada[] {
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const tabelas: TabelaDetectada[] = [];
    let tabelaAtual: string[] = [];
    let contador = 1;

    for (const linha of linhas) {
      // Critérios para detectar início de nova tabela:
      // 1. Linha contém "Tabela", "Convênio", "Código" no início
      // 2. Linha tem muitos campos vazios seguidos (provável separador)
      // 3. Linha começa com data (provável início de dados)

      const isNovoBloco =
        /^(tabela|convênio|codigo|data base)/i.test(linha) ||
        linha.split(';').filter(Boolean).length >= 5; // linha com muitos campos

      if (isNovoBloco && tabelaAtual.length > 0) {
        // Processa tabela anterior
        const parsed = processarBloco(tabelaAtual);
        if (parsed.length > 0) {
          tabelas.push(criarTabelaDetectada(contador, parsed));
          contador++;
        }
        tabelaAtual = [linha];
      } else {
        tabelaAtual.push(linha);
      }
    }

    // Processa última tabela
    if (tabelaAtual.length > 0) {
      const parsed = processarBloco(tabelaAtual);
      if (parsed.length > 0) {
        tabelas.push(criarTabelaDetectada(contador, parsed));
      }
    }

    // Se não detectou múltiplas, trata tudo como uma única
    if (tabelas.length === 0) {
      const parsed = processarBloco(linhas);
      if (parsed.length > 0) {
        tabelas.push(criarTabelaDetectada(1, parsed));
      }
    }

    return tabelas;
  }

  function processarBloco(linhas: string[]): LinhaExtraida[] {
    const extraidas: LinhaExtraida[] = [];
    for (const linha of linhas) {
      const parsed = parseLinha(linha);
      if (parsed) extraidas.push(parsed);
    }
    return extraidas;
  }

  /**
   * Preenche datas ausentes usando as datas-base oficiais do convênio.
   * Permite importar planilhas que trazem apenas as colunas de coeficiente
   * (ex.: "96 meses | 108 meses"), sem as colunas de data.
   */
  function completarDatas(linhas: LinhaExtraida[]): LinhaExtraida[] {
    const base = TABELAS[convenio][0]?.linhas ?? [];
    if (!base.length) return linhas;
    return linhas.map((l, i) => {
      if (l.dataBase) return l;
      const ref = base[i];
      if (!ref) return l;
      return {
        ...l,
        dataBase: ref.dataBase,
        primeiroVenc: l.primeiroVenc || ref.primeiroVenc,
        txCet: l.txCet || ref.txCet,
      };
    }).filter(l => !!l.dataBase);
  }

  function criarTabelaDetectada(id: number, linhasBrutas: LinhaExtraida[], nomePersonalizado?: string): TabelaDetectada {
    const nome = nomePersonalizado || `Tabela ${id}`;
    // Completa datas ausentes com as datas-base oficiais do convênio
    const linhas = completarDatas(linhasBrutas);
    const prazosUnicos = Array.from(new Set(linhas.flatMap(l => Object.keys(l.fatores).map(Number)))).sort((a, b) => a - b);

    const preview: TabelaFator = {
      id: `detected-${id}`,
      convenio,
      codigo: `${codigoBase || 'AUTO'}-${id}`,
      nome,
      empregador: empregador || '—',
      prazos: prazosUnicos.length > 0 ? prazosUnicos : prazos,
      tc: parseFloat(tcInput) || 0,
      oficial: false,
      linhas: linhas.map(l => ({
        dataBase: l.dataBase,
        primeiroVenc: l.primeiroVenc,
        txCet: l.txCet,
        fatores: l.fatores,
      })),
    };

    return { id, nome, linhas, prazos: prazosUnicos, preview };
  }

  // ==================== PARSE ====================
  function parseLinha(linha: string): LinhaExtraida | null {
    const limpa = linha
      .replace(/;{2,}/g, ';')
      .replace(/\|/g, ';')
      .replace(/\t/g, ';')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    if (!limpa.length) return null;

    let dataBase = '';
    let primeiroVenc = '';
    let txCet = 0;
    const fatores: Record<number, number> = {};

    // Aceita DD/MM/AAAA, DD-MM-AAAA e AAAA-MM-DD; guarda SEMPRE em ISO
    // (essencial para o match de data-base na Portabilidade)
    const datasEncontradas = limpa
      .filter(p => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(p) || /^\d{4}-\d{2}-\d{2}$/.test(p))
      .map(normalizarDataISO);
    if (datasEncontradas.length >= 1) dataBase = datasEncontradas[0];
    if (datasEncontradas.length >= 2) primeiroVenc = datasEncontradas[1];

    // CET: número entre 1 e 100 que NÃO seja parte de uma data
    for (const p of limpa) {
      if (/[/-]/.test(p)) continue;                    // ignora datas
      const n = parseFloat(p.replace(',', '.'));
      if (!isNaN(n) && n > 1 && n < 100) { txCet = n; break; }
    }

    // Fatores Price: decimais pequenos (0,005 a 0,2). Ignora colunas de data.
    const fatoresEncontrados = limpa
      .filter(p => !/[/-]/.test(p))
      .map(p => parseFloat(p.replace(',', '.')))
      .filter(n => !isNaN(n) && n > 0.005 && n < 0.2);

    // Mapeia cada fator ao prazo correspondente (posicional)
    const prazosUsar = prazos.length > 0 ? prazos : [96, 108];
    prazosUsar.forEach((p, i) => {
      if (fatoresEncontrados[i] !== undefined) {
        fatores[p] = fatoresEncontrados[i];
      }
    });

    // Só o FATOR é obrigatório. Planilhas que trazem apenas as colunas de
    // coeficiente (sem data/CET) passam a ser aceitas — a data é preenchida
    // depois com as datas-base oficiais do convênio.
    if (Object.keys(fatores).length === 0) return null;
    if (!primeiroVenc) primeiroVenc = dataBase;

    return { dataBase, primeiroVenc, txCet, fatores };
  }

  // ==================== ANÁLISE ====================
  function analisar() {
    setMsg('');

    if (tabelasDetectadas.length === 0) {
      setMsg('⚠️ Nenhum anexo carregado ou nenhuma tabela detectada.');
      return;
    }

    // Valida e regenera a prévia de cada tabela (sem reparse — evita corromper dados)
    const validas = tabelasDetectadas.filter(t => t.linhas.length > 0);

    if (validas.length === 0) {
      setMsg('⚠️ Nenhuma tabela com linhas válidas encontrada.');
      return;
    }

    setTabelasDetectadas(validas);
    setTabelasSelecionadas(validas.map((_, i) => i));

    // Alerta se os prazos detectados diferem dos informados no formulário
    // (causa clássica de "a tabela não aparece na Portabilidade")
    const divergentes = validas.filter(t =>
      prazos.length > 0 && t.prazos.length > 0 &&
      (t.prazos.length !== prazos.length || t.prazos.some(p => !prazos.includes(p)))
    );

    const detalhe = validas.map(t => `${t.nome} → ${t.prazos.join('/') || '?'}m`).join(' • ');
    if (divergentes.length) {
      setMsg(
        `⚠️ ${validas.length} tabela(s) confirmada(s), mas os prazos detectados diferem do informado ` +
        `(${prazos.join(', ')}): ${detalhe}. Confira o campo PRAZOS (MESES) — a planilha precisa ter ` +
        `um fator por prazo, na mesma ordem.`
      );
    } else {
      setMsg(`✅ ${validas.length} tabela(s) confirmada(s): ${detalhe}`);
    }
  }

  // ==================== SUBSTITUIR TODAS (com persistência) ====================
  function substituirTodas() {
    if (!alvoValido) {
      setMsg('⚠️ Selecione um usuário válido (ou "Todos os usuários") para aplicar as tabelas.');
      return;
    }
    if (tabelasSelecionadas.length === 0) {
      setMsg('⚠️ Selecione pelo menos uma tabela.');
      return;
    }

    // Sem prazos, a tabela nunca aparece na Portabilidade
    const semPrazo = tabelasSelecionadas.some(i => {
      const t = tabelasDetectadas[i];
      return t && t.prazos.length === 0 && prazos.length === 0;
    });
    if (semPrazo) {
      setMsg('⚠️ Informe os PRAZOS (MESES) — ex.: "96, 108" — antes de substituir.');
      return;
    }

    // Monta o lote com os valores ATUAIS do formulário
    const lote: TabelaFator[] = tabelasSelecionadas
      .map(idx => tabelasDetectadas[idx])
      .filter(Boolean)
      .map(t => ({
        id: `custom-${convenio}-${codigoBase || 'AUTO'}-${t.id}`,
        convenio,
        codigo: `${codigoBase || 'AUTO'}-${t.id}`,
        nome: t.nome,
        empregador: empregador || '—',
        prazos: t.prazos.length > 0 ? t.prazos : prazos,
        tc: parseFloat(tcInput.replace(',', '.')) || 0,
        oficial: false,
        linhas: t.linhas.map(l => ({
          dataBase: l.dataBase,
          primeiroVenc: l.primeiroVenc,
          txCet: l.txCet,
          fatores: l.fatores,
        })),
      }));

    const antigas = resumoTabelas(convenio, escopoCoef).filter(t => !t.oficial);
    if (!modoAdicionar && antigas.length > 0) {
      const ok = confirm(
        `Substituir a remessa de ${convenio.toUpperCase()}?\n\n` +
        `• ${antigas.length} tabela(s) customizada(s) atual(is) será(ão) REMOVIDA(S)\n` +
        `• ${lote.length} tabela(s) nova(s) entrará(ão) no lugar\n` +
        `• As tabelas oficiais de fábrica permanecem intactas\n\n` +
        `Isso evita acúmulo de tabelas antigas. Continuar?`
      );
      if (!ok) return;
    }

    const r = substituirLoteTabelas(convenio, lote, modoAdicionar, escopoCoef);

    // Sincroniza com a nuvem: remove as antigas e envia o conjunto atual
    import('../utils/cloudDb').then(async ({ nuvemSalvarTabela, nuvemRemoverTabelaPorCodigo }) => {
      try {
        if (!modoAdicionar) {
          for (const cod of r.codigosRemovidos) {
            await nuvemRemoverTabelaPorCodigo(convenio, cod, escopoCoef).catch(() => { /* offline */ });
          }
        }
        for (const t of lote) {
          await nuvemSalvarTabela(convenio, t, escopoCoef).catch(() => { /* offline */ });
        }
      } catch { /* offline */ }
    }).catch(() => { /* ignora */ });

    setMsg(
      `✅ ${r.adicionadas} nova(s) • ${r.substituidas} atualizada(s)` +
      (r.removidas > 0 ? ` • ${r.removidas} antiga(s) removida(s)` : '') +
      `. Total ativo em ${convenio.toUpperCase()}: ${TABELAS[convenio].length} tabela(s).`
    );
    setTabelasDetectadas([]);
    setTabelasSelecionadas([]);
    setAnexoNome('');
    setAnexoSize(0);
    setAnexoExt('');
    setVersaoAtivas(v => v + 1);
    // Notifica o app para sincronizar a Portabilidade com as novas tabelas
    onTabelasAtualizadas?.();
  }

  // ==================== GERENCIAR TABELAS ATIVAS ====================
  const tabelasAtivas = useMemo(
    () => resumoTabelas(convenio, escopoCoef),
    [convenio, escopoCoef, versaoAtivas]
  );

  function salvarNovosPrazos(codigo: string, texto: string) {
    const novos = texto.split(/[,;\s]+/).map(p => parseInt(p.trim())).filter(n => n > 0);
    if (!novos.length) { setMsg('⚠️ Informe ao menos um prazo válido (ex.: 108).'); return; }
    const ok = remapearPrazos(convenio, codigo, novos, escopoCoef);
    if (!ok) { setMsg('⚠️ Não foi possível atualizar essa tabela.'); return; }
    // Sincroniza com a nuvem
    const atualizada = obterTabela(convenio, codigo, escopoCoef);
    if (atualizada) {
      import('../utils/cloudDb').then(({ nuvemSalvarTabela }) => {
        nuvemSalvarTabela(convenio, atualizada, escopoCoef).catch(() => { /* offline */ });
      }).catch(() => { /* ignora */ });
    }
    setEditandoPrazos(null);
    setVersaoAtivas(v => v + 1);
    setMsg(`✅ Prazos da tabela ${codigo} atualizados para ${novos.join(', ')} meses.`);
    onTabelasAtualizadas?.();
  }

  function excluirTabela(codigo: string, nome: string, oficial: boolean) {
    const aviso = oficial
      ? `Remover a tabela OFICIAL "${nome}" (${codigo})?\n\nEla não voltará automaticamente. Para restaurar, use "Restaurar padrão".`
      : `Remover a tabela "${nome}" (${codigo})?`;
    if (!confirm(aviso)) return;

    removerTabela(convenio, codigo, escopoCoef);

    // Remove também da nuvem
    import('../utils/cloudDb').then(({ nuvemRemoverTabelaPorCodigo }) => {
      nuvemRemoverTabelaPorCodigo(convenio, codigo, escopoCoef).catch(() => {});
    }).catch(() => {});

    setVersaoAtivas(v => v + 1);
    setMsg(`🗑️ Tabela ${codigo} removida${oficial ? ' (oficial — use "Restaurar padrão" para recuperar)' : ''}.`);
    onTabelasAtualizadas?.();
  }

  // ==================== RESTAURAR PADRÃO ====================
  function restaurarPadrao() {
    const qtd = restaurarTabelasPadrao(convenio, escopoCoef);
    // Remove também da nuvem
    import('../utils/cloudDb').then(({ nuvemRemoverTabelasConvenio }) => {
      nuvemRemoverTabelasConvenio(convenio, escopoCoef).catch(() => { /* offline */ });
    }).catch(() => { /* ignora */ });
    setMsg(`↩️ Tabelas oficiais padrão de ${convenio.toUpperCase()} restauradas (${qtd} customizada(s) removida(s)).`);
    onTabelasAtualizadas?.();
  }

  function limpar() {
    setTabelasDetectadas([]);
    setTabelasSelecionadas([]);
    setAnexoNome('');
    setAnexoSize(0);
    setAnexoExt('');
    setMsg('');
  }

  function toggleTabela(id: number) {
    if (tabelasSelecionadas.includes(id)) {
      setTabelasSelecionadas(tabelasSelecionadas.filter(x => x !== id));
    } else {
      setTabelasSelecionadas([...tabelasSelecionadas, id]);
    }
  }

  return (
    <section className="card" style={{ background: '#0f172a', border: '1px solid #334155' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: expandido ? 12 : 0 }}>
        <h2 style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
          📊 Analisar e substituir coeficientes
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
          {expandido ? '🔼 Ocultar' : '🔽 Expandir'}
        </button>
      </div>

      {expandido && (<>
      <p style={{ fontSize: '.82rem', color: '#94a3b8', marginBottom: 16 }}>
        Cole uma tabela extraída do PDF em formato texto/CSV. O sistema identifica convênio, código, datas, primeiro vencimento, CET e fatores, mostra uma prévia e substitui apenas a tabela correspondente.
      </p>
      {/* Passos */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { n: 1, label: 'Cole' },
          { n: 2, label: 'Analise' },
          { n: 3, label: 'Confira' },
          { n: 4, label: 'Substitua' },
        ].map((s, i) => (
          <div key={i} style={{
            background: '#1e293b',
            border: '1px solid #475569',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: '.75rem',
            fontWeight: 700,
            color: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              background: '#10b981',
              color: '#052e16',
              width: 18, height: 18,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '.68rem',
              fontWeight: 900,
            }}>{s.n}</span>
            {s.label}
          </div>
        ))}
      </div>

      {/* Upload por anexo */}
      <div style={{
        background: '#1e293b',
        border: '1px solid #475569',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '.9rem' }}>📎 Preenchimento automático por anexo</div>
            <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>
              Envie PDF, Excel, CSV ou TXT. O sistema detecta automaticamente múltiplas tabelas no arquivo.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{
              background: '#10b981',
              color: '#052e16',
              padding: '8px 16px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '.82rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              📁 ESCOLHER ANEXO
              <input type="file" accept=".pdf,.csv,.txt,.xlsx,.xls,image/*" style={{ display: 'none' }} onChange={handleAnexo} />
            </label>
            <button className="btn-neutro btn-mini" style={{ fontSize: '.82rem' }} onClick={limpar}>Limpar anexo</button>
          </div>
        </div>
        {anexoNome && (
          <div style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'linear-gradient(135deg, #052e16, #064e3b)',
            border: '1.5px solid #10b981',
            borderRadius: 10,
            padding: '12px 16px',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.2)',
          }}>
            <div style={{
              width: 42, height: 42,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', fontWeight: 900, color: '#052e16',
              flex: '0 0 auto',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>
              {anexoExt === 'PDF' ? '📕' : anexoExt === 'XLSX' || anexoExt === 'XLS' ? '📗' : '📄'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '.92rem',
                fontWeight: 800,
                color: '#e2e8f0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>{anexoNome}</div>
              <div style={{ fontSize: '.72rem', color: '#6ee7b7', fontWeight: 600, marginTop: 2 }}>
                <span style={{
                  display: 'inline-block',
                  background: '#10b981',
                  color: '#052e16',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: '.64rem',
                  fontWeight: 900,
                  marginRight: 6,
                }}>{anexoExt}</span>
                {formatarTamanho(anexoSize)}
                {tabelasDetectadas.length > 0 && (
                  <> • <b style={{ color: '#4ade80' }}>{tabelasDetectadas.length} tabela(s)</b></>
                )}
              </div>
            </div>
            {tabelasDetectadas.length > 0 && (
              <span style={{
                background: '#10b981',
                color: '#052e16',
                borderRadius: '50%',
                width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.8rem', fontWeight: 900,
                flex: '0 0 auto',
              }}>✓</span>
            )}
          </div>
        )}
      </div>

      {/* Formulário de dados da tabela */}

      {/* USUÁRIO ALVO — linha dedicada (mais largo) */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>
          🎯 USUÁRIO ALVO — tabela(s) será(ão) aplicada(s) a este usuário
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={usuarioAlvoId}
            disabled={!podeTodos && usuariosAlvo.length === 0}
            onChange={(e) => { setUsuarioAlvoId(e.target.value); setVersaoAtivas(v => v + 1); }}
            style={{ flex: '1 1 300px', minWidth: 240, padding: '10px 14px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0', fontWeight: 600, fontSize: '.9rem' }}
          >
            {podeTodos && <option value={OPCAO_TODOS}>👥 Todos os usuários (aplica a todos + novos)</option>}
            {usuariosAlvo.length === 0 && <option value="">Nenhum outro usuário encontrado</option>}
            {usuariosAlvo.map(u => (
              <option key={u.id} value={u.id}>{u.nome} — {u.email}{u.role === 'master' ? ' 👑' : ''}</option>
            ))}
          </select>
          <span style={{ fontSize: '.78rem', color: '#4ade80', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {usuarioAlvoId === OPCAO_TODOS
              ? '→ Todos os usuários'
              : usuarioAlvoId ? `→ ${usuarios.find(u => u.id === usuarioAlvoId)?.nome}` : ''}
          </span>
        </div>
        <div style={{ fontSize: '.72rem', color: '#94a3b8', marginTop: 6 }}>
          {usuarioAlvoId === OPCAO_TODOS
            ? '✅ Aplicado a TODOS os usuários atuais e também aos criados no futuro.'
            : usuariosAlvo.length === 0
              ? '⚠️ Nenhum outro usuário encontrado. Crie um novo no Painel Master.'
              : `${usuariosAlvo.length} usuário(s) disponível(is)`}
        </div>
      </div>

      {/* Resto do formulário */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>CONVÊNIO DE DESTINO</div>
            <select value={convenio} onChange={(e) => setConvenio(e.target.value as Convenio)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0', fontWeight: 600 }}>
              <option value="inss">🏛️ INSS</option>
              <option value="siape">🏢 SIAPE</option>
              <option value="governo">🏛️ Governo</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>CÓDIGO BASE</div>
            <input type="text" placeholder="Ex.: 805978" value={codigoBase} onChange={(e) => setCodigoBase(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }} />
          </div>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>PRAZOS (MESES)</div>
            <input type="text" placeholder="96, 108" value={prazosInput} onChange={(e) => setPrazosInput(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }} />
          </div>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>TC</div>
            <input type="text" placeholder="0" value={tcInput} onChange={(e) => setTcInput(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }} />
          </div>
          <div>
            <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>EMPREGADOR</div>
            <input type="text" placeholder="INSS" value={empregador} onChange={(e) => setEmpregador(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }} />
          </div>
        </div>

      {/* TABELAS DETECTADAS */}
      {tabelasDetectadas.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
            📋 Tabelas Detectadas ({tabelasDetectadas.length})
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {tabelasDetectadas.map((t, idx) => (
              <div
                key={idx}
                style={{
                  background: tabelasSelecionadas.includes(idx) ? '#052e16' : '#1e293b',
                  border: tabelasSelecionadas.includes(idx) ? '2px solid #10b981' : '1px solid #475569',
                  borderRadius: 10,
                  padding: 14,
                  cursor: 'pointer',
                }}
                onClick={() => toggleTabela(idx)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, color: '#e2e8f0', fontSize: '1rem' }}>
                    {t.nome} — {t.linhas.length} linhas
                  </div>
                  <div style={{ fontSize: '.72rem', color: '#94a3b8' }}>
                    {t.prazos.length} prazos: {t.prazos.join(', ')}
                  </div>
                </div>

                <div style={{ fontSize: '.72rem', color: '#64748b' }}>
                  Código: {codigoBase || 'AUTO'}-{t.id} • CET: {t.linhas[0]?.txCet.toFixed(2)}%
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, fontSize: '.72rem', color: '#94a3b8' }}>
            Clique nas tabelas para selecionar/deselecionar. {tabelasSelecionadas.length} de {tabelasDetectadas.length} selecionada(s).
          </div>
        </div>
      )}

      {/* ══ TABELAS ATIVAS — diagnóstico e correção de prazos ══ */}
      <div style={{ marginTop: 20, background: '#1e293b', border: '1px solid #475569', borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, color: '#e2e8f0', fontSize: '.9rem' }}>
              🗂️ Tabelas ativas de {convenio.toUpperCase()} ({tabelasAtivas.length})
            </div>
            <div style={{ fontSize: '.76rem', color: '#94a3b8', marginTop: 2 }}>
              Uma tabela só aparece na Portabilidade se tiver o prazo selecionado lá.
              Se importou com o prazo errado, corrija aqui — sem reimportar.
            </div>
          </div>
          <button className="btn-neutro btn-mini" onClick={() => setMostrarAtivas(!mostrarAtivas)}>
            {mostrarAtivas ? '🔽 Ocultar' : '👁️ Ver / corrigir prazos'}
          </button>
        </div>

        {mostrarAtivas && (
          <div style={{ marginTop: 12, display: 'grid', gap: 8, maxHeight: 380, overflow: 'auto' }}>
            {tabelasAtivas.length === 0 && (
              <div style={{ color: '#f87171', fontSize: '.82rem' }}>Nenhuma tabela neste convênio.</div>
            )}
            {tabelasAtivas.map((t) => {
              const editando = editandoPrazos?.codigo === t.codigo;
              return (
                <div key={t.codigo} style={{
                  background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
                  padding: '10px 12px', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '.84rem' }}>
                      {t.codigo}
                      {t.oficial && <span style={{ marginLeft: 8, fontSize: '.66rem', background: '#052e16', color: '#4ade80', border: '1px solid #166534', borderRadius: 999, padding: '2px 8px', fontWeight: 800 }}>OFICIAL</span>}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '.74rem', marginTop: 2 }}>
                      {t.nome} • {t.linhas} linha(s) • prazos declarados:{' '}
                      <b style={{ color: t.prazos.length ? '#fbbf24' : '#f87171' }}>
                        {t.prazos.length ? t.prazos.join(', ') + 'm' : 'nenhum!'}
                      </b>
                    </div>
                    {/* Diagnóstico: o que REALMENTE está salvo nas linhas */}
                    <div style={{ color: '#64748b', fontSize: '.7rem', marginTop: 3, lineHeight: 1.5 }}>
                      <span style={{ color: t.prazosComFator.length ? '#4ade80' : '#f87171' }}>
                        fatores reais: {t.prazosComFator.length ? t.prazosComFator.join(', ') + 'm' : 'NENHUM'}
                      </span>
                      {' • '}
                      <span style={{
                        color: t.amostraDatas.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d)) ? '#f87171' : '#64748b'
                      }}>
                        datas: {t.amostraDatas.join(', ') || '—'}
                      </span>
                      {t.prazos.length !== t.prazosComFator.length && (
                        <div style={{ color: '#fbbf24', marginTop: 2 }}>
                          ⚠️ Declara {t.prazos.length} prazo(s) mas só tem fator para {t.prazosComFator.length}.
                          Use "Corrigir prazos" com: <b>{t.prazosComFator.join(', ') || '—'}</b>
                        </div>
                      )}
                    </div>
                  </div>

                  {editando ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        autoFocus
                        value={editandoPrazos!.valor}
                        onChange={(e) => setEditandoPrazos({ codigo: t.codigo, valor: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvarNovosPrazos(t.codigo, editandoPrazos!.valor); }}
                        placeholder="Ex.: 108"
                        style={{ width: 110, padding: '7px 10px', borderRadius: 7, background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0', fontSize: '.8rem' }}
                      />
                      <button className="btn-primario btn-mini" onClick={() => salvarNovosPrazos(t.codigo, editandoPrazos!.valor)}>✅ Salvar</button>
                      <button className="btn-neutro btn-mini" onClick={() => setEditandoPrazos(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                       <button className="btn-neutro btn-mini" onClick={() => setEditandoPrazos({ codigo: t.codigo, valor: t.prazos.join(', ') })}>
                         ✏️ Corrigir prazos
                       </button>
                       <button
                         className="btn-perigo btn-mini"
                         title={t.oficial ? 'Remover tabela oficial (use Restaurar padrão para recuperar)' : 'Remover tabela'}
                         onClick={() => excluirTabela(t.codigo, t.nome, t.oficial)}
                       >🗑️ Remover</button>
                     </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modo de aplicação — evita acúmulo de tabelas antigas */}
      {tabelasDetectadas.length > 0 && (
        <div style={{
          marginTop: 16, background: '#1e293b', border: '1px solid #475569',
          borderRadius: 12, padding: 14,
        }}>
          <div style={{ fontWeight: 800, color: '#e2e8f0', fontSize: '.85rem', marginBottom: 8 }}>
            ⚙️ Como aplicar esta remessa?
          </div>
          <label style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
            padding: '9px 12px', borderRadius: 9, marginBottom: 6,
            background: !modoAdicionar ? '#052e16' : 'transparent',
            border: `1px solid ${!modoAdicionar ? '#10b981' : '#334155'}`,
          }}>
            <input type="radio" checked={!modoAdicionar} onChange={() => setModoAdicionar(false)} style={{ width: 'auto', marginTop: 3 }} />
            <span style={{ fontSize: '.8rem', color: '#e2e8f0' }}>
              <b>🔄 Substituir remessa (recomendado)</b>
              <div style={{ color: '#94a3b8', fontSize: '.75rem', marginTop: 2 }}>
                Remove as tabelas customizadas anteriores e coloca só as novas.
                <b> Evita acúmulo.</b> As oficiais de fábrica não são afetadas.
              </div>
            </span>
          </label>
          <label style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
            padding: '9px 12px', borderRadius: 9,
            background: modoAdicionar ? '#1e3a5f' : 'transparent',
            border: `1px solid ${modoAdicionar ? '#3b82f6' : '#334155'}`,
          }}>
            <input type="radio" checked={modoAdicionar} onChange={() => setModoAdicionar(true)} style={{ width: 'auto', marginTop: 3 }} />
            <span style={{ fontSize: '.8rem', color: '#e2e8f0' }}>
              <b>➕ Adicionar ao conjunto atual</b>
              <div style={{ color: '#94a3b8', fontSize: '.75rem', marginTop: 2 }}>
                Mantém as customizadas existentes. Use apenas para complementar
                (ex.: outra faixa de valores).
              </div>
            </span>
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <button className="btn-neutro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={analisar} disabled={tabelasDetectadas.length === 0}>🔍 Analisar e identificar</button>
        <button className="btn-primario" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={substituirTodas} disabled={tabelasSelecionadas.length === 0}>
          {modoAdicionar ? '➕ Adicionar' : '🔄 Substituir por'} {tabelasSelecionadas.length} tabela(s)
        </button>
        <button className="btn-neutro" style={{ fontSize: '.82rem', padding: '10px 18px' }} onClick={limpar}>🗑️ Limpar análise</button>
        <button
          className="btn-neutro"
          style={{ fontSize: '.82rem', padding: '10px 18px', color: '#f87171' }}
          onClick={() => {
            if (confirm(`Restaurar as tabelas oficiais padrão de ${convenio.toUpperCase()}? As tabelas customizadas salvas serão removidas.`)) {
              restaurarPadrao();
              setVersaoAtivas(v => v + 1);
            }
          }}
        >↩️ Restaurar padrão</button>
      </div>

      {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: msg.startsWith('✅') ? '#052e16' : '#450a0a', color: msg.startsWith('✅') ? '#4ade80' : '#f87171', fontSize: '.82rem', fontWeight: 600 }}>{msg}</div>}
      </>)}
    </section>
  );
}
