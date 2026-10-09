import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('new manual legs default to 2500 ft, undo/redo and autosave survive reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  const map = page.locator('#map');
  await map.click({ position: { x: 220, y: 200 } });
  await map.click({ position: { x: 330, y: 300 } });
  await expect(page.locator('[data-plan-undo]')).toBeEnabled();
  await expect(page.locator('#working-route-status')).toContainText('Saved locally');
  await page.locator('[data-panel-key="leg-entry"] > summary').click();
  await expect(page.locator('input[data-leg-field="pl"]')).toHaveValue('2500');
  await page.locator('[data-plan-undo]').click();
  await expect(page.locator('[data-plan-redo]')).toBeEnabled();
  await page.locator('[data-plan-redo]').click();
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await expect(page.locator('input[data-leg-field="pl"]')).toHaveValue('2500');
  await expect(page.locator('#working-route-status')).toContainText(/restored|Saved locally/);
});

test('manual planner exposes labeled controls without automated accessibility violations', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await expect(page.getByRole('link', { name: 'Route Generator' })).toHaveCount(0);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('former generator bookmarks open the manual planner and preserve the working route', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('./');
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await page.locator('#map').click({ position: { x: 220, y: 200 } });
  await page.locator('#map').click({ position: { x: 330, y: 300 } });
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await expect(page.locator('#working-route-status')).toContainText('Saved locally');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!));
  await page.goto('generator.html');
  await expect(page).toHaveURL(/\/flightplanner\/$/);
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Route Generator' })).toHaveCount(0);
  await expect(page.locator('#generator-app')).toHaveCount(0);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!));
  expect(after.flightPlan).toEqual(before.flightPlan);
  expect(after.routeShapes).toEqual(before.routeShapes);
  expect(requests.some(url => /\/assets\/generator-|\/src\/generator\.ts|wcs\.geonorge\.no/.test(url))).toBe(false);
});
