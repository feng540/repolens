export { scan, type ScanOptions } from "./scan.js";
export { evaluate, grade, scoreColor } from "./metrics.js";
export { renderReport, type RenderOptions } from "./report/html.js";
export { renderBadge } from "./report/badge.js";
export type {
  AuthorStat,
  Commit,
  Dimension,
  FileChurn,
  HygieneItem,
  LanguageStat,
  RepoMeta,
  RepoScan,
  ScoreResult,
  WeeklyPoint,
} from "./types.js";
