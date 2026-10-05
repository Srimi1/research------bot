import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { browserAPI } from './browser-api';
import './styles.css';

if (!window.research) window.research = browserAPI;

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
