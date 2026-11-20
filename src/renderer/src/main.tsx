import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/app.css';
import { App } from './App';
import { useApp, documentForSave } from './store/app';
import { useSim } from './store/sim';
import * as commands from './commands';
import * as engines from './engines';
import * as project from '@core/project';
import * as circuitEdit from './circuitEdit';
import * as sweep from './store/sweep';
import * as library from './library/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Dev/QA handle for automated UI checks. Production builds only expose it when an unpackaged
// build is launched with `--obw-qa` (main adds ?qa=1 to the page URL).
if (import.meta.env.DEV || new URLSearchParams(location.search).get('qa') === '1') {
  (window as unknown as { __obw: unknown }).__obw = { useApp, useSim, commands, engines, project, circuitEdit, documentForSave, sweep, library };
}
