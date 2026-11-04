import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('The application could not render.', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <main className="grid min-h-screen place-items-center bg-[#f5f7fb] p-6 text-center">
        <section className="max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-navy">This page could not be displayed</h1>
          <p className="mt-2 text-sm text-slate-600">Reload the page to try again. If the problem continues, check the browser console for details.</p>
          <button type="button" onClick={() => window.location.reload()} className="primary-action mt-5 rounded-lg px-4 py-2 text-sm font-semibold">Reload page</button>
        </section>
      </main>;
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
