import React from 'react';
import { createRoot } from 'react-dom/client';
import RootGame from '../app/root-game';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><RootGame/></React.StrictMode>);

