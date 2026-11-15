import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { registraHook } from './sincronizza';

// date di modifica, eliminazioni e id unici: servono a condividere i dati tra dispositivi
registraHook();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
