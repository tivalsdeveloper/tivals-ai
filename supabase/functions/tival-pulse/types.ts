export type DailyPoint = {
  date: string;
  downloads: number;
};

export type Breakdown = {
  label: string;
  downloads: number;
};

export type ReleaseInfo = {
  version: string;
  uploadedAt: string | null;
  size: number;
  yanked: boolean;
  python: string | null;
};

export type GithubStats = {
  owner: string;
  repo: string;
  url: string;
  stars: number;
  forks: number;
  watchers: number;
  pushedAt: string | null;
};

export type PackagePulse = {
  name: string;
  label: string;
  blurb: string;
  summary: string;
  version: string;
  requiresPython: string | null;
  license: string | null;
  keywords: string[];
  pypiUrl: string;
  homeUrl: string | null;
  firstUpload: string | null;
  latestUpload: string | null;
  releaseCount: number;
  lastDay: number;
  lastWeek: number;
  lastMonth: number;
  allTime: number;
  series: DailyPoint[];
  python: Breakdown[];
  systems: Breakdown[];
  versions: Breakdown[];
  releases: ReleaseInfo[];
  github: GithubStats | null;
};

export type PulsePayload = {
  fetchedAt: string;
  downloadsAsOf: string | null;
  source: "clickhouse" | "partial";
  packages: PackagePulse[];
  totals: {
    lastDay: number;
    lastWeek: number;
    lastMonth: number;
    allTime: number;
  };
  portfolio: DailyPoint[];
};
