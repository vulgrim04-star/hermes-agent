import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

/*
 * L'application s'ouvre sans réseau une fois visitée : le journal est déjà
 * local, il n'y avait aucune raison que le code ne le soit pas.
 *
 * L'enregistrement attend le chargement : un service worker qui s'installe
 * pendant que la page démarre se dispute la bande passante avec elle, et le
 * premier affichage est ce qui compte le plus.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* refusé (page servie en http, navigation privée) : l'application marche,
         simplement pas hors ligne */
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
