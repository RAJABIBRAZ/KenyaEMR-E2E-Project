/* eslint-disable playwright/no-conditional-expect, playwright/no-conditional-in-test, playwright/no-wait-for-timeout -- This audit conditionally handles QA login variants and uses fixed post-load sampling windows. */
import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type AuditPhase = 'login' | 'authentication' | 'dashboard' | 'route-cycles';

type ResourceRecord = {
  phase: AuditPhase;
  url: string;
  method: string;
  type: string;
  status?: number;
  contentEncoding?: string;
  encodedDataLength?: number;
  finished?: boolean;
  failed?: boolean;
  errorText?: string;
};

type BrowserPerformanceState = {
  cumulativeLayoutShift: number;
  largestContentfulPaint: number;
  longTaskCount: number;
  longTaskTotal: number;
  longestTask: number;
};

type MetricMap = Record<string, number>;

const metricNames = new Set([
  'Documents',
  'Frames',
  'JSEventListeners',
  'Nodes',
  'LayoutCount',
  'RecalcStyleCount',
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'JSHeapUsedSize',
  'JSHeapTotalSize',
]);

function readPositiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCredentials() {
  const credentialFile = process.env.KENYAEMR_PERF_ENV_FILE ?? '/tmp/kenyaemr-perf.env';
  const content = readFileSync(credentialFile, 'utf8');
  const readValue = (key: string) => {
    const line = content.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
    return line?.slice(line.indexOf('=') + 1).trim() ?? '';
  };

  const url = readValue('KENYAEMR_URL').match(/https?:\/\/\S+/)?.[0];
  const username = readValue('KENYAEMR_USERNAME').replace(/^username\s*:\s*/i, '');
  const password = readValue('KENYAEMR_PASSWORD').replace(/^password\s*:\s*/i, '');

  if (!url || !username || !password) {
    throw new Error(`Could not parse the required KENYAEMR_* values from ${credentialFile}`);
  }

  return { url, username, password };
}

function buildQaUrls(rawUrl: string) {
  const suppliedUrl = new URL(rawUrl);
  const spaIndex = suppliedUrl.pathname.indexOf('/spa');
  const contextPath = spaIndex >= 0 ? suppliedUrl.pathname.slice(0, spaIndex) : suppliedUrl.pathname.replace(/\/$/, '');
  const spaBase = new URL(`${contextPath}/spa/`, suppliedUrl.origin);

  return {
    login: new URL('login', spaBase).href,
    home: new URL('home', spaBase).href,
    dashboardPath: `${contextPath}/spa/home/dashboard`,
    patientRegistrationPath: `${contextPath}/spa/patient-registration`,
    sessionEndpoint: `${contextPath}/ws/rest/v1/session`,
  };
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    return pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':uuid')
      .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:id');
  } catch {
    return '[non-http-resource]';
  }
}

function headerValue(headers: Record<string, unknown>, name: string): string {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match ? String(match[1]) : '';
}

class NetworkCollector {
  private phase: AuditPhase = 'login';
  private readonly requests = new Map<string, ResourceRecord>();

  constructor(private readonly cdp: CDPSession) {}

  async start() {
    this.cdp.on(
      'Network.requestWillBeSent',
      (event: { requestId: string; type?: string; request: { url: string; method: string } }) => {
        this.requests.set(event.requestId, {
          phase: this.phase,
          url: event.request.url,
          method: event.request.method,
          type: event.type ?? 'Other',
        });
      },
    );

    this.cdp.on(
      'Network.responseReceived',
      (event: {
        requestId: string;
        type?: string;
        response: { url: string; status: number; headers: Record<string, unknown> };
      }) => {
        const request = this.requests.get(event.requestId);
        if (!request) return;
        request.url = event.response.url;
        request.type = event.type ?? request.type;
        request.status = event.response.status;
        request.contentEncoding = headerValue(event.response.headers, 'content-encoding');
      },
    );

    this.cdp.on('Network.loadingFinished', (event: { requestId: string; encodedDataLength?: number }) => {
      const request = this.requests.get(event.requestId);
      if (!request) return;
      request.finished = true;
      request.encodedDataLength = event.encodedDataLength ?? 0;
    });

    this.cdp.on('Network.loadingFailed', (event: { requestId: string; errorText?: string }) => {
      const request = this.requests.get(event.requestId);
      if (!request) return;
      request.finished = true;
      request.failed = true;
      request.errorText = event.errorText ?? '';
    });

    await this.cdp.send('Network.enable');
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }

  setPhase(phase: AuditPhase) {
    this.phase = phase;
  }

  summarize(phase: AuditPhase) {
    const completed = [...this.requests.values()].filter((request) => request.phase === phase && request.finished);
    const byType: Record<string, { count: number; encodedBytes: number; failures: number }> = {};

    for (const request of completed) {
      const current = byType[request.type] ?? { count: 0, encodedBytes: 0, failures: 0 };
      current.count += 1;
      current.encodedBytes += request.encodedDataLength ?? 0;
      if (request.failed || (request.status ?? 0) >= 400) current.failures += 1;
      byType[request.type] = current;
    }

    const failures = completed
      .filter((request) => request.failed || (request.status ?? 0) >= 400)
      .slice(0, 20)
      .map((request) => ({
        path: sanitizeUrl(request.url),
        type: request.type,
        status: request.status ?? 0,
        error: request.errorText ?? '',
      }));

    const largest = completed
      .filter((request) => (request.encodedDataLength ?? 0) > 0)
      .sort((left, right) => (right.encodedDataLength ?? 0) - (left.encodedDataLength ?? 0))
      .slice(0, 15)
      .map((request) => ({
        path: sanitizeUrl(request.url),
        type: request.type,
        status: request.status ?? 0,
        encodedBytes: request.encodedDataLength ?? 0,
        contentEncoding: request.contentEncoding ?? '',
      }));

    return {
      requestCount: completed.length,
      transferBytes: completed.reduce((total, request) => total + (request.encodedDataLength ?? 0), 0),
      byType,
      failures,
      largest,
    };
  }
}

async function installPerformanceObservers(page: Page) {
  await page.addInitScript(() => {
    const auditState: BrowserPerformanceState = {
      cumulativeLayoutShift: 0,
      largestContentfulPaint: 0,
      longTaskCount: 0,
      longTaskTotal: 0,
      longestTask: 0,
    };

    Object.defineProperty(window, '__qaPerformanceAudit', {
      value: auditState,
      configurable: false,
      writable: false,
    });

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          auditState.largestContentfulPaint = Math.max(auditState.largestContentfulPaint, entry.startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // This performance-entry type is not available in every Chromium build.
    }

    try {
      new PerformanceObserver((list) => {
        for (const rawEntry of list.getEntries()) {
          const entry = rawEntry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!entry.hadRecentInput) auditState.cumulativeLayoutShift += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // This performance-entry type is not available in every Chromium build.
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          auditState.longTaskCount += 1;
          auditState.longTaskTotal += entry.duration;
          auditState.longestTask = Math.max(auditState.longestTask, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // This performance-entry type is not available in every Chromium build.
    }
  });
}

async function pagePerformanceSnapshot(page: Page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const state = (
      window as Window & {
        __qaPerformanceAudit?: BrowserPerformanceState;
      }
    ).__qaPerformanceAudit;

    return {
      path: window.location.pathname,
      navigation: navigation
        ? {
            duration: navigation.duration,
            domContentLoaded: navigation.domContentLoadedEventEnd,
            loadEvent: navigation.loadEventEnd,
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize,
          }
        : null,
      webVitals: {
        firstContentfulPaint,
        largestContentfulPaint: state?.largestContentfulPaint ?? 0,
        cumulativeLayoutShift: state?.cumulativeLayoutShift ?? 0,
        longTaskCount: state?.longTaskCount ?? 0,
        longTaskTotal: state?.longTaskTotal ?? 0,
        longestTask: state?.longestTask ?? 0,
      },
    };
  });
}

async function collectMetrics(cdp: CDPSession): Promise<MetricMap> {
  const response = (await cdp.send('Performance.getMetrics')) as {
    metrics?: Array<{ name: string; value: number }>;
  };

  return Object.fromEntries(
    (response.metrics ?? [])
      .filter((metric) => metricNames.has(metric.name))
      .map((metric) => [metric.name, metric.value]),
  );
}

async function collectAfterGarbageCollection(cdp: CDPSession): Promise<MetricMap> {
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return collectMetrics(cdp);
}

async function chooseSessionLocation(page: Page, sessionEndpoint: string): Promise<'ui' | 'session-api-fallback'> {
  const locations = page.locator('input[type="radio"][name="loginLocations"]');
  await locations.first().waitFor({ state: 'attached' });
  await locations.first().evaluate((location) => location.click());
  await expect(locations.first()).toBeChecked();

  try {
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login/location'), { timeout: 10 * 1000 });
    return 'ui';
  } catch {
    const result = await page.evaluate(async (endpoint) => {
      const selectedLocation = document.querySelector<HTMLInputElement>(
        'input[type="radio"][name="loginLocations"]:checked',
      );
      if (!selectedLocation?.value) return { ok: false, status: 0 };

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionLocation: selectedLocation.value }),
      });
      return { ok: response.ok, status: response.status };
    }, sessionEndpoint);

    if (!result.ok) throw new Error(`QA session-location selection failed with status ${result.status}`);
    return 'session-api-fallback';
  }
}

async function writeSanitizedResults(testInfo: TestInfo, results: Record<string, unknown>, csv: string) {
  const jsonPath = testInfo.outputPath('qa-performance-results.json');
  const csvPath = testInfo.outputPath('qa-performance-results.csv');
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(csvPath, csv, 'utf8');
  await testInfo.attach('qa-performance-results.json', { path: jsonPath, contentType: 'application/json' });
  await testInfo.attach('qa-performance-results.csv', { path: csvPath, contentType: 'text/csv' });
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resultsToCsv(
  loginNetwork: ReturnType<NetworkCollector['summarize']>,
  dashboardNetwork: ReturnType<NetworkCollector['summarize']>,
  loginPage: Awaited<ReturnType<typeof pagePerformanceSnapshot>>,
  dashboardPage: Awaited<ReturnType<typeof pagePerformanceSnapshot>>,
  dashboardBaseline: MetricMap,
  routePoints: Array<{ cycle: number; route: string; path: string; metrics: MetricMap }>,
  analysis: Record<string, string | number | boolean>,
) {
  const rows: Array<[string, string, string, string | number | boolean, string]> = [];
  const add = (category: string, checkpoint: string, metric: string, value: string | number | boolean, unit = '') =>
    rows.push([category, checkpoint, metric, value, unit]);

  add('network', 'login', 'requestCount', loginNetwork.requestCount, 'requests');
  add('network', 'login', 'transferBytes', loginNetwork.transferBytes, 'bytes');
  add('network', 'login', 'failedRequests', loginNetwork.failures.length, 'requests');
  add('network', 'dashboard', 'requestCount', dashboardNetwork.requestCount, 'requests');
  add('network', 'dashboard', 'transferBytes', dashboardNetwork.transferBytes, 'bytes');
  add('network', 'dashboard', 'failedRequests', dashboardNetwork.failures.length, 'requests');

  for (const [metric, value] of Object.entries(loginPage.navigation ?? {})) {
    add('navigation', 'login', metric, value, metric.toLowerCase().includes('size') ? 'bytes' : 'milliseconds');
  }
  for (const [metric, value] of Object.entries(dashboardPage.navigation ?? {})) {
    add('navigation', 'dashboard', metric, value, metric.toLowerCase().includes('size') ? 'bytes' : 'milliseconds');
  }
  for (const [metric, value] of Object.entries(loginPage.webVitals)) {
    const unit = metric === 'cumulativeLayoutShift' ? 'score' : metric === 'longTaskCount' ? 'count' : 'milliseconds';
    add('web-vitals', 'login', metric, value, unit);
  }
  for (const [metric, value] of Object.entries(dashboardPage.webVitals)) {
    const unit = metric === 'cumulativeLayoutShift' ? 'score' : metric === 'longTaskCount' ? 'count' : 'milliseconds';
    add('web-vitals', 'dashboard', metric, value, unit);
  }

  for (const [metric, value] of Object.entries(dashboardBaseline)) {
    const unit = metric.includes('Size') ? 'bytes' : metric.endsWith('Duration') ? 'seconds' : 'count';
    add('memory', 'dashboard-baseline', metric, value, unit);
  }

  for (const point of routePoints) {
    for (const [metric, value] of Object.entries(point.metrics)) {
      const unit = metric.includes('Size') ? 'bytes' : metric.endsWith('Duration') ? 'seconds' : 'count';
      add('memory', `${point.route}-cycle-${point.cycle}`, metric, value, unit);
    }
  }

  for (const [metric, value] of Object.entries(analysis)) add('analysis', 'route-cycle', metric, value);

  return [
    ['Category', 'Checkpoint', 'Metric', 'Value', 'Unit'].map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\n');
}

test('Frontend performance and route-retention audit', async ({ page, browser }, testInfo) => {
  const credentials = readCredentials();
  const urls = buildQaUrls(credentials.url);
  const loginSettleMs = readPositiveInteger('QA_PERF_LOGIN_SETTLE_MS', 8 * 1000);
  const dashboardSettleMs = readPositiveInteger('QA_PERF_DASHBOARD_SETTLE_MS', 15 * 1000);
  const routeSettleMs = readPositiveInteger('QA_PERF_ROUTE_SETTLE_MS', 4 * 1000);
  const routeCycles = readPositiveInteger('QA_PERF_ROUTE_CYCLES', 4);

  await installPerformanceObservers(page);
  const cdp = await page.context().newCDPSession(page);
  await Promise.all([cdp.send('Performance.enable'), cdp.send('HeapProfiler.enable')]);
  const network = new NetworkCollector(cdp);
  await network.start();

  network.setPhase('login');
  await page.goto(urls.login, { waitUntil: 'load' });
  const username = page.locator('#username, input[name="username"]').first();
  const password = page.locator('#password, input[name="password"]').first();
  await Promise.all([username.waitFor(), password.waitFor()]);
  await page.waitForTimeout(loginSettleMs);
  const loginPage = await pagePerformanceSnapshot(page);

  network.setPhase('authentication');
  await username.fill(credentials.username);
  await password.fill(credentials.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30 * 1000 });

  let loginMethod = 'credentials';
  if (new URL(page.url()).pathname.endsWith('/login/location')) {
    loginMethod = `credentials+${await chooseSessionLocation(page, urls.sessionEndpoint)}`;
  }
  if (new URL(page.url()).pathname.includes('/login/otp')) {
    throw new Error('The QA account requires an OTP; the automated audit cannot continue non-interactively.');
  }

  network.setPhase('dashboard');
  await page.goto(urls.home, { waitUntil: 'load' });
  await page.waitForURL((url) => url.pathname.includes('/home'), { timeout: 30 * 1000 });
  await page.waitForTimeout(dashboardSettleMs);
  const dashboardPage = await pagePerformanceSnapshot(page);
  const dashboardBaseline = await collectAfterGarbageCollection(cdp);

  network.setPhase('route-cycles');
  const routePoints: Array<{ cycle: number; route: string; path: string; metrics: MetricMap }> = [];
  for (let cycle = 1; cycle <= routeCycles; cycle += 1) {
    await page.evaluate((path) => window.history.pushState({}, '', path), urls.patientRegistrationPath);
    await page.waitForURL((url) => url.pathname === urls.patientRegistrationPath);
    await page.waitForTimeout(routeSettleMs);
    routePoints.push({
      cycle,
      route: 'patient-registration',
      path: new URL(page.url()).pathname,
      metrics: await collectAfterGarbageCollection(cdp),
    });

    await page.evaluate((path) => window.history.pushState({}, '', path), urls.dashboardPath);
    await page.waitForURL((url) => url.pathname === urls.dashboardPath);
    await page.waitForTimeout(routeSettleMs);
    routePoints.push({
      cycle,
      route: 'dashboard',
      path: new URL(page.url()).pathname,
      metrics: await collectAfterGarbageCollection(cdp),
    });
  }

  const dashboardPoints = routePoints.filter((point) => point.route === 'dashboard');
  const consecutiveDeltas = (metric: string) =>
    dashboardPoints.slice(1).map((point, index) => point.metrics[metric] - dashboardPoints[index].metrics[metric]);
  const nodeDeltas = consecutiveDeltas('Nodes');
  const listenerDeltas = consecutiveDeltas('JSEventListeners');
  const heapDeltas = consecutiveDeltas('JSHeapUsedSize');
  const average = (values: Array<number>) =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  const analysis = {
    routeCycles,
    nodeGrowthFirstToLast: dashboardPoints.at(-1)!.metrics.Nodes - dashboardPoints[0].metrics.Nodes,
    listenerGrowthFirstToLast:
      dashboardPoints.at(-1)!.metrics.JSEventListeners - dashboardPoints[0].metrics.JSEventListeners,
    heapGrowthFirstToLast: dashboardPoints.at(-1)!.metrics.JSHeapUsedSize - dashboardPoints[0].metrics.JSHeapUsedSize,
    averageNodeGrowthPerCycle: average(nodeDeltas),
    averageListenerGrowthPerCycle: average(listenerDeltas),
    averageHeapGrowthPerCycle: average(heapDeltas),
    nodesIncreaseEveryCycle: nodeDeltas.every((delta) => delta > 0),
    listenersIncreaseEveryCycle: listenerDeltas.every((delta) => delta > 0),
    heapIncreasesEveryCycle: heapDeltas.every((delta) => delta > 0),
    domListenerLeakCandidate: nodeDeltas.every((delta) => delta > 0) && listenerDeltas.every((delta) => delta > 0),
    memoryLeakCandidate:
      nodeDeltas.every((delta) => delta > 0) &&
      listenerDeltas.every((delta) => delta > 0) &&
      heapDeltas.every((delta) => delta > 0),
  };

  const loginNetwork = network.summarize('login');
  const dashboardNetwork = network.summarize('dashboard');
  const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: process.env.KENYAEMR_PERF_ENVIRONMENT ?? new URL(credentials.url).hostname,
    browserVersion: browser.version(),
    cacheDisabled: true,
    loginMethod,
    login: { page: loginPage, network: loginNetwork },
    dashboard: { page: dashboardPage, network: dashboardNetwork, baselineMetrics: dashboardBaseline },
    routeCycleMemoryTest: routePoints,
    analysis,
  };

  const csv = resultsToCsv(
    loginNetwork,
    dashboardNetwork,
    loginPage,
    dashboardPage,
    dashboardBaseline,
    routePoints,
    analysis,
  );
  await writeSanitizedResults(testInfo, results, `${csv}\n`);

  testInfo.annotations.push({
    type: 'memory-audit',
    description: analysis.domListenerLeakCandidate
      ? 'Repeated route cycles retained DOM nodes and event listeners; inspect lifecycle cleanup.'
      : 'No consistent DOM/listener growth was detected in this run.',
  });

  if (process.env.QA_PERF_ENFORCE_BUDGETS === 'true') {
    expect(analysis.domListenerLeakCandidate, 'DOM/listener counts should plateau after route warm-up').toBe(false);
  }
});
