import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root element.');
}

root.innerHTML = `
  <main class="bootstrap-shell">
    <section>
      <p class="eyebrow">VFR FLIGHT PLANNING</p>
      <h1>Flightplanner</h1>
      <p>Project foundation initialized. Route planning modules are added in Phase 1.</p>
    </section>
  </main>
`;
