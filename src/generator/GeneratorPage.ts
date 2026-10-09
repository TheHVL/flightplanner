import { loadAipAerodromeCatalog, type AipAerodromeCatalog, type AipRefreshStatus } from '../aip/aerodromes';
import { radioFreshness, validateRadioCatalog, type RadioCatalog } from '../frequencies/catalog';
import { generatorFuelSettings } from './aircraft';
import { SCHOOL_C182T, SCHOOL_PRESET_DESCRIPTION } from '../performance/schoolPreset';
import { buildVfrRoutingInputs } from '../routing/vfrInputs';
import { escapeHtml as e } from '../utils/html';
import { generateRouteCandidates, INITIAL_GENERATOR_AIRPORTS, type AirportVisit, type GeneratorRequest, type RouteCandidate } from './candidates';
import { candidateReviewBlocksTransfer, reviewCandidates, type CandidateReview } from './review';
import { stageGeneratedRoute } from './transfer';
import { GeneratorMap } from './GeneratorMap';
import { terrainResolutionLabel } from './terrainSummary';
import { roundLegDistanceNm } from '../presentation/planningRounding';
import { northernAirports } from '../routing/northernAirports';
import { routeIssueMarkup } from '../presentation/routeIssues';
import { hasRestrictionCoverage } from '../routing/restrictions';

export class GeneratorPage {
  private readonly form: HTMLFormElement;
  private readonly map: GeneratorMap;
  private controller: AbortController | null = null;
  private version = 0;
  private catalog: AipAerodromeCatalog | null = null;
  private refresh: AipRefreshStatus | null = null;
  private request: GeneratorRequest | null = null;
  private candidates: RouteCandidate[] = [];
  private reviews: CandidateReview[] = [];
  private selected = '';
  private acknowledgedCandidate = '';
  private radioCatalog: RadioCatalog | null = null;
  private radioStatus: AipRefreshStatus | null = null;
  private visits: AirportVisit[] = [
    { icao: 'ENTC', activity: 'touch-and-go', count: 1, minutesEach: 5 },
    { icao: 'ENSR', activity: 'touch-and-go', count: 1, minutesEach: 5 },
  ];
  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<div class="generator-shell">
      <header class="topbar"><div class="brand-lockup"><div class="brand-mark">FP</div><div><div class="brand-title">FLIGHTPLANNER</div><div class="brand-subtitle">ROUTE GENERATOR · C182T</div></div></div>
        <nav class="planner-page-nav" aria-label="Planner pages"><a href="./">Manual planner</a><a href="generator.html" aria-current="page">Route Generator</a></nav></header>
      <div class="generator-intro"><h1>Build a training route</h1><p>For mainland airports from Trondheim (ENVA) northward. Choose your airport visits, then compare route drafts. Your manual plan stays as it is until you transfer a draft.</p></div>
      <div class="generator-workspace"><section class="generator-controls panel"><form id="generator-form">
        <h2>1. Airport route</h2><p class="hint">Mainland AIP airports at or north of Trondheim (ENVA included), sorted by ICAO. Terminal procedure coverage varies by airport.</p>
        <div class="generator-fields generator-airport-fields"><label>Departure<select name="departure">${this.airportOptions('ENDU')}</select></label><label>Finish at<select name="destination">${this.airportOptions('ENDU')}</select></label></div>
        <div class="generator-visits" data-generator-visits></div><button type="button" data-generator-add class="ghost-button">+ Add airport visit</button>
        <h2>2. Lesson</h2><div class="generator-fields"><label>Flight date<input name="flightDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
          <label>Target duration (min)<input name="lessonMinutes" type="number" min="20" max="240" step="5" value="90" required></label>
          <label>Preferred altitude (ft)<input name="altitudeFt" type="number" min="1000" max="10000" step="100" value="2500" required></label></div>
        <p class="hint">Duration includes flying and your selected patterns. Ground time is excluded. It is a target; the generator does not add holding or extra patterns to fill time.</p>
        <details class="menu-subsection" data-generator-aircraft><summary>C182T planning assumptions</summary><p class="hint">Still air, ISA at preferred altitude, the selected climb model and cruise Figure 5-9. These estimates need fresh weather and a final aircraft check.</p>
          <p class="hint">${SCHOOL_PRESET_DESCRIPTION}</p><button type="button" class="ghost-button" data-generator-school-preset>Apply school C182T preset</button>
          <div class="generator-fields"><label>Climb model<select name="climbModel"><option value="poh">POH full throttle · 90 KIAS</option><option value="school">School · 90 KIAS / 2400 RPM / 23 inHg</option></select></label>
            <label>School climb rate (ft/min)<input name="climbRateFpm" type="number" min="100" max="5000" step="50" value="500"></label>
            <label>School descent rate (ft/min)<input name="descentRateFpm" type="number" min="100" max="5000" step="50" value="700"></label>
            <label>School climb fuel flow (US gal/h)<input name="climbFuelFlowGph" type="number" min="0.1" max="40" step="0.1" placeholder="Needs confirmation"></label>
            <label>Cruise RPM<input name="rpm" type="number" min="2000" max="2400" step="100" value="2200"></label>
            <label>Manifold pressure (inHg)<input name="manifoldPressureInHg" type="number" min="15" max="27" step="1" value="20"></label>
            <label>Descent fuel flow (US gal/h)<input name="descentFuelFlowGph" type="number" min="0.1" max="30" step="0.1" value="10"></label>
            <label>Pattern fuel flow (US gal/h)<input name="patternFuelFlowGph" type="number" min="0.1" max="30" step="0.1" value="12"></label></div>
          <p class="hint">The school model uses cruise TAS in descent, 2 US gal ground allowance and 12 US gal reserve. Trip estimates exclude reserve, contingency, alternate and extra fuel. Enter school climb fuel flow to complete trip estimates and enable transfer when route checks pass. Rates and flows remain editable.</p></details>
        <button class="generator-primary" type="submit" data-generator-run>Generate route drafts</button>
      </form><p class="generator-status" data-generator-status role="status" aria-live="polite">Loading published airport data…</p><p class="hint" data-generator-edition></p></section>
      <section class="generator-preview"><div class="panel generator-map-heading"><h2>3. Compare drafts</h2><p class="hint">Select a draft below to preview it. Edit the chosen route in Manual Planner after transfer.</p></div>
        <div id="generator-map" aria-label="Generated route preview"></div><p class="hint">Map checks: red = detected conflict; amber = incomplete data or review required. Select “Show section on map” for the affected location.</p><div data-generator-candidates></div></section></div>
      <details class="generator-coverage panel"><summary>Sources, checks &amp; coverage</summary><p>Route sequences use checksum-verified AIP reporting points and available directional segment limits. Terrain search shapes inter-airport connectors. Terminal point sequences do not reproduce the full chart bends, airport joins or pattern tracks. Each needs chart review and any required ATC clearance.</p>
        <p>Route search uses a fresh Kartverket numeric terrain raster, normally sampled at 100 m, retaining the highest of four returned samples in each 200 m search cell. Larger itineraries use coarser samples. This is not the maximum of the native 1 m terrain model. It prefers lower terrain and simplifies grid turns only after checking the returned raster corridor. This coarse model can miss small peaks. Selected drafts then receive a separate terrain check: up to 0.5 NM sample spacing across a strip 1 NM either side. The 500 ft sampled margin is a training review reference, not automatic MSA. Samples within 3 NM of an airport are displayed separately for arrival/departure review. Peaks between samples, obstacles and NOTAM remain outside these checks.</p>
        <p>Airspace checks cover imported AIP terminal volumes, not Polaris radio-sector boundaries. FL/AGL limits need review. Missing data remain unknown. Water crossings and gliding distance to land need manual review. Terrain and AIP sources are checked afresh when you generate; no route is declared safe or cleared.</p>
        <p>Inter-airport search conservatively avoids all imported ENR 5.1 prohibited, restricted and danger-area footprints with a 250 m search allowance, regardless of altitude or activation. Unsupported geometry uses a labelled conservative review footprint. This allowance is not operational clearance. Activation, temporary restrictions and NOTAM must be checked separately; a route may be excluded even when an area is inactive.</p>
        <div data-generator-coverage-notes></div></details></div>`;
    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-generator-ack')) return;
      this.acknowledgedCandidate = target.checked ? this.selected : '';
      const review = this.reviews.find(r => r.candidate.id === this.selected);
      const button = root.querySelector<HTMLButtonElement>('[data-generator-transfer]');
      if (button) button.disabled = !target.checked || !review || candidateReviewBlocksTransfer(review) || !!this.controller;
    });
    this.form = root.querySelector<HTMLFormElement>('#generator-form')!;
    for (const name of ['departure', 'destination']) (this.form.elements.namedItem(name) as HTMLSelectElement).value = 'ENDU';
    this.map = new GeneratorMap(root.querySelector<HTMLElement>('#generator-map')!);
    this.renderVisits();
    this.form.addEventListener('submit', event => { event.preventDefault(); if (this.controller) this.invalidate('Generation cancelled.'); else void this.generate(); });
    this.form.addEventListener('input', () => this.invalidate());
    this.form.addEventListener('change', event => {
      this.invalidate();
      if ((event.target as HTMLElement).matches('[data-visit-activity]')) { this.readVisits(); this.renderVisits(); }
    });
    root.addEventListener('click', event => this.click(event));
    void this.initialSources();
  }
  private airportOptions(selected: string): string {
    return (this.catalog ? northernAirports(this.catalog).map(a => a.icao) : INITIAL_GENERATOR_AIRPORTS).map(code => `<option value="${code}" ${code === selected ? 'selected' : ''}>${code}${this.catalog ? ` · ${e(this.catalog.aerodromes.find(a => a.icao === code)?.name ?? '')}` : ''}</option>`).join('');
  }
  private renderVisits(): void {
    this.root.querySelector('[data-generator-visits]')!.innerHTML = this.visits.map((visit, i) => `<fieldset class="generator-visit" data-visit-index="${i}"><legend>Visit ${i + 1}</legend>
      <div class="generator-fields generator-airport-fields"><label>Airport<select data-visit-airport aria-label="Airport for visit ${i + 1}">${this.airportOptions(visit.icao)}</select></label>
        <label>Activity<select data-visit-activity aria-label="Activity at visit ${i + 1}">${[['touch-and-go','Touch-and-go'],['patterns','Pattern(s)']].map(([value,label]) => `<option value="${value}" ${value === visit.activity ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      ${visit.activity === 'patterns' ? `<div class="generator-fields"><label>Patterns<input data-visit-count type="number" min="1" max="20" step="1" value="${visit.count}"></label><label>Minutes per pattern<input data-visit-minutes type="number" min="1" max="30" step="0.5" value="${visit.minutesEach}"></label></div>` : ''}
      <div class="generator-visit-actions"><button type="button" data-visit-move="-1" aria-label="Move visit ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-visit-move="1" aria-label="Move visit ${i + 1} down" ${i === this.visits.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-visit-remove aria-label="Remove visit ${i + 1}">Remove</button></div></fieldset>`).join('');
    this.root.querySelectorAll<HTMLElement>('[data-visit-index]').forEach((row, i) => {
      row.querySelector<HTMLSelectElement>('[data-visit-airport]')!.value = this.visits[i].icao;
      row.querySelector<HTMLSelectElement>('[data-visit-activity]')!.value = this.visits[i].activity;
    });
    this.root.querySelector<HTMLButtonElement>('[data-generator-add]')!.disabled = this.visits.length >= 4;
  }
  private readVisits(): void {
    this.visits = [...this.root.querySelectorAll<HTMLElement>('[data-visit-index]')].map((row, i) => ({
      icao: row.querySelector<HTMLSelectElement>('[data-visit-airport]')!.value,
      activity: row.querySelector<HTMLSelectElement>('[data-visit-activity]')!.value as AirportVisit['activity'],
      count: row.querySelector<HTMLInputElement>('[data-visit-count]')?.valueAsNumber ?? this.visits[i].count,
      minutesEach: row.querySelector<HTMLInputElement>('[data-visit-minutes]')?.valueAsNumber ?? this.visits[i].minutesEach,
    }));
  }
  private readRequest(): GeneratorRequest {
    this.readVisits();
    const value = (name: string) => (this.form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
    return { departure: value('departure'), destination: value('destination'), visits: structuredClone(this.visits), flightDate: value('flightDate'),
      lessonMinutes: Number(value('lessonMinutes')), altitudeFt: Number(value('altitudeFt')), rpm: Number(value('rpm')),
      manifoldPressureInHg: Number(value('manifoldPressureInHg')), descentFuelFlowGph: Number(value('descentFuelFlowGph')), patternFuelFlowGph: Number(value('patternFuelFlowGph')), schoolPreset: value('climbModel') === 'school',
      climbRateFpm: Number(value('climbRateFpm')), descentRateFpm: Number(value('descentRateFpm')), climbFuelFlowGph: value('climbFuelFlowGph').trim() === '' ? null : Number(value('climbFuelFlowGph')) };
  }
  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
    if (button.hasAttribute('data-generator-school-preset')) {
      const values = { climbModel: 'school', rpm: SCHOOL_C182T.cruiseRpm, manifoldPressureInHg: SCHOOL_C182T.cruiseMp,
        climbRateFpm: SCHOOL_C182T.climbRateFpm, descentRateFpm: SCHOOL_C182T.descentRateFpm,
        descentFuelFlowGph: SCHOOL_C182T.descentFuelFlowGph, patternFuelFlowGph: SCHOOL_C182T.patternFuelFlowGph, climbFuelFlowGph: '' };
      for (const [name, value] of Object.entries(values)) (this.form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value = String(value);
      this.invalidate('School C182T preset applied. Enter the climb fuel flow in planning assumptions to complete trip fuel.');
      return;
    }
    if (button.hasAttribute('data-generator-add')) {
      this.readVisits(); if (this.visits.length >= 4) return;
      this.visits.push({ icao: this.visits.at(-1)?.icao === 'ENTC' ? 'ENSR' : 'ENTC', activity: 'touch-and-go', count: 1, minutesEach: 5 });
      this.invalidate(); this.renderVisits();
    }
    if (button.hasAttribute('data-visit-remove') || button.hasAttribute('data-visit-move')) {
      this.readVisits(); const index = Number(button.closest<HTMLElement>('[data-visit-index]')!.dataset.visitIndex);
      if (button.hasAttribute('data-visit-remove')) this.visits.splice(index, 1);
      else { const other = index + Number(button.dataset.visitMove); if (other >= 0 && other < this.visits.length) [this.visits[index], this.visits[other]] = [this.visits[other], this.visits[index]]; }
      this.invalidate(); this.renderVisits();
    }
    if (button.dataset.generatorSelect) { this.selected = button.dataset.generatorSelect; this.acknowledgedCandidate = ''; this.renderCandidates(); this.showMap(); }
    if (button.dataset.routeIssue) {
      const candidateId = button.closest<HTMLElement>('[data-candidate-id]')?.dataset.candidateId;
      const review = this.reviews.find(r => r.candidate.id === candidateId), issue = review?.issues.find(i => i.id === button.dataset.routeIssue);
      if (!review || !issue) return;
      if (this.selected !== review.candidate.id) this.acknowledgedCandidate = '';
      this.selected = review.candidate.id;
      if (button.dataset.issueAction === 'profile') {
        this.root.querySelector<HTMLDetailsElement>('[data-generator-aircraft]')!.open = true;
        this.form.querySelector<HTMLInputElement>('[name="rpm"]')!.focus();
      } else { this.renderCandidates(); this.showMap(); this.map.focusIssue(review.candidate, issue); }
    }
    if (button.hasAttribute('data-generator-transfer')) this.transfer();
  }
  private invalidate(message = 'Inputs changed. Generate new drafts for these settings.'): void {
    const hadResults = this.candidates.length || this.controller;
    this.version++; this.controller?.abort(); this.controller = null; this.request = null; this.reviews = []; this.candidates = []; this.selected = '';
    this.radioCatalog = null; this.radioStatus = null; this.acknowledgedCandidate = '';
    if (hadResults) { this.status(message); this.map.show([], ''); }
    this.root.querySelector('[data-generator-candidates]')!.innerHTML = '';
    this.runButton(false);
  }
  private async json(name: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(new URL(name, document.baseURI), { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`Published data unavailable (${response.status}).`);
    return response.json();
  }
  private async initialSources(): Promise<void> {
    try {
      const [catalog, refresh] = await Promise.all([loadAipAerodromeCatalog(true), this.json('aip-status.json')]);
      this.catalog = catalog; this.refresh = refresh as AipRefreshStatus;
      if (this.version !== 0) { this.refreshAirportMenus(); return; }
      const inputs = buildVfrRoutingInputs(catalog, this.refresh, this.readRequest().flightDate);
      this.status(inputs.usable ? 'Choose your lesson settings, then generate route drafts.' : 'AIP verification needs attention. Generate will retry the published data.');
      this.showSources();
      this.refreshAirportMenus();
    } catch (error) { if (this.version === 0) this.status(error instanceof Error ? error.message : 'Published data unavailable. Generate will retry.'); }
  }
  private refreshAirportMenus(): void {
    this.readVisits();
    for (const select of this.form.querySelectorAll<HTMLSelectElement>('select[name="departure"],select[name="destination"]')) {
      const selected = select.value; select.innerHTML = this.airportOptions(selected); select.value = selected;
    }
    this.renderVisits();
  }
  private async generate(): Promise<void> {
    this.acknowledgedCandidate = '';
    const version = ++this.version, controller = new AbortController(); this.controller = controller; this.runButton(true);
    this.candidates = []; this.reviews = []; this.selected = ''; this.request = null; this.renderCandidates(); this.map.show([], '');
    this.status('Checking current AIP data…');
    try {
      const request = this.readRequest();
      const [catalog, refresh] = await Promise.all([loadAipAerodromeCatalog(true), this.json('aip-status.json', controller.signal)]);
      if (version !== this.version) return;
      this.catalog = catalog; this.refresh = refresh as AipRefreshStatus; this.request = request;
      this.refreshAirportMenus();
      let radio: RadioCatalog | null = null;
      try {
        const [data, status] = await Promise.all([this.json('aip-frequencies.json', controller.signal), this.json('aip-frequency-status.json', controller.signal)]);
        validateRadioCatalog(data);
        if (radioFreshness(data, status as AipRefreshStatus, catalog, new Date(), request.flightDate).usable) {
          radio = data; this.radioCatalog = data; this.radioStatus = status as AipRefreshStatus;
        }
      } catch { controller.signal.throwIfAborted(); }
      if (version !== this.version) return;
      this.status('Loading terrain for route search…');
      const candidates = await generateRouteCandidates(request, catalog, this.refresh, new Date(), { signal: controller.signal,
        airspace: radio,
        progress: message => { if (version === this.version) this.status(message); } });
      if (version !== this.version) return;
      this.candidates = candidates; this.selected = this.candidates[0]?.id ?? '';
      if (!this.candidates.length) throw new Error('No draft combinations are available for this itinerary.');
      this.showSources(); this.renderCandidates(); this.showMap();
      this.status('Checking sampled terrain and terminal airspace…');
      const reviews = await reviewCandidates(this.candidates, request, radio, controller.signal, (done, total) => {
        if (version === this.version) this.status(`Checking terrain: ${done}/${total} points…`);
      });
      if (version !== this.version) return;
      this.reviews = reviews.slice(0, 3);
      this.candidates = this.reviews.map((r, i) => {
        r.candidate.name = i === 0 ? 'Terrain-based route' : `Alternative entry/exit route ${i}`;
        return r.candidate;
      });
      this.selected = this.candidates[0].id;
      const usable = this.reviews.filter(r => !candidateReviewBlocksTransfer(r)).length;
      this.status(usable ? `${usable} draft${usable === 1 ? '' : 's'} available for chart review. Review each leg’s notices before transferring.` : 'No draft meets the current checks. Restrictions are avoided at every altitude, even when inactive, which may exclude usable routes. The notices below identify affected legs, missing coverage and the next action.');
      this.showMap();
    } catch (error) { if (version === this.version) this.status(error instanceof Error ? error.message : 'Generation failed. Try again.'); }
    finally { if (version === this.version) { this.controller = null; this.runButton(false); this.renderCandidates(); } }
  }
  private showSources(): void {
    if (!this.catalog) return;
    this.root.querySelector('[data-generator-edition]')!.textContent = `AIP ${this.catalog.effectiveDate} · verified ${this.catalog.checkedAt ?? 'unknown'}`;
    const inputs = buildVfrRoutingInputs(this.catalog, this.refresh, this.request?.flightDate ?? this.readRequest().flightDate);
    this.root.querySelector('[data-generator-coverage-notes]')!.innerHTML = inputs.coverageWarnings.map(w => `<p>${e(w)}</p>`).join('');
  }
  private showMap(): void {
    this.map.show(this.candidates.slice(0, 3), this.selected, this.reviews.find(r => r.candidate.id === this.selected)?.issues ?? []);
  }
  private renderCandidates(): void {
    const output = this.root.querySelector('[data-generator-candidates]')!;
    output.innerHTML = this.candidates.slice(0, 3).map((candidate, i) => {
      const review = this.reviews.find(r => r.candidate.id === candidate.id), selected = candidate.id === this.selected;
      const blocked = !review || candidateReviewBlocksTransfer(review);
      const checkClass = review?.issues.some(issue => issue.severity === 'conflict') ? 'has-conflict' : blocked && review ? 'has-incomplete' : '';
      const delta = Math.round(candidate.durationDifference);
      return `<article class="panel generator-candidate ${selected ? 'is-selected' : ''}" data-candidate-id="${e(candidate.id)}">
        <button type="button" class="generator-candidate-choice" data-generator-select="${candidate.id}" aria-pressed="${selected}"><strong>${i + 1}. ${e(candidate.name)}</strong><span>${selected ? 'Selected preview' : 'Preview this draft'}</span></button>
        <div class="generator-metrics"><span><strong>${Math.round(candidate.totalMinutes)} min</strong>incl. ${Math.round(candidate.patternMinutes)} min pattern</span><span><strong title="Sum of displayed whole-NM legs; exact distance ${candidate.distanceNm.toFixed(2)} NM">${candidate.legs.reduce((sum, leg) => sum + roundLegDistanceNm(leg.distanceNm), 0)} NM</strong>plotted draft</span><span><strong>${candidate.fuelGal === null ? 'Unknown fuel' : `${candidate.fuelGal.toFixed(1)} US gal`}</strong>trip estimate</span></div>
        <p class="hint">${delta === 0 ? 'Matches the duration target after rounding.' : `${Math.abs(delta)} min ${delta > 0 ? 'above' : 'below'} your target.`} Still-air estimate.</p>
        <p class="generator-terrain-badge">${e(terrainResolutionLabel(candidate.searchTerrain))}</p>
        <p class="hint">Terrain search: ${candidate.searchTerrain.resolutionM} m grid · ${candidate.searchTerrain.highestRasterFt === null ? 'controlling transit terrain unknown' : `highest returned transit terrain ${Math.ceil(candidate.searchTerrain.highestRasterFt)} ft`}. Coarse samples can miss peaks.</p>
        <p class="generator-check-state ${checkClass}">${!review ? 'Checks pending. Transfer is unavailable.' : blocked ? `Transfer unavailable: ${review.issues.filter(issue => issue.blocksTransfer).length} notices need attention. Review the affected sections below.` : 'No blocking conflict found in the returned checks. Published procedures, activation and chart review remain required.'}</p>
        ${review ? `<p class="hint">${review.restrictionCoverageAvailable ? `${this.radioCatalog!.restrictionCoverage!.publishedAreaCount} published restriction footprints loaded; activation unknown.` : 'Published restriction coverage unavailable.'}</p>
          <div class="route-issues">${review.issues.slice(0, selected ? 3 : 1).map(issue => routeIssueMarkup(issue, candidate.legs, 'generator')).join('')}
          ${review.issues.length > (selected ? 3 : 1) ? `<details class="menu-subsection"><summary>Show ${review.issues.length - (selected ? 3 : 1)} more notices</summary>${review.issues.slice(selected ? 3 : 1).map(issue => routeIssueMarkup(issue, candidate.legs, 'generator')).join('')}</details>` : ''}</div>` : ''}
        ${review ? `<p class="hint">${review.missingHeights} missing heights · ${review.unknownAltitudes} unknown modeled altitudes · ${review.airportLowSamples} low-margin airport-area samples.${review.airspaceAvailable ? '' : ' Terminal airspace verification unavailable.'}</p>` : ''}
        ${selected ? `<details class="menu-subsection"><summary>Route points &amp; planned levels</summary><ol class="generator-leg-list">${candidate.legs.map(leg => `<li>${e(leg.from.name)} → ${e(leg.to.name)} <strong>${candidate.draft.plannedAltitudesFt.find(([key]) => key === `${leg.from.id}->${leg.to.id}`)?.[1] ?? '?'} ft</strong></li>`).join('')}</ol></details>
          <details class="menu-subsection"><summary>Review notes &amp; sources</summary>${candidate.sourceNotes.map(note => `<p>${e(note)}</p>`).join('')}
            ${candidate.reviewedEdges.map(edge => `<p><a href="${e(edge.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(edge.fromId)} → ${e(edge.toId)}</a>${edge.maxAltitudeFt === null ? ': chart altitude requires review.' : `: MAX ${edge.maxAltitudeFt} ft.`}</p>`).join('')}
            ${review ? `<p>Terrain fetched ${e(review.terrain.fetchedAt)}. ${review.minimumTransitMarginFt === null ? 'Transit altitude margin unknown.' : `Smallest returned transit margin: ${Math.round(review.minimumTransitMarginFt)} ft.`}</p>
              ${[...new Map(review.airspace.filter(a => ['intersects','review'].includes(a.relation)).map(a => [`${a.area.id}:${a.volume.publishedLimits}`, a])).values()].map(a => `<p><a href="${e(a.area.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(a.area.name)}</a> · ${e(a.volume.publishedLimits)} · ${a.relation === 'review' ? 'vertical reference needs review' : 'modeled altitude within published limits'}</p>`).join('')}` : ''}
          </details><p class="hint">Continue in Manual Planner to review chart joins, airspace, MSA and fresh weather.</p>
          <label class="generator-ack"><input type="checkbox" data-generator-ack ${this.acknowledgedCandidate === candidate.id ? 'checked' : ''} ${blocked || this.controller ? 'disabled' : ''}>I understand this is a starting point for chart review, not a cleared route. Terrain peaks and obstacles may be higher than the samples.</label>
          <button type="button" class="generator-primary" data-generator-transfer ${!review || blocked || this.controller || this.acknowledgedCandidate !== candidate.id ? 'disabled' : ''}>Use this route in Manual Planner</button>
          <p class="hint">Your current manual route will be replaced, with a recovery copy under Save &amp; load. Named saved plans stay unchanged.</p>` : ''}
      </article>`;
    }).join('');
  }
  private transfer(): void {
    const candidate = this.candidates.find(c => c.id === this.selected), review = this.reviews.find(r => r.candidate.id === this.selected);
    if (!candidate || !review || !this.request || this.controller || this.acknowledgedCandidate !== candidate.id || candidateReviewBlocksTransfer(review)) return;
    try {
      if (!this.catalog || !buildVfrRoutingInputs(this.catalog, this.refresh, this.request.flightDate).usable || Date.now() - Date.parse(review.terrain.fetchedAt) > 30 * 60000) throw new Error('These checks have expired. Generate fresh drafts before transferring.');
      if (!hasRestrictionCoverage(this.radioCatalog) || !radioFreshness(this.radioCatalog!, this.radioStatus, this.catalog, new Date(), this.request.flightDate).usable) throw new Error('Published airspace checks have expired. Generate fresh drafts before transferring.');
      const token = stageGeneratedRoute(candidate.draft, sessionStorage, Date.now(), generatorFuelSettings(this.request));
      const target = new URL('./', document.baseURI); target.searchParams.set('generatedRoute', token); location.assign(target.href);
    } catch (error) { this.status(error instanceof Error ? error.message : 'Transfer failed. Your manual plan was kept.'); }
  }
  private runButton(loading: boolean): void { this.root.querySelector<HTMLButtonElement>('[data-generator-run]')!.textContent = loading ? 'Cancel generation' : 'Generate route drafts'; }
  private status(message: string): void { this.root.querySelector('[data-generator-status]')!.textContent = message; }
}
