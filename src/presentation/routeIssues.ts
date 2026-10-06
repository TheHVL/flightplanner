import type { RouteLeg } from '../types';
import { issueSeverityLabel, type RouteIssue } from '../routing/issues';
import { escapeHtml as e } from '../utils/html';

export function routeIssueMarkup(issue: RouteIssue, legs: RouteLeg[], context: 'manual' | 'generator'): string {
  const leg = legs.find(l => l.index === issue.legIndex);
  const edit = context === 'manual' && leg && issue.focus && issue.focus !== 'profile';
  return `<article class="route-issue route-issue-${issue.severity}" data-issue-id="${e(issue.id)}">
    <p class="route-issue-label">${issueSeverityLabel(issue.severity)}${leg ? ` · Leg ${leg.index + 1}: ${e(leg.from.name)} → ${e(leg.to.name)}` : ''}</p>
    <strong>${e(issue.title)}</strong><p>${e(issue.detail)}</p><p class="route-issue-action"><strong>Next action:</strong> ${e(issue.action)}</p>
    <div class="route-issue-buttons">
      ${leg ? `<button type="button" class="ghost-button" data-route-issue="${e(issue.id)}" data-issue-action="map">Show section on map</button>` : ''}
      ${edit ? `<button type="button" class="ghost-button" data-route-issue="${e(issue.id)}" data-issue-action="edit">${issue.focus === 'frequency' ? 'Review leg frequency' : 'Review leg altitude'}</button>` : ''}
      ${issue.focus === 'profile' ? `<button type="button" class="ghost-button" data-route-issue="${e(issue.id)}" data-issue-action="profile">Review aircraft/profile settings</button>` : ''}
      ${issue.sourceUrl ? `<a href="${e(issue.sourceUrl)}" target="_blank" rel="noopener noreferrer">Published source</a>` : ''}
    </div></article>`;
}
