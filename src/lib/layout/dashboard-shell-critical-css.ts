/**
 * First-paint dashboard + Knowledge shell styles inlined in root layout <head>.
 * Subset of globals.css semantic classes — prevents FOUC before layout.css loads.
 */
export const DASHBOARD_SHELL_CRITICAL_CSS = `
html {
  min-height: 100%;
  background-color: var(--color-crm-bg, #f5f7fa);
  color-scheme: light;
}
body {
  margin: 0;
  font-family: var(--font-geist-sans, var(--font-sans, system-ui)), system-ui, sans-serif;
  color: var(--color-crm-text, #172033);
  background-color: var(--color-crm-bg, #f5f7fa);
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a {
  color: var(--color-crm-primary, #2f6fb3);
  text-decoration: none;
}
button,
input,
textarea,
select {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
nav ul,
aside ul,
.mobile-bottom-nav ul,
[data-lifecycle-list],
[data-lifecycle-list] ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
h1,
h2,
h3,
p {
  margin: 0;
}
.dashboard-shell,
.crm-app-bg {
  background-color: var(--color-crm-bg, #f5f7fa);
  min-height: 100dvh;
}
.crm-main-content {
  background-color: var(--color-crm-content-bg, var(--color-crm-bg, #f5f7fa));
}
.surface-panel,
.surface-card,
.interactive-card {
  background: var(--color-crm-card, #ffffff);
  border: 1px solid var(--color-crm-border, #e3e8f0);
  border-radius: var(--radius-crm-lg, 1rem);
}
.surface-sidebar {
  background: var(--color-crm-sidebar, #f7f9fc);
  border-right: 1px solid var(--color-crm-border, #e3e8f0);
}
.page-header {
  margin-bottom: 1.5rem;
}
.page-title {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-crm-text, #172033);
  line-height: 1.3;
}
.page-description {
  margin-top: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-crm-text-secondary, #6b7890);
}
.crm-text {
  color: var(--color-crm-text, #172033);
}
.crm-text-secondary {
  color: var(--color-crm-text-secondary, #6b7890);
}
.crm-link,
.link-primary {
  color: var(--color-crm-primary, #2f6fb3);
}
.primary-button {
  background: var(--color-crm-primary, #2f6fb3);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-crm, 0.75rem);
}
.secondary-button {
  background: var(--color-crm-card, #ffffff);
  color: var(--color-crm-text, #172033);
  border: 1px solid var(--color-crm-border, #e3e8f0);
  border-radius: var(--radius-crm, 0.75rem);
}
.nav-item {
  color: var(--color-crm-text-secondary, #6b7890);
  border-radius: var(--radius-crm, 0.75rem);
}
.nav-active {
  background: var(--color-crm-primary, #2f6fb3);
  color: #ffffff;
  border-radius: var(--radius-crm, 0.75rem);
}
.mobile-bottom-nav {
  background: var(--color-crm-card, #ffffff);
  border-top: 1px solid var(--color-crm-border, #e3e8f0);
}
.mobile-nav-active {
  background: var(--color-crm-primary, #2f6fb3);
  color: #ffffff;
}
.mobile-nav-inactive {
  color: var(--color-crm-text-secondary, #6b7890);
}
.status-badge,
.badge-default {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-crm-bg-muted, #eef3f8);
  color: var(--color-crm-text, #172033);
  border: 1px solid var(--color-crm-border, #e3e8f0);
}
.badge-accent {
  background: var(--color-crm-primary-soft, #e8f1fa);
  color: var(--color-crm-primary-deep, #1f4e79);
  border: 1px solid var(--color-crm-border, #e3e8f0);
}
.crm-spinner {
  border: 2px solid var(--color-crm-border, #e3e8f0);
  border-top-color: var(--color-crm-primary, #2f6fb3);
  border-radius: 9999px;
}
.knowledge-route-skeleton {
  border-radius: 0.75rem;
  background: var(--color-crm-bg-muted, #eef3f8);
  animation: knowledge-route-skeleton-pulse 1.4s ease-in-out infinite;
}
.knowledge-route-skeleton--title {
  height: 1.5rem;
  width: min(14rem, 70%);
}
.knowledge-route-skeleton--desc {
  height: 0.875rem;
  width: min(20rem, 90%);
}
.knowledge-route-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem 1.5rem;
  text-align: center;
}
[data-lifecycle-list] button[type="button"] {
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  border: 1px solid var(--color-crm-border, #e3e8f0);
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: var(--color-crm-card, #ffffff);
  color: var(--color-crm-text, #172033);
}
@keyframes knowledge-route-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
@media (min-width: 640px) {
  .page-title {
    font-size: 1.25rem;
  }
}
`;
