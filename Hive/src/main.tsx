import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './app/HomePage';
import 'xterm/css/xterm.css';
import './app/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HomePage />
  </React.StrictMode>
);
