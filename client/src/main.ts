// Bundled locally so the game paints instantly and works offline (desktop/iOS apps).
import '@fontsource/baloo-2/500.css';
import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import './styles.css';
import { Game } from './core/Game';

const game = new Game(document.getElementById('app')!);
void game.start();
// Exposed for debugging in the console / automated checks.
(window as unknown as { game: Game }).game = game;
