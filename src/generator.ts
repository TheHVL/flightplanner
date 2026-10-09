import './styles.css';
import './generator.css';
import './routeIssues.css';
import './readability.css';
import { GeneratorPage } from './generator/GeneratorPage';

const root = document.querySelector<HTMLElement>('#generator-app');
if (!root) throw new Error('Route Generator root is missing.');
new GeneratorPage(root);
