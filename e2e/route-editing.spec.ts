import { expect, test, type Page } from '@playwright/test';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { greatCircleDistanceNm } from '../src/navigation/geodesy';

async function loadRoute(page: Page, store: FlightPlanStore) {
  await page.goto('./');
  await page.evaluate(flightPlan => localStorage.setItem('flightplanner-working-route-v1', JSON.stringify({
    schemaVersion: 1, savedAtUtc: new Date().toISOString(), flightPlan, routeShapes: [],
  })), store.exportWorkingDraftState());
  await page.reload();
  await page.getByRole('button', {name:'I understand and want to continue'}).click();
}

test('waypoint handles reorder the route, with one undo and persistence after reload', async ({page}) => {
  const store=new FlightPlanStore(2500);
  for (const [i,name] of ['A','B','C'].entries()) store.addWaypoint({lat:69.1+i*.1,lon:18.5+i*.2},name);
  await loadRoute(page,store);
  const names=page.locator('.waypoint-name');
  const last=page.locator('.waypoint-card').nth(2);
  const bounds=await last.boundingBox();
  await page.locator('[data-drag-waypoint]').first().dragTo(last,{targetPosition:{x:60,y:bounds!.height-5}});
  await expect.poll(()=>names.evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(['B','C','A']);
  await expect(page.locator('.waypoint-reorder-status')).toContainText('position 3');
  await page.locator('[data-plan-undo]').click();
  await expect.poll(()=>names.evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(['A','B','C']);
  await page.locator('[data-plan-redo]').click();
  await page.reload();
  await page.getByRole('button', {name:'I understand and want to continue'}).click();
  await expect.poll(()=>names.evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(['B','C','A']);
});

test('a route-line click offers insertion between endpoints and preserves the split leg level', async ({page}) => {
  const store=new FlightPlanStore(2500);
  const a=store.addWaypoint({lat:69.2,lon:18.5},'A'), b=store.addWaypoint({lat:69.5,lon:19.4},'B');
  store.setPlannedAltitudeFt(a.id,b.id,3500);
  await loadRoute(page,store);
  const path=page.locator('#map .route-sector-line').first();
  const midpoint=await path.evaluate(element=>{
    const line=element as SVGPathElement, point=line.getPointAtLength(line.getTotalLength()/2);
    const screen=new DOMPoint(point.x,point.y).matrixTransform(line.getScreenCTM()!);
    return {x:screen.x,y:screen.y};
  });
  await page.mouse.click(midpoint.x,midpoint.y);
  await expect(page.getByRole('button',{name:'Add waypoint here'})).toBeVisible();
  await page.getByRole('button',{name:'Add waypoint here'}).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(3);
  await expect(page.locator('.waypoint-name').nth(0)).toHaveValue('A');
  await expect(page.locator('.waypoint-name').nth(2)).toHaveValue('B');
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).flightPlan);
  expect(state.plannedAltitudesFt.map((entry:[string,number])=>entry[1])).toEqual([3500,3500]);
  await page.locator('[data-plan-undo]').click();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await page.locator('[data-plan-redo]').click();
  await expect(page.locator('.waypoint-card')).toHaveCount(3);
});

test('airport routes have distinct colors through intermediate points and readable sidebar text', async ({page}) => {
  const store=new FlightPlanStore(2500);
  const points=[
    {name:'ENDU',lat:69.05583333,lon:18.54027778},
    {name:'POINT 1',lat:69.15,lon:18.7},
    {name:'ENAN',lat:69.2925,lon:16.14416667},
    {name:'POINT 2',lat:68.9,lon:15.4},
    {name:'ENLK',lat:68.1525,lon:13.60944444},
    {name:'POINT 3',lat:68.7,lon:16},
    {name:'ENDU',lat:69.05583333,lon:18.54027778},
  ];
  for (const point of points) {
    const wp=store.addWaypoint(point,point.name);
    if (point.name.startsWith('EN')) store.updateWaypoint(wp.id,{aipId:point.name,aipEffectiveDate:'2026-09-03'});
  }
  await loadRoute(page,store);
  const lines=page.locator('#map .route-sector-line');
  await expect(lines).toHaveCount(3);
  const colors=await lines.evaluateAll(paths=>paths.map(path=>path.getAttribute('stroke')));
  expect(new Set(colors).size).toBe(3);
  await page.getByText('Airport routes (3)',{exact:true}).click();
  await expect(page.locator('.route-sector-legend')).toContainText('ENDU → ENAN');
  await expect(page.locator('.route-sector-legend')).toContainText('ENAN → ENLK');
  await expect(page.locator('.route-sector-legend')).toContainText('ENLK → ENDU');
  const font=await page.locator('#route-panel .hint').evaluate(element=>parseFloat(getComputedStyle(element).fontSize));
  expect(font).toBeGreaterThanOrEqual(14);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.waypoint-name').first()).toBeVisible();
  const overflow=await page.locator('#planning-sidebar').evaluate(element=>element.scrollWidth-element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('OFP displays whole-NM leg distances and adds them for ACC and total', async ({page}) => {
  const store=new FlightPlanStore(2500);
  const nmPerDegree=greatCircleDistanceNm({lat:69,lon:18},{lat:70,lon:18});
  for (const [i,nm] of [0,5.7,12.9].entries()) store.addWaypoint({lat:69+nm/nmPerDegree,lon:18},`WP ${i+1}`);
  await loadRoute(page,store);
  const rows=page.locator('.ofp-table tbody tr[data-leg-from]');
  await expect(rows.nth(0).locator('td').nth(17)).toHaveText('6');
  await expect(rows.nth(1).locator('td').nth(17)).toHaveText('7');
  await expect(rows.nth(1).locator('td').nth(7)).toHaveText('13');
  await expect(page.locator('.route-total strong')).toHaveText('13 NM');
});

test('deleting waypoints keeps the list and sidebar at their editing position', async ({page}) => {
  const store = new FlightPlanStore(2500);
  for (let i = 0; i < 15; i++) store.addWaypoint({lat: 69.1 + i * .02, lon: 18.5 + i * .02}, `POINT ${i + 1}`);
  await loadRoute(page, store);
  const list = page.locator('.waypoint-list');
  const sidebar = page.locator('#planning-sidebar');
  await list.evaluate(element => { element.scrollTop = 650; });
  await page.getByRole('button', {name: 'Remove POINT 6', exact: true}).scrollIntoViewIfNeeded();
  const before = await list.evaluate(element => element.scrollTop);
  const sidebarBefore = await sidebar.evaluate(element => element.scrollTop);
  await page.getByRole('button', {name: 'Remove POINT 6', exact: true}).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(14);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(before);
  await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBe(sidebarBefore);
  await expect(page.getByRole('button', {name: 'Remove POINT 7', exact: true})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.waypoint-card')).toHaveCount(13);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(before);
  await page.locator('[data-plan-undo]').click();
  await expect(page.locator('.waypoint-card')).toHaveCount(14);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('button', {name: 'Remove POINT 15', exact: true}).click();
  const bottom = await list.evaluate(element => ({top: element.scrollTop, max: element.scrollHeight - element.clientHeight}));
  expect(bottom.top).toBe(bottom.max);
  expect(bottom.top).toBeGreaterThan(0);
  await expect(page.getByRole('button', {name: 'Remove POINT 14', exact: true})).toBeFocused();
});

test('waypoint list height supports dragging, keyboard and touch, and survives editing and reload', async ({page, context}) => {
  await page.setViewportSize({width: 1280, height: 1100});
  const store = new FlightPlanStore(2500);
  for (let i = 0; i < 12; i++) store.addWaypoint({lat: 69.1 + i * .02, lon: 18.5 + i * .02}, `POINT ${i + 1}`);
  await loadRoute(page, store);
  const list = page.locator('.waypoint-list');
  const handle = page.getByRole('separator', {name: 'Waypoint list height'});
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 + 120, {steps: 6});
  await page.mouse.up();
  await expect.poll(() => list.evaluate(element => element.clientHeight)).toBe(480);
  await handle.press('ArrowDown');
  await expect(handle).toHaveAttribute('aria-valuenow', '500');
  await expect(page.locator('[data-plan-undo]')).toBeDisabled();
  await page.getByRole('button', {name: 'Remove POINT 1', exact: true}).click();
  await expect.poll(() => list.evaluate(element => element.clientHeight)).toBe(500);
  await page.reload();
  await page.getByRole('button', {name: 'I understand and want to continue'}).click();
  await expect.poll(() => list.evaluate(element => element.clientHeight)).toBe(500);
  await handle.scrollIntoViewIfNeeded();
  const touchBounds = await handle.boundingBox();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {enabled: true});
  const point = {x: touchBounds!.x + touchBounds!.width / 2, y: touchBounds!.y + touchBounds!.height / 2, id: 1};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...point, y: point.y + 60}]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(handle).toHaveAttribute('aria-valuenow', '560');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('flightplanner-waypoint-list-height'))).toBe('560');
  await session.detach();
  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => list.evaluate(element => element.clientHeight)).toBe(560);
  expect(await page.locator('#planning-sidebar').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '360');
});

test('a route-line click stays open when the popup fits without moving the map', async ({page, context}) => {
  await page.setViewportSize({width: 1280, height: 1100});
  const store = new FlightPlanStore(2500);
  store.addWaypoint({lat: 69.65, lon: 18}, 'A');
  store.addWaypoint({lat: 69.7, lon: 18.8}, 'B');
  await loadRoute(page, store);
  const midpoint = await page.locator('#map .route-sector-line').first().evaluate(element => {
    const line = element as SVGPathElement, point = line.getPointAtLength(line.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(line.getScreenCTM()!);
    return {x: screen.x, y: screen.y};
  });
  await page.mouse.click(midpoint.x, midpoint.y);
  await expect(page.getByRole('button', {name: 'Add waypoint here'})).toBeVisible();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await page.locator('.leaflet-popup-close-button').click();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {enabled: true});
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...midpoint, id: 1}]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(page.getByRole('button', {name: 'Add waypoint here'})).toBeVisible();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await page.getByRole('button', {name: 'Add waypoint here'}).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(3);
  await expect(page.locator('.waypoint-name').first()).toHaveValue('A');
  await expect(page.locator('.waypoint-name').last()).toHaveValue('B');
  await session.detach();
});

test('touch dragging reorders waypoint handles without changing their coordinates', async ({page,context}) => {
  await page.setViewportSize({width:1280,height:1100});
  await page.addInitScript(()=>localStorage.setItem('flightplanner-sidebar-width','440'));
  const store=new FlightPlanStore(2500);
  const a=store.addWaypoint({lat:69.2,lon:18.5},'A'), b=store.addWaypoint({lat:69.5,lon:19.4},'B');
  await loadRoute(page,store);
  const source=await page.locator('[data-drag-waypoint]').nth(1).boundingBox();
  const target=await page.locator('.waypoint-card').first().boundingBox();
  const session=await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:source!.x+15,y:source!.y+20,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:target!.x+70,y:target!.y+10,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.waypoint-name').first()).toHaveValue('B');
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).flightPlan);
  expect(state.waypoints.map((p:{id:string,lat:number,lon:number})=>[p.id,p.lat,p.lon])).toEqual([[b.id,b.lat,b.lon],[a.id,a.lat,a.lon]]);
  await session.detach();
});

test('dragging a route line still shapes it, and insertion retains the remaining bend with undo', async ({page}) => {
  const store=new FlightPlanStore(2500);
  store.addWaypoint({lat:69.2,lon:18.5},'A'); store.addWaypoint({lat:69.5,lon:19.4},'B');
  await loadRoute(page,store);
  const track=await page.locator('tr[data-leg-from] td').nth(2).textContent();
  const pointOnLine=(fraction:number)=>page.locator('#map .route-sector-line').first().evaluate((element,part)=>{
    const line=element as SVGPathElement, point=line.getPointAtLength(line.getTotalLength()*part);
    const screen=new DOMPoint(point.x,point.y).matrixTransform(line.getScreenCTM()!);
    return {x:screen.x,y:screen.y};
  },fraction);
  const start=await pointOnLine(0.5);
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x+40,start.y+35,{steps:8}); await page.mouse.up();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await expect(page.locator('tr[data-leg-from] td').nth(2)).toHaveText(track!);
  const bend=await page.evaluate(()=>JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).routeShapes);
  expect(bend).toHaveLength(1);
  const insert=await pointOnLine(0.25); await page.mouse.click(insert.x,insert.y);
  await page.getByRole('button',{name:'Add waypoint here'}).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(3);
  const split=await page.evaluate(()=>JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).routeShapes);
  expect(split).toHaveLength(1); expect(split[0].coordinate).toEqual(bend[0].coordinate);
  await page.locator('[data-plan-undo]').click();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).routeShapes);
  expect(restored).toEqual(bend);
});
