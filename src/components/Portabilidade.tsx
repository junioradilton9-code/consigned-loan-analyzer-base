import { useState, useEffect, useMemo } from 'react';
import {
  TABELAS,
  CONVENIOS,
  datasComInfo,
  ehProjetada,
  prazosDisponiveis,
  formatarData,
  diagnosticarCobertura,
  type Convenio,
  type TabelaFator,
} from '../utils/coeficientes';
import { calcularTaxaMensal } from '../utils/financeiro';
import { fmtBRL, fmtPct, parseNum, formatarMoedaInput } from '../utils/format';

interface Props {
  saldoDevedorAuto: number;
  parcelaAuto: number;
  reloadKey?: number;
}

interface Resultado {
  tabela: TabelaFator;
  fator: number;
  txCet: number;
  primeiroVenc: string;
  valorBruto: number;
  totalFinanciado: number;
  troco: number;
  taxaAm: number;
  taxaAa: number;
  jurosTotais: number;
}

export default function Portabilidade({ saldoDevedorAuto, parcelaAuto, reloadKey = 0 }: Props) {
  const [convenio, setConvenio] = useState<Convenio>('governo');
  const [dataBase, setDataBase] = useState<string>('');
  const [prazo, setPrazo] = useState<number>(96);
  const [parcela, setParcela] = useState<string>('');
  const [saldo, setSaldo] = useState<string>('');
  const [auto, setAuto] = useState<boolean>(true);

  // reloadKey força re-leitura das tabelas quando o master substitui coeficientes
  const infoDatas = useMemo(() => datasComInfo(convenio), [convenio, reloadKey]);
  const datas = useMemo(() => infoDatas.map((d) => d.data), [infoDatas]);
  const oficiais = useMemo(
    () => infoDatas.filter((d) => !d.projetada),
    [infoDatas]
  );
  const projetadas = useMemo(
    () => infoDatas.filter((d) => d.projetada),
    [infoDatas]
  );
  const prazos = useMemo(() => prazosDisponiveis(convenio), [convenio, reloadKey]);
  const dataProjetada = dataBase ? ehProjetada(convenio, dataBase) : false;

  useEffect(() => {
    if (!datas.includes(dataBase)) setDataBase(datas[0] ?? '');
  }, [datas, dataBase]);

  useEffect(() => {
    if (!prazos.includes(prazo)) setPrazo(prazos[0] ?? 96);
  }, [prazos, prazo]);

  useEffect(() => {
    if (!auto) return;
    setSaldo(
      saldoDevedorAuto > 0.01
        ? formatarMoedaInput(String(Math.round(saldoDevedorAuto * 100)))
        : ''
    );
    setParcela(
      parcelaAuto > 0.01
        ? formatarMoedaInput(String(Math.round(parcelaAuto * 100)))
        : ''
    );
  }, [auto, saldoDevedorAuto, parcelaAuto]);

  const parcelaNum = parseNum(parcela);
  const saldoNum = parseNum(saldo) || 0;

  /** Quantas tabelas do convênio oferecem o prazo informado */
  function contarTabelasNoPrazo(conv: Convenio, p: number): number {
    return TABELAS[conv].filter(t => t.prazos.includes(p)).length;
  }

  /** Prazos disponíveis em cada tabela do convênio atual (para o aviso) */
  const resumoPrazos = useMemo(() => {
    const mapa = new Map<number, number>(); // prazo -> nº de tabelas
    TABELAS[convenio].forEach(t =>
      t.prazos.forEach(p => mapa.set(p, (mapa.get(p) || 0) + 1))
    );
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [convenio, reloadKey]);

  const resultados = useMemo<Resultado[]>(() => {
    if (!(parcelaNum > 0) || !dataBase) return [];
    const lista: Resultado[] = [];
    TABELAS[convenio].forEach((tab) => {
      const linha = tab.linhas.find((l) => l.dataBase === dataBase);
      const fator = linha?.fatores[prazo];
      if (!linha || !fator) return;
      const valorBruto = parcelaNum / fator - tab.tc;
      if (!(valorBruto > 0)) return;
      const totalFinanciado = parcelaNum * prazo;
      const taxaAm = calcularTaxaMensal(valorBruto, parcelaNum, prazo);
      lista.push({
        tabela: tab,
        fator,
        txCet: linha.txCet,
        primeiroVenc: linha.primeiroVenc,
        valorBruto,
        totalFinanciado,
        troco: valorBruto - saldoNum,
        taxaAm,
        taxaAa: Math.pow(1 + taxaAm, 12) - 1,
        jurosTotais: totalFinanciado - valorBruto,
      });
    });
    return lista.sort((a, b) => a.troco - b.troco);
  }, [convenio, dataBase, prazo, parcelaNum, saldoNum, reloadKey]);

  const convAtual = CONVENIOS.find((c) => c.id === convenio)!;

  const th: React.CSSProperties = {
    padding: '9px 10px',
    textAlign: 'left',
    fontWeight: 700,
    fontSize: '.72rem',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '9px 10px',
    whiteSpace: 'nowrap',
    fontSize: '.83rem',
  };

  return (
    <section className="card no-print">
      <h2>🔁 Portabilidade — Fatores Price (Coeficientes)</h2>

      <div className="abas">
        {CONVENIOS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`aba ${convenio === c.id ? 'aba-ativa' : ''}`}
            onClick={() => setConvenio(c.id)}
            title={`${TABELAS[c.id].length} tabela(s) no total • ${contarTabelasNoPrazo(c.id, prazo)} com ${prazo} meses`}
          >
            {c.icone} {c.nome}
            <span className="aba-qtd">
              {contarTabelasNoPrazo(c.id, prazo)}/{TABELAS[c.id].length}
            </span>
          </button>
        ))}
      </div>

      <p
        style={{
          fontSize: '.8rem',
          color: 'var(--cinza)',
          margin: '12px 0 14px',
          lineHeight: 1.55,
        }}
      >
        Mantendo a <b>parcela definida</b>, o sistema aplica o coeficiente de
        cada tabela para obter o <b>valor bruto liberado</b>, deduz o{' '}
        <b>saldo devedor</b> e apresenta o <b>troco final</b> — ordenado do{' '}
        <b>menor para o maior</b>.{' '}
        <span style={{ color: 'var(--verde-esc)', fontWeight: 600 }}>
          Fórmula: Parcela = (Valor Liberado + TC) × Fator
        </span>
        <br />
        {convAtual.oficial ? (
          <span style={{ color: 'var(--verde-ok)', fontWeight: 600 }}>
            ✅ Tabela oficial — {TABELAS[convenio][0]?.empregador ?? '—'} • TC: R${' '}
            {(TABELAS[convenio][0]?.tc ?? 0).toFixed(2).replace('.', ',')}
          </span>
        ) : (
          <span style={{ color: '#b45309', fontWeight: 600 }}>
            ⚠️ Tabela {convAtual.nome} estimada — aguardando os coeficientes
            oficiais.
          </span>
        )}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '.82rem',
            fontWeight: 600,
            color: 'var(--verde-esc)',
            cursor: 'pointer',
            background: auto ? '#dcfce7' : '#f1f5f9',
            padding: '7px 13px',
            borderRadius: 8,
            border: auto
              ? '1px solid var(--verde-ok)'
              : '1px solid var(--borda)',
          }}
        >
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            style={{ width: 'auto', cursor: 'pointer' }}
          />
          ✨ Usar saldo devedor e parcela dos contratos cadastrados
        </label>
      </div>

      <div className="form-grid">
        <div>
          <label htmlFor="pbDataBase">
            📅 Data base do coeficiente
            {dataProjetada && (
              <span
                style={{
                  fontWeight: 400,
                  textTransform: 'none',
                  marginLeft: 4,
                  color: '#b45309',
                }}
              >
                (projetada)
              </span>
            )}
          </label>
          <select
            id="pbDataBase"
            value={dataBase}
            onChange={(e) => setDataBase(e.target.value)}
            className="select-campo"
            style={
              dataProjetada
                ? { borderColor: '#fbbf24', background: '#fffbeb' }
                : undefined
            }
          >
            <optgroup label={`✅ Tabela oficial (${oficiais.length})`}>
              {oficiais.map((d) => (
                <option key={d.data} value={d.data}>
                  {formatarData(d.data)}
                </option>
              ))}
            </optgroup>
            <optgroup label={`📈 Projetadas +2 anos (${projetadas.length})`}>
              {projetadas.map((d) => (
                <option key={d.data} value={d.data}>
                  {formatarData(d.data)} •
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label htmlFor="pbPrazo">⏱️ Prazo</label>
          <select
            id="pbPrazo"
            value={prazo}
            onChange={(e) => setPrazo(Number(e.target.value))}
            className="select-campo"
          >
            {prazos.map((p) => (
              <option key={p} value={p}>
                {p} meses
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pbParcela">
            Parcela definida *
            {auto && <span className="tag-auto">(automático)</span>}
          </label>
          <input
            type="text"
            id="pbParcela"
            placeholder="R$ 0,00"
            inputMode="numeric"
            value={parcela}
            onChange={(e) => {
              setParcela(formatarMoedaInput(e.target.value));
              setAuto(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="pbSaldo">
            Saldo devedor a quitar
            {auto && <span className="tag-auto">(automático)</span>}
          </label>
          <input
            type="text"
            id="pbSaldo"
            placeholder="R$ 0,00"
            inputMode="numeric"
            value={saldo}
            onChange={(e) => {
              setSaldo(formatarMoedaInput(e.target.value));
              setAuto(false);
            }}
          />
        </div>
      </div>

      {dataProjetada && (
        <div
          style={{
            marginTop: 14,
            background: '#fffbeb',
            border: '1px solid #fbbf24',
            color: '#854d0e',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '.8rem',
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          📈 <b>Data projetada</b> — coeficiente extrapolado a partir da taxa
          implícita da tabela oficial, ajustado pela carência até o 1º
          vencimento. Use como estimativa; confirme com a tabela vigente do
          banco na data da operação.
        </div>
      )}

      {!(parcelaNum > 0) && (
        <div
          style={{
            marginTop: 14,
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e40af',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '.83rem',
            fontWeight: 600,
          }}
        >
          ℹ️ Informe o valor da parcela para calcular os coeficientes.
        </div>
      )}

      {parcelaNum > 0 && resultados.length === 0 && (
        <div
          style={{
            marginTop: 14,
            background: '#fef9c3',
            border: '1px solid #fde047',
            color: '#854d0e',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '.83rem',
            fontWeight: 600,
          }}
        >
          ⚠️ Nenhuma tabela de <b>{convAtual.nome}</b> disponível para <b>{prazo} meses</b> em <b>{formatarData(dataBase)}</b>.
          {/* Diagnóstico por tabela: mostra o motivo exato */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '.78rem' }}>
              🔎 Ver por que cada tabela não apareceu
            </summary>
            <div style={{ marginTop: 6, display: 'grid', gap: 3, fontWeight: 500, fontSize: '.75rem' }}>
              {diagnosticarCobertura(convenio, dataBase, prazo).map(d => (
                <div key={d.codigo}>
                  <b>{d.codigo}</b>: {d.motivo === 'ok'
                    ? <span style={{ color: '#15803d' }}>ok</span>
                    : <span style={{ color: '#b45309' }}>{d.motivo}</span>}
                </div>
              ))}
            </div>
          </details>
          {resumoPrazos.length > 0 && (
            <div style={{ marginTop: 8, fontWeight: 500 }}>
              Prazos disponíveis neste convênio:{' '}
              {resumoPrazos.map(([p, qtd], i) => (
                <span key={p}>
                  {i > 0 && ' • '}
                  <button
                    type="button"
                    onClick={() => setPrazo(p)}
                    style={{
                      background: '#fff', border: '1px solid #d97706', color: '#92400e',
                      borderRadius: 6, padding: '2px 9px', fontSize: '.78rem', fontWeight: 800,
                      cursor: 'pointer', boxShadow: 'none',
                    }}
                  >
                    {p} meses ({qtd})
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {resultados.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3
            style={{
              fontSize: '.92rem',
              color: 'var(--verde-esc)',
              marginBottom: 4,
            }}
          >
            💰 {formatarData(dataBase)} — 1º vencimento{' '}
            {formatarData(resultados[0].primeiroVenc)}
          </h3>
          <p
            style={{
              fontSize: '.76rem',
              color: 'var(--cinza)',
              marginBottom: 10,
            }}
          >
            Parcela fixa de <b>{fmtBRL(parcelaNum)}</b> em <b>{prazo}x</b> •
            saldo devedor deduzido: <b>{fmtBRL(saldoNum)}</b> •{' '}
            <b>{resultados.length}</b> de <b>{TABELAS[convenio].length}</b> tabela(s) do convênio
            {resultados.length < TABELAS[convenio].length && (
              <> — as demais não têm o prazo de {prazo} meses</>
            )}
          </p>

          <div className="tabela-wrap">
            <table className="tabela-coef">
              <thead>
                <tr>
                  <th style={th}>Convênio</th>
                  <th style={th}>Coeficiente</th>
                  <th style={th}>Valor bruto</th>
                  <th style={th}>(−) Saldo devedor</th>
                  <th style={th}>💰 Troco final</th>
                  <th style={th}>Taxa a.m.</th>
                  <th style={th}>CET a.a.</th>
                  <th style={th}>Total financiado</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r, idx) => {
                  const melhor = idx === resultados.length - 1;
                  const negativo = r.troco < 0;
                  return (
                    <tr
                      key={r.tabela.id}
                      style={{
                        background: melhor
                          ? '#ecfdf5'
                          : idx % 2 === 0
                          ? '#f8fafc'
                          : '#fff',
                      }}
                    >
                      <td style={td}>
                        <b>{r.tabela.codigo}</b>
                        <div
                          style={{
                            fontSize: '.67rem',
                            color: 'var(--cinza)',
                            fontWeight: 600,
                          }}
                        >
                          {r.tabela.nome}
                        </div>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>
                        {r.fator.toFixed(5).replace('.', ',')}
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {fmtBRL(r.valorBruto)}
                      </td>
                      <td style={{ ...td, color: 'var(--vermelho)' }}>
                        −{fmtBRL(saldoNum)}
                      </td>
                      <td
                        style={{
                          ...td,
                          fontWeight: 800,
                          fontSize: '.92rem',
                          color: negativo
                            ? 'var(--vermelho)'
                            : melhor
                            ? 'var(--verde-ok)'
                            : 'var(--ouro)',
                        }}
                      >
                        {negativo ? '−' : ''}
                        {fmtBRL(Math.abs(r.troco))}
                        {melhor && !negativo && ' 🏆'}
                      </td>
                      <td style={td}>{fmtPct(r.taxaAm, 2)}</td>
                      <td style={td}>
                        {r.txCet > 0
                          ? r.txCet.toFixed(2).replace('.', ',') + '%'
                          : fmtPct(r.taxaAa, 2)}
                      </td>
                      <td style={{ ...td, color: 'var(--cinza)' }}>
                        {fmtBRL(r.totalFinanciado)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p
            style={{
              fontSize: '.75rem',
              color: 'var(--cinza)',
              marginTop: 10,
              lineHeight: 1.55,
            }}
          >
            🏆 A última linha (maior troco) é a opção mais vantajosa. Valores em{' '}
            <b style={{ color: 'var(--vermelho)' }}>vermelho</b> indicam que o
            valor bruto não cobre o saldo devedor. <br />
            📌 Coeficientes válidos para a data base selecionada — tabelas
            sujeitas a alteração sem prévio aviso.
          </p>
        </div>
      )}

      <style>{`
        .abas{display:inline-flex;gap:5px;flex-wrap:wrap;background:#eef2f7;
          padding:5px;border-radius:14px;box-shadow:inset 0 1px 3px rgba(15,23,42,.06)}
        .aba{background:transparent;color:var(--cinza);border-radius:10px;padding:10px 18px;
          font-size:.85rem;font-weight:650;border:none;box-shadow:none;
          display:flex;align-items:center;gap:8px;transition:all .22s cubic-bezier(.4,0,.2,1)}
        .aba:hover{background:rgba(255,255,255,.7);color:var(--verde-med);transform:none}
        .aba-ativa,.aba-ativa:hover{background:#fff;color:var(--verde-esc);
          box-shadow:0 2px 8px rgba(2,44,34,.12),0 0 0 1px rgba(16,185,129,.14)}
        .aba-qtd{background:rgba(100,116,139,.14);border-radius:999px;padding:2px 8px;
          font-size:.66rem;font-weight:750}
        .aba-ativa .aba-qtd{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#422006}

        .select-campo{width:100%;padding:12px 14px;border:1.5px solid var(--borda);
          border-radius:11px;font-size:.95rem;background:#fbfcfe;color:var(--texto);
          font-family:inherit;cursor:pointer;font-weight:500;
          transition:border-color .18s,box-shadow .18s,background .18s;
          appearance:none;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
          background-repeat:no-repeat;background-position:right 13px center;padding-right:38px}
        .select-campo:hover{border-color:#cfe0d8}
        .select-campo:focus{outline:none;border-color:var(--verde);background-color:#fff;
          box-shadow:0 0 0 4px rgba(16,185,129,.13)}

        .tag-auto{font-weight:500;text-transform:none;margin-left:5px;color:var(--verde-ok);
          letter-spacing:0}

        .tabela-wrap{overflow-x:auto;border:1px solid var(--borda);border-radius:14px;
          background:#fff;box-shadow:var(--sombra-sm)}
        .tabela-coef{width:100%;border-collapse:separate;border-spacing:0;min-width:920px}
        .tabela-coef thead tr{background:linear-gradient(120deg,#043d2f,#065f46 70%,#0f766e);
          color:#fff}
        .tabela-coef thead th{letter-spacing:.06em;position:sticky;top:0;
          border-bottom:2px solid rgba(251,191,36,.3)}
        .tabela-coef tbody tr{border-top:1px solid var(--borda);transition:background .16s}
        .tabela-coef tbody tr:hover{background:#f0fdf9 !important}
        .tabela-coef tbody td{border-top:1px solid #eef2f7;font-variant-numeric:tabular-nums}
        .tabela-coef tbody tr:last-child td:first-child{border-bottom-left-radius:13px}
        .tabela-coef tbody tr:last-child td:last-child{border-bottom-right-radius:13px}
      `}</style>
    </section>
  );
}
