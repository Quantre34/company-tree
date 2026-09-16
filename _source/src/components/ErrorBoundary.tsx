import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[CompanyTree] runtime error:', error, info);
    this.setState({ info: info.componentStack ?? null });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        padding: 32, maxWidth: 780, margin: '40px auto',
        fontFamily: "Inter, 'Segoe UI', Arial, sans-serif", color: '#1B2332',
      }}>
        <h2 style={{ color: '#C8102E', marginTop: 0 }}>Bir şeyler ters gitti</h2>
        <p>Uygulama beklenmedik bir hatayla karşılaştı. Ayrıntı:</p>
        <pre style={{
          background: '#F5F7FA', padding: 12, borderRadius: 8,
          border: '1px solid #E4E7EC', overflow: 'auto', fontSize: 12, lineHeight: 1.5,
        }}>{String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
{this.state.info ?? ''}</pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={this.reset}
            style={{ padding: '8px 14px', background: '#1F3B73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >Devam Et</button>
          <button
            onClick={() => location.reload()}
            style={{ padding: '8px 14px', background: '#fff', color: '#1F3B73', border: '1px solid #CBD1DA', borderRadius: 6, cursor: 'pointer' }}
          >Sayfayı Yenile</button>
        </div>
        <p style={{ marginTop: 20, fontSize: 12, color: '#6B7280' }}>
          Bu hata konsola da yazıldı. Tekrar oluşursa geliştiriciye stack trace'i iletin.
        </p>
      </div>
    );
  }
}
