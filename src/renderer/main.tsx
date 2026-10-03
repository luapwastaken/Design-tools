import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './shell/App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// a smoke pass (spec §12); loaded only then
const run = window.api.smokeRun;
if (run) void import('./smoke.ts').then((m) => m.runSmoke(run));
