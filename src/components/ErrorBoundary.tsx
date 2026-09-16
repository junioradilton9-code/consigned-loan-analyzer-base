import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  erro: Error | null;
  stack: string;
}

/**
 * Captura qualquer erro de renderização e mostra uma tela de recuperação
 * em vez de uma página em branco. Também registra o erro no console para
 * diagnóstico.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null, stack: '' };

  static getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ERRO DO APP]', erro, info.componentStack);
    this.setState({ stack: info.componentStack || '' });
  }

  recarregar() {
    window.location.reload();
  }

  limparDadosELimparSessao() {
    try {
      // Remove apenas as chaves do app (mantém outros sites)
      Object.keys(localStorage)
        .filter((k) => k.startsWith('consig_'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    window.location.reload();
  }

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{
          maxWidth: 520,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: 28,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 10px', color: '#f8fafc' }}>
            Ocorreu um erro ao carregar o aplicativo
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.6 }}>
            Isso não impede seus dados (que ficam salvos no navegador/nuvem). Tente recarregar;
            se persistir, limpe os dados locais do aplicativo e entre novamente.
          </p>
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            color: '#f87171',
            textAlign: 'left',
            maxHeight: 120,
            overflow: 'auto',
            fontFamily: 'monospace',
            marginBottom: 16,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {this.state.erro.message}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => this.recarregar()}
              style={{
                background: '#10b981',
                color: '#052e16',
                border: 'none',
                borderRadius: 10,
                padding: '11px 22px',
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >🔄 Recarregar</button>
            <button
              onClick={() => this.limparDadosELimparSessao()}
              style={{
                background: '#334155',
                color: '#e2e8f0',
                border: '1px solid #475569',
                borderRadius: 10,
                padding: '11px 22px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >🧹 Limpar dados locais e recarregar</button>
          </div>
        </div>
      </div>
    );
  }
}
