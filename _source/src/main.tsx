import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// Surface unhandled promise rejections in console so they don't die silently.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[CompanyTree] unhandled promise rejection:', e.reason);
});
window.addEventListener('error', (e) => {
  console.error('[CompanyTree] window error:', e.error ?? e.message);
});

async function boot() {
  // Wait for Roboto to load so layout measurements match PDF output.
  try {
    if ('fonts' in document) {
      await Promise.all([
        (document as any).fonts.load('12px "Roboto"'),
        (document as any).fonts.load('bold 12px "Roboto"'),
      ]);
    }
  } catch { /* non-fatal */ }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
boot();
