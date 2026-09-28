/**
 * main.tsx — entry point. Loads styles and fonts, installs the tooltip
 * system, and renders <App/> into #app.
 */

import { render } from 'preact';
import './ui/styles/themes.css';
import './ui/styles/base.css';
import './ui/styles/layout.css';
import './ui/styles/board.css';
import './ui/styles/panels.css';
import './ui/styles/screens.css';
import { registerFonts } from './ui/fonts.ts';
import { installTooltips } from './ui/tooltip.ts';
import { App } from './app/App.tsx';

registerFonts();
installTooltips();
render(<App />, document.getElementById('app')!);
