// デモ版の入口：擬似サーバーをつないで、本物と同じ App を表示する
import { createRoot } from 'react-dom/client';
import { demoApi } from './mock';
import App from '../app/App';

(globalThis as any).__DEMO_API__ = demoApi;
// 埋め込み表示では confirm が使えないことがあるので、デモでは常に「はい」
window.confirm = () => true;

createRoot(document.getElementById('root')!).render(<App />);
