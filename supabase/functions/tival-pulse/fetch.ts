import { OWNED_PACKAGES, assertSafePackageName, type CatalogEntry } from "./catalog.ts";
import type {
  Breakdown,
  DailyPoint,
  GithubStats,
  PackagePulse,
  PulsePayload,
  ReleaseInfo,
} from "./types.ts";

const UA = "TivalPulse/1.0 (library stats dashboard)";
const CH_URL =
  "https://sql-clickhouse.clickhouse.com/?user=play&default_format=JSONEachRow";

type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 5 * 60 * 1000;

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sqlList(names: string[]): string {
  return names.map((n) => `'${assertSafePackageName(n)}'`).join(",");
}

type PypiJson = {
  info: {
    name: string;
    version: string;
    summary: string | null;
    home_page: string | null;
    package_url: string | null;
    project_url: string | null;
    project_urls: Record<string, string> | null;
    requires_python: string | null;
    license: string | null;
    license_expression?: string | null;
    keywords: string | string[] | null;
    classifiers?: string[];
    yanked?: boolean;
  };
  releases: Record<
    string,
    Array<{
      upload_time_iso_8601?: string;
      upload_time?: string;
      size?: number;
      yanked?: boolean;
      packagetype?: string;
      python_version?: string;
    }>
  >;
  urls: Array<{
    upload_time_iso_8601?: string;
    size?: number;
    packagetype?: string;
    python_version?: string;
    yanked?: boolean;
  }>;
};

async function fetchPypi(name: string): Promise<PypiJson> {
  const res = await fetch(`https://pypi.org/pypi/${assertSafePackageName(name)}/json`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`PyPI ${name} ${res.status}`);
  return (await res.json()) as PypiJson;
}

type ChRow = Record<string, unknown>;

async function clickhouse(sql: string): Promise<ChRow[]> {
  const res = await fetch(CH_URL, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "text/plain; charset=utf-8" },
    body: sql,
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}`);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: ChRow[] = [];
  for (const line of lines) {
    const row = JSON.parse(line) as ChRow;
    if (typeof row.exception === "string") {
      throw new Error(String(row.exception).slice(0, 180));
    }
    rows.push(row);
  }
  return rows;
}

function parseGithub(
  urls: Record<string, string> | null,
  home: string | null,
): { owner: string; repo: string; url: string } | null {
  const candidates = [...Object.values(urls ?? {}), home ?? ""];
  for (const raw of candidates) {
    const m = raw.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (!m) continue;
    const owner = m[1];
    const repo = m[2].replace(/\.git$/i, "");
    if (!owner || !repo) continue;
    return { owner, repo, url: `https://github.com/${owner}/${repo}` };
  }
  return null;
}

async function fetchGithub(ref: { owner: string; repo: string; url: string }): Promise<GithubStats | null> {
  try {
    const res = await fetch(`https://ungh.cc/repos/${ref.owner}/${ref.repo}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ...ref, stars: 0, forks: 0, watchers: 0, pushedAt: null };
    const body = (await res.json()) as {
      repo?: {
        stars?: number;
        forks?: number;
        watchers?: number;
        pushedAt?: string;
      };
    };
    const r = body.repo ?? {};
    return {
      ...ref,
      stars: num(r.stars),
      forks: num(r.forks),
      watchers: num(r.watchers),
      pushedAt: r.pushedAt ?? null,
    };
  } catch {
    return { ...ref, stars: 0, forks: 0, watchers: 0, pushedAt: null };
  }
}

function shortLicense(info: PypiJson["info"]): string | null {
  const expr = info.license_expression?.trim();
  if (expr) return expr;
  const classifiers = info.classifiers ?? [];
  const fromClass = classifiers.find((c) => c.startsWith("License ::"));
  if (fromClass) {
    const parts = fromClass.split("::").map((s) => s.trim());
    return parts[parts.length - 1] || null;
  }
  const lic = (info.license ?? "").trim();
  if (!lic) return null;
  if (/MIT/i.test(lic)) return "MIT";
  if (/Apache/i.test(lic)) return "Apache-2.0";
  return lic.length > 28 ? `${lic.slice(0, 26)}…` : lic;
}

function keywordList(raw: string | string[] | null): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\s]+/);
  return parts.map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

function pickReleases(json: PypiJson): ReleaseInfo[] {
  const entries = Object.entries(json.releases ?? {});
  const items: ReleaseInfo[] = entries.map(([version, files]) => {
    const list = files ?? [];
    let uploadedAt: string | null = null;
    let size = 0;
    let yanked = list.some((f) => f.yanked);
    let python: string | null = null;
    for (const f of list) {
      const t = f.upload_time_iso_8601 ?? f.upload_time ?? null;
      if (t && (!uploadedAt || t > uploadedAt)) uploadedAt = t;
      size += f.size ?? 0;
      if (!python && f.python_version && f.python_version !== "source") {
        python = f.python_version;
      }
    }
    return { version, uploadedAt, size, yanked, python };
  });
  items.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
  return items.slice(0, 8);
}

function firstAndLatest(json: PypiJson): { first: string | null; latest: string | null } {
  let first: string | null = null;
  let latest: string | null = null;
  for (const files of Object.values(json.releases ?? {})) {
    for (const f of files ?? []) {
      const t = f.upload_time_iso_8601 ?? f.upload_time ?? null;
      if (!t) continue;
      if (!first || t < first) first = t;
      if (!latest || t > latest) latest = t;
    }
  }
  return { first, latest };
}

function tidyBreakdown(rows: Breakdown[], limit = 6): Breakdown[] {
  const cleaned = rows
    .map((r) => ({
      label: r.label.trim() ? r.label : "Unspecified",
      downloads: r.downloads,
    }))
    .filter((r) => r.downloads > 0);
  cleaned.sort((a, b) => b.downloads - a.downloads);
  if (cleaned.length <= limit) return cleaned;
  const head = cleaned.slice(0, limit - 1);
  const rest = cleaned.slice(limit - 1).reduce((s, r) => s + r.downloads, 0);
  if (rest > 0) head.push({ label: "Other", downloads: rest });
  return head;
}

function fillSeries(raw: DailyPoint[], days = 42): DailyPoint[] {
  const map = new Map(raw.map((p) => [p.date, p.downloads]));
  const out: DailyPoint[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, downloads: map.get(key) ?? 0 });
  }
  return out;
}

function emptyPackage(entry: CatalogEntry): PackagePulse {
  return {
    name: entry.name,
    label: entry.label,
    blurb: entry.blurb,
    summary: entry.blurb,
    version: "—",
    requiresPython: null,
    license: null,
    keywords: [],
    pypiUrl: `https://pypi.org/project/${entry.name}/`,
    homeUrl: null,
    firstUpload: null,
    latestUpload: null,
    releaseCount: 0,
    lastDay: 0,
    lastWeek: 0,
    lastMonth: 0,
    allTime: 0,
    series: fillSeries([]),
    python: [],
    systems: [],
    versions: [],
    releases: [],
    github: null,
  };
}

type StatsBundle = {
  totals: Map<string, { lastDay: number; lastWeek: number; lastMonth: number; allTime: number }>;
  series: Map<string, DailyPoint[]>;
  python: Map<string, Breakdown[]>;
  systems: Map<string, Breakdown[]>;
  versions: Map<string, Breakdown[]>;
  asOf: string | null;
};

async function loadDownloadStats(names: string[]): Promise<StatsBundle> {
  const list = sqlList(names);
  const [summary, daily, py, sys, ver] = await Promise.all([
    clickhouse(`
      SELECT
        project,
        sumIf(count, date = yesterday()) AS last_day,
        sumIf(count, date >= today() - 7) AS last_week,
        sumIf(count, date >= today() - 30) AS last_month,
        sum(count) AS all_time,
        max(date) AS as_of
      FROM pypi.pypi_downloads_per_day
      WHERE project IN (${list})
      GROUP BY project
    `),
    clickhouse(`
      SELECT project, date, sum(count) AS downloads
      FROM pypi.pypi_downloads_per_day
      WHERE project IN (${list}) AND date >= today() - 90
      GROUP BY project, date
      ORDER BY date ASC
    `),
    clickhouse(`
      SELECT project, python_minor, sum(count) AS downloads
      FROM pypi.pypi_downloads_per_day_by_version_by_python
      WHERE project IN (${list}) AND date >= today() - 30
      GROUP BY project, python_minor
    `),
    clickhouse(`
      SELECT project, system, sum(count) AS downloads
      FROM pypi.pypi_downloads_per_day_by_version_by_system
      WHERE project IN (${list}) AND date >= today() - 30
      GROUP BY project, system
    `),
    clickhouse(`
      SELECT project, version, sum(count) AS downloads
      FROM pypi.pypi_downloads_per_day_by_version
      WHERE project IN (${list}) AND date >= today() - 30
      GROUP BY project, version
    `),
  ]);

  const totals = new Map<
    string,
    { lastDay: number; lastWeek: number; lastMonth: number; allTime: number }
  >();
  let asOf: string | null = null;
  for (const row of summary) {
    const project = String(row.project);
    totals.set(project, {
      lastDay: num(row.last_day),
      lastWeek: num(row.last_week),
      lastMonth: num(row.last_month),
      allTime: num(row.all_time),
    });
    const d = row.as_of ? String(row.as_of) : null;
    if (d && (!asOf || d > asOf)) asOf = d;
  }

  const series = new Map<string, DailyPoint[]>();
  for (const row of daily) {
    const project = String(row.project);
    const listPts = series.get(project) ?? [];
    listPts.push({ date: String(row.date), downloads: num(row.downloads) });
    series.set(project, listPts);
  }

  const python = new Map<string, Breakdown[]>();
  for (const row of py) {
    const project = String(row.project);
    const arr = python.get(project) ?? [];
    arr.push({ label: String(row.python_minor ?? ""), downloads: num(row.downloads) });
    python.set(project, arr);
  }

  const systems = new Map<string, Breakdown[]>();
  for (const row of sys) {
    const project = String(row.project);
    const arr = systems.get(project) ?? [];
    arr.push({ label: String(row.system ?? ""), downloads: num(row.downloads) });
    systems.set(project, arr);
  }

  const versions = new Map<string, Breakdown[]>();
  for (const row of ver) {
    const project = String(row.project);
    const arr = versions.get(project) ?? [];
    arr.push({ label: String(row.version ?? ""), downloads: num(row.downloads) });
    versions.set(project, arr);
  }

  return { totals, series, python, systems, versions, asOf };
}

function mergePortfolio(packages: PackagePulse[]): DailyPoint[] {
  const map = new Map<string, number>();
  for (const pkg of packages) {
    for (const pt of pkg.series) {
      map.set(pt.date, (map.get(pt.date) ?? 0) + pt.downloads);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, downloads]) => ({ date, downloads }));
}

export async function loadPulse(): Promise<PulsePayload> {
  return cached("pulse:v1", TTL_MS, loadPulseUncached);
}

async function loadPulseUncached(): Promise<PulsePayload> {
  const names = OWNED_PACKAGES.map((p) => p.name);

  const pypiResults = await Promise.allSettled(names.map((n) => fetchPypi(n)));

  let stats: StatsBundle | null = null;
  let source: PulsePayload["source"] = "clickhouse";
  try {
    stats = await loadDownloadStats(names);
  } catch {
    source = "partial";
  }

  const githubJobs: Promise<GithubStats | null>[] = [];
  const githubIndex: number[] = [];

  const packages: PackagePulse[] = OWNED_PACKAGES.map((entry, i) => {
    const result = pypiResults[i];
    if (!result || result.status !== "fulfilled") {
      githubJobs.push(Promise.resolve(null));
      githubIndex.push(i);
      return emptyPackage(entry);
    }
    const json = result.value;
    const info = json.info;
    const ghRef = parseGithub(info.project_urls, info.home_page);
    githubIndex.push(i);
    githubJobs.push(ghRef ? fetchGithub(ghRef) : Promise.resolve(null));

    const { first, latest } = firstAndLatest(json);
    const t = stats?.totals.get(entry.name);
    return {
      name: entry.name,
      label: entry.label,
      blurb: entry.blurb,
      summary: (info.summary || entry.blurb).trim(),
      version: info.version,
      requiresPython: info.requires_python,
      license: shortLicense(info),
      keywords: keywordList(info.keywords),
      pypiUrl: info.project_url || info.package_url || `https://pypi.org/project/${entry.name}/`,
      homeUrl: info.project_urls?.Homepage || info.project_urls?.Repository || info.home_page,
      firstUpload: first,
      latestUpload: latest,
      releaseCount: Object.keys(json.releases ?? {}).length,
      lastDay: t?.lastDay ?? 0,
      lastWeek: t?.lastWeek ?? 0,
      lastMonth: t?.lastMonth ?? 0,
      allTime: t?.allTime ?? 0,
      series: fillSeries(stats?.series.get(entry.name) ?? []),
      python: tidyBreakdown(stats?.python.get(entry.name) ?? []),
      systems: tidyBreakdown(stats?.systems.get(entry.name) ?? []),
      versions: tidyBreakdown(stats?.versions.get(entry.name) ?? [], 5),
      releases: pickReleases(json),
      github: null,
    };
  });

  const gh = await Promise.all(githubJobs);
  gh.forEach((statsGh, i) => {
    const idx = githubIndex[i];
    if (idx === undefined) return;
    const pkg = packages[idx];
    if (pkg) pkg.github = statsGh;
  });

  packages.sort((a, b) => b.lastMonth - a.lastMonth || b.allTime - a.allTime);

  const totals = packages.reduce(
    (acc, p) => ({
      lastDay: acc.lastDay + p.lastDay,
      lastWeek: acc.lastWeek + p.lastWeek,
      lastMonth: acc.lastMonth + p.lastMonth,
      allTime: acc.allTime + p.allTime,
    }),
    { lastDay: 0, lastWeek: 0, lastMonth: 0, allTime: 0 },
  );

  return {
    fetchedAt: new Date().toISOString(),
    downloadsAsOf: stats?.asOf ?? null,
    source,
    packages,
    totals,
    portfolio: mergePortfolio(packages),
  };
}
