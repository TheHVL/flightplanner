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
  await expect(page.locator('#working-route-status')).toContainText('restored');
});

for (const entry of ['./', 'generator.html']) {
  test(`${entry} exposes labeled controls without automated accessibility violations`, async ({ page }) => {
    await page.goto(entry);
    if (entry === './') await page.getByRole('button', { name: 'I understand and want to continue' }).click();
    else {
      await expect(page.locator('[name="departure"] option[value="ENVA"]')).toHaveCount(1);
      await expect(page.locator('[name="altitudeFt"]')).toHaveValue('2500');
      await expect(page.locator('.generator-intro')).toContainText('Trondheim');
    }
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  });
}
