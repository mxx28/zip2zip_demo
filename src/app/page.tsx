"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  BookOpen,
  Box,
  Database,
  Gauge,
  Layers,
  Play,
  RefreshCw,
  Square,
  TrendingDown,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  codebookForMode,
  DEMO_RUNS_INDEX_PATH,
  fetchDemoJson,
  findExampleResult,
  formatCount,
  formatMetricValue,
  metricAsNumber,
  resolveDemoDataPath,
  resolveDemoRunPath,
  tokenKind,
  tokenLabel,
  type CompressionViewMode,
  type DemoCodebookEntry,
  type DemoExampleResult,
  type DemoManifest,
  type DemoManifestExample,
  type DemoMetricValue,
  type DemoModelManifestEntry,
  type DemoModelResults,
  type DemoRunIndex,
  type DemoRunIndexEntry,
  type DemoToken,
  type DemoTokenizerMetadata,
} from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const DEFAULT_CATEGORY = "coding";

const METRIC_ROWS: Array<{
  key: string;
  label: string;
  percent?: boolean;
}> = [
  { key: "base_new_tokens", label: "Base new tokens" },
  { key: "theory_new_zip_tokens", label: "Theory zip tokens" },
  { key: "actual_new_zip_tokens", label: "Actual zip tokens" },
  { key: "actual_new_zip_tokens_raw", label: "Raw generated zip tokens" },
  { key: "actual_bytes_per_zip_token", label: "Actual bytes / zip token" },
  { key: "theory_bytes_per_zip_token", label: "Theory bytes / zip token" },
  { key: "compression_efficiency", label: "Compression efficiency", percent: true },
  { key: "base_token_saving", label: "Base token saving", percent: true },
];

const FEATURED_METRIC_KEYS = new Set(["compression_efficiency", "base_token_saving"]);
const TOKEN_COUNT_METRIC_KEYS = new Set([
  "base_new_tokens",
  "theory_new_zip_tokens",
  "actual_new_zip_tokens",
]);
const FEATURED_METRIC_ROWS = METRIC_ROWS.filter((row) => FEATURED_METRIC_KEYS.has(row.key));
const FEATURED_METRIC_ICONS: Record<string, typeof Gauge> = {
  compression_efficiency: Gauge,
  base_token_saving: TrendingDown,
};
const MAIN_METRIC_ROWS = METRIC_ROWS.filter(
  (row) => !FEATURED_METRIC_KEYS.has(row.key) && !TOKEN_COUNT_METRIC_KEYS.has(row.key)
);
const TOKEN_REPLAY_INTERVAL_MS = 80;

const BASE_COLORS = [
  "border-sky-200 bg-sky-200 text-sky-950",
  "border-amber-200 bg-amber-200 text-amber-950",
  "border-blue-200 bg-blue-200 text-blue-950",
  "border-green-200 bg-green-200 text-green-950",
  "border-orange-200 bg-orange-200 text-orange-950",
  "border-cyan-200 bg-cyan-200 text-cyan-950",
  "border-gray-200 bg-gray-200 text-gray-950",
  "border-purple-200 bg-purple-200 text-purple-950",
  "border-indigo-200 bg-indigo-200 text-indigo-950",
  "border-lime-200 bg-lime-200 text-lime-950",
  "border-rose-200 bg-rose-200 text-rose-950",
  "border-violet-200 bg-violet-200 text-violet-950",
  "border-yellow-200 bg-yellow-200 text-yellow-950",
  "border-emerald-200 bg-emerald-200 text-emerald-950",
  "border-zinc-200 bg-zinc-200 text-zinc-950",
  "border-red-200 bg-red-200 text-red-950",
  "border-fuchsia-200 bg-fuchsia-200 text-fuchsia-950",
  "border-pink-200 bg-pink-200 text-pink-950",
  "border-teal-200 bg-teal-200 text-teal-950",
];

const HYPER_COLORS = [
  "border-sky-700 bg-sky-700 text-white",
  "border-amber-700 bg-amber-700 text-white",
  "border-blue-700 bg-blue-700 text-white",
  "border-green-700 bg-green-700 text-white",
  "border-orange-700 bg-orange-700 text-white",
  "border-cyan-700 bg-cyan-700 text-white",
  "border-gray-700 bg-gray-700 text-white",
  "border-purple-700 bg-purple-700 text-white",
  "border-indigo-700 bg-indigo-700 text-white",
  "border-lime-700 bg-lime-700 text-white",
  "border-rose-700 bg-rose-700 text-white",
  "border-violet-700 bg-violet-700 text-white",
  "border-yellow-700 bg-yellow-700 text-white",
  "border-emerald-700 bg-emerald-700 text-white",
  "border-zinc-700 bg-zinc-700 text-white",
  "border-red-700 bg-red-700 text-white",
  "border-fuchsia-700 bg-fuchsia-700 text-white",
  "border-pink-700 bg-pink-700 text-white",
  "border-teal-700 bg-teal-700 text-white",
];

type TokenReplayCounts = {
  original: number;
  optimal: number;
  model: number;
};

type TokenReplayTimes = {
  original: number | null;
  optimal: number | null;
  model: number | null;
};

function metric(result: DemoExampleResult | null, key: string): DemoMetricValue {
  return result?.metrics?.[key];
}

function metricCount(
  result: DemoExampleResult | null,
  metricKey: string,
  fallbackLength?: number
): DemoMetricValue {
  return metric(result, metricKey) ?? fallbackLength;
}

function displayCount(tokens?: DemoToken[], tokenIds?: number[]): number | undefined {
  return tokens?.length || tokenIds?.length || undefined;
}

function preferDefaultCategory<T extends { category?: string }>(items: T[]): T | undefined {
  return items.find((item) => item.category === DEFAULT_CATEGORY) ?? items[0];
}

function hasDisplayableResult(result: DemoExampleResult): boolean {
  return Boolean(
    result.response ||
      result.original?.tokens?.length ||
      result.original?.token_ids?.length ||
      result.optimal?.tokens?.length ||
      result.optimal?.compressed_token_ids?.length ||
      result.model_result?.tokens?.length ||
      result.model_result?.compressed_token_ids?.length
  );
}

function modelLabel(model: DemoModelManifestEntry): string {
  return model.run_label || model.label || model.slug;
}

function modelBaseName(label: string): string {
  return label.match(/\(([^)]+)\)/)?.[1] ?? label;
}

function isHyperCompressedModel(label: string): boolean {
  return label.startsWith("zip2zip++");
}

const DEFAULT_MODEL_LABEL = "zip2zip++(phi3-14B)";

function preferDefaultModel(models: DemoModelManifestEntry[]): DemoModelManifestEntry | undefined {
  return models.find((model) => modelLabel(model) === DEFAULT_MODEL_LABEL) ?? models[0];
}

function runLabel(run: DemoRunIndexEntry): string {
  if (run.label) return run.label;

  const cleanedId = run.id.replace(/_demo_data$/, "");
  const parts = cleanedId.split("-");
  if (parts.length >= 4) return `${parts[2]}-${parts[3]}`;

  return cleanedId;
}

function modelSlugForRun(run: DemoRunIndexEntry, model: DemoModelManifestEntry): string {
  return `${run.id}__${model.slug}`;
}

function modelResultsPath(run: DemoRunIndexEntry, resultsFile: string): string {
  return `${run.path}/${resultsFile}`;
}

function buildManifestFromRuns(
  runs: DemoRunIndexEntry[],
  manifests: DemoManifest[]
): DemoManifest {
  const examplesById = new Map<string, DemoManifestExample>();
  const models: DemoModelManifestEntry[] = [];

  runs.forEach((run, runIndex) => {
    const runManifest = manifests[runIndex];
    const label = runLabel(run);

    runManifest.examples.forEach((example) => {
      if (!examplesById.has(example.id)) {
        examplesById.set(example.id, example);
      }
    });

    runManifest.models.forEach((model) => {
      models.push({
        ...model,
        slug: modelSlugForRun(run, model),
        label,
        results_file: modelResultsPath(run, model.results_file),
        run_id: run.id,
        run_label: label,
        run_path: run.path,
      });
    });
  });

  return {
    schema_version: 1,
    models,
    examples: Array.from(examplesById.values()),
  };
}

function MissingData({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function TextBlock({
  title,
  text,
  className,
  bodyClassName,
}: {
  title: string;
  text?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <pre
        className={cn(
          "overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed",
          bodyClassName
        )}
      >
        {text || "Missing"}
      </pre>
    </div>
  );
}

function countDelta(count: DemoMetricValue, base: DemoMetricValue): string | null {
  const countNumber = metricAsNumber(count);
  const baseNumber = metricAsNumber(base);

  if (countNumber === null || baseNumber === null || baseNumber === 0) return null;

  return `${((countNumber / baseNumber - 1) * 100).toFixed(1)}%`;
}

const COUNT_ANIMATION_MS = 900;

// Keeps the last known number on screen while the next model's results are in
// flight, so switching models rolls the counters instead of blinking "Missing".
function useHeldNumber(value: DemoMetricValue, pending: boolean): number | null {
  const number = metricAsNumber(value);
  const lastRef = useRef<number | null>(number);

  if (number !== null) {
    lastRef.current = number;
  } else if (!pending) {
    lastRef.current = null;
  }

  return number ?? (pending ? lastRef.current : null);
}

// Animates a count from `base` (the original token count) down to `target`
// every time `target` lands on a new value — including the very first time
// data arrives, so the card visibly "shrinks" from the original size on load,
// on every example switch, and on every model switch. When `enabled` is
// false the value is shown as-is with no animation.
function useShrinkFromBase(
  target: number | null,
  base: number | null,
  enabled: boolean
): number | null {
  const [progress, setProgress] = useState(1);

  // useLayoutEffect (not useEffect) so the reset-to-0 and the rAF loop start
  // land in the same pre-paint pass — the number never flashes at its final
  // value for a frame before animating in. The effect's own dependency array
  // already re-runs it exactly when `target` lands on a new value, so no
  // extra "did it change" ref is needed (a ref like that doesn't survive
  // React 18 StrictMode's dev-only double-invoke of this effect cleanly when
  // a component mounts with a non-null target on its very first render).
  useLayoutEffect(() => {
    if (!enabled || target === null || base === null) {
      setProgress(1);
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setProgress(1);
      return;
    }

    setProgress(0);
    const startTime = performance.now();
    let frameId = 0;

    const step = (now: number) => {
      const linearProgress = Math.min((now - startTime) / COUNT_ANIMATION_MS, 1);
      // Ease-out cubic so the number settles instead of stopping abruptly.
      setProgress(1 - Math.pow(1 - linearProgress, 3));
      if (linearProgress < 1) frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);

    return () => window.cancelAnimationFrame(frameId);
  }, [target, base, enabled]);

  if (target === null) return null;
  if (!enabled || base === null) return target;

  // Not rounded here — callers decide (integer token counts round for
  // display, fractional percentages need to keep their precision).
  return base + (target - base) * progress;
}

function CountCard({
  title,
  value,
  baseValue,
  scaleValue,
  pending = false,
}: {
  title: string;
  value: DemoMetricValue;
  baseValue?: DemoMetricValue;
  scaleValue?: DemoMetricValue;
  pending?: boolean;
}) {
  const countNumber = useHeldNumber(value, pending);
  const baseNumber = useHeldNumber(baseValue, pending);
  const scaleNumber = useHeldNumber(scaleValue ?? baseValue ?? value, pending);
  // Original tokens has no baseValue — it never animates, it just is the
  // reference size, and it gets the plain card style. Model/Optimal both
  // shrink from that reference every time and share the same green styling.
  const shouldAnimate = baseValue !== undefined;
  const animatedCount = useShrinkFromBase(countNumber, baseNumber, shouldAnimate);
  // Token counts are integers — round only for display/the bar, the hook
  // itself keeps the unrounded float so the animation stays smooth.
  const displayedCount = animatedCount === null ? null : Math.round(animatedCount);

  const delta = baseValue === undefined ? null : countDelta(countNumber, baseNumber);
  const deltaNumber = delta ? Number(delta.replace("%", "")) : null;
  const barPercent =
    animatedCount !== null && scaleNumber !== null && scaleNumber > 0
      ? Math.max(Math.min((animatedCount / scaleNumber) * 100, 100), 2)
      : null;

  const isImprovement = deltaNumber !== null && deltaNumber < 0;
  const isRegression = deltaNumber !== null && deltaNumber > 0;

  return (
    <Card
      className={cn(
        "h-full rounded-lg py-5 shadow-sm",
        shouldAnimate
          ? "border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white"
          : "border-zinc-200 bg-white"
      )}
    >
      <CardContent className="flex h-full flex-col gap-3">
        <div className="whitespace-nowrap text-sm text-muted-foreground">{title}</div>
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-semibold tabular-nums tracking-normal">
            {displayedCount === null ? formatCount(value) : formatCount(displayedCount)}
          </div>
          {delta && (
            <div
              className={cn(
                "rounded-full px-2 py-0.5 text-sm font-medium tabular-nums",
                isImprovement && "bg-green-100 text-green-800",
                deltaNumber === 0 && "bg-muted text-muted-foreground",
                isRegression && "bg-red-100 text-red-800"
              )}
            >
              {isImprovement ? `↓${delta.replace("-", "")}` : delta}
            </div>
          )}
        </div>
        {barPercent !== null && (
          <div
            className={cn(
              "mt-auto h-2 w-full overflow-hidden rounded-full",
              shouldAnimate ? "bg-emerald-100" : "bg-muted"
            )}
          >
            <div
              className={cn(
                "h-full rounded-full",
                shouldAnimate ? "bg-emerald-500" : "bg-zinc-400"
              )}
              style={{ width: `${barPercent}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeaturedMetricCard({
  label,
  rawValue,
  percent,
  Icon,
}: {
  label: string;
  rawValue: number | null;
  percent?: boolean;
  Icon?: typeof Gauge;
}) {
  // Counts up from 0 every time a new value lands — first load, example
  // switch, or model switch — matching the shrink-from-base cards above.
  const animatedValue = useShrinkFromBase(rawValue, rawValue === null ? null : 0, true);
  const barPercent =
    percent && animatedValue !== null ? Math.max(Math.min(animatedValue * 100, 100), 0) : null;

  return (
    <div className="rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-5 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-700">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-normal text-emerald-950">
        {formatMetricValue(animatedValue, { percent })}
      </div>
      {barPercent !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${barPercent}%` }} />
        </div>
      )}
    </div>
  );
}

function tokenColorIndex(token: DemoToken): number {
  return token.source_token_start ?? token.index;
}

function tokenClass(token: DemoToken, tokenizer?: DemoTokenizerMetadata): string {
  const kind = tokenKind(token, tokenizer);

  if (kind === "zip") {
    return HYPER_COLORS[tokenColorIndex(token) % HYPER_COLORS.length];
  }

  if (kind === "special" || kind === "pad") {
    return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }

  return BASE_COLORS[tokenColorIndex(token) % BASE_COLORS.length];
}

function TokenPanel({
  title,
  tokenIds,
  tokens,
  tokenizerMetadata,
  expectedCount,
  visibleLimit,
  elapsedSeconds,
  isReplaying,
  reconstructionText,
  referenceText,
  missingMessage,
}: {
  title: string;
  tokenIds?: number[];
  tokens?: DemoToken[];
  tokenizerMetadata?: DemoTokenizerMetadata;
  expectedCount?: DemoMetricValue;
  visibleLimit?: number;
  elapsedSeconds?: number | null;
  isReplaying?: boolean;
  reconstructionText?: string;
  referenceText?: string;
  missingMessage: string;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const allTokens: DemoToken[] | undefined = tokens?.length
    ? tokens
    : tokenIds?.map((id, index) => ({ index, id }));
  const visibleTokens =
    allTokens && visibleLimit !== undefined ? allTokens.slice(0, visibleLimit) : allTokens;
  const shownCount = visibleTokens?.length ?? 0;
  const totalCount = allTokens?.length ?? 0;
  const expectedCountNumber = metricAsNumber(expectedCount);
  const countMismatch =
    expectedCountNumber !== null &&
    totalCount > 0 &&
    totalCount !== expectedCountNumber;
  const reconstructionMismatch =
    reconstructionText !== undefined &&
    referenceText !== undefined &&
    reconstructionText !== referenceText;

  useEffect(() => {
    if (visibleLimit === undefined) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const frameId = window.requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [visibleLimit, shownCount]);

  return (
    <Card className="rounded-lg border-zinc-200 bg-white py-5 shadow-sm">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base text-muted-foreground">{title}</CardTitle>
            {countMismatch && <Badge variant="outline">count mismatch</Badge>}
            {reconstructionMismatch && <Badge variant="outline">reconstruction differs</Badge>}
          </div>
          <div className="flex flex-col items-end gap-1 whitespace-nowrap font-mono text-sm text-muted-foreground">
            <span>
              {totalCount
                ? isReplaying && visibleLimit !== undefined
                  ? `${shownCount}/${totalCount} tokens`
                  : `${totalCount} tokens`
                : "Missing"}
            </span>
            {elapsedSeconds !== undefined && elapsedSeconds !== null && (
              <span className="text-xs">{elapsedSeconds.toFixed(2)}s</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visibleTokens?.length ? (
          <div
            ref={scrollContainerRef}
            className="max-h-72 overflow-y-auto overflow-x-hidden rounded-lg bg-background p-3"
          >
            <div className="font-mono text-sm leading-7 break-all">
              {visibleTokens.map((token) => (
                <span
                  key={`${token.index}-${token.id}`}
                  title={`index=${token.index}, id=${token.id}\n${tokenLabel(token)}`}
                  className={cn(
                    "box-decoration-clone px-0.5 py-0.5 whitespace-pre-wrap",
                    "[animation:token-reveal_200ms_ease-out]",
                    tokenClass(token, tokenizerMetadata)
                  )}
                >
                  {token.text !== undefined && token.text.length > 0
                    ? token.text.replace(/\n/g, "↵\n")
                    : token.text === ""
                    ? " "
                    : `[${token.id}]`}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <MissingData message={missingMessage} />
        )}
        {reconstructionMismatch && (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
            The exported reconstruction differs from the response text for this result.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CodebookPanel({
  title,
  entries,
}: {
  title: string;
  entries: DemoCodebookEntry[];
}) {
  return (
    <Card className="rounded-lg border-zinc-200 bg-white py-5 shadow-sm">
      <CardHeader className="gap-1 pb-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {entries.length ? `${entries.length} entries` : "No codebook metadata"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="max-h-96 space-y-3 overflow-auto pr-1">
            {entries.slice(0, 80).map((entry) => (
              <div key={entry.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">ID {entry.id}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {entry.length ?? entry.base_token_ids.length} base tokens
                  </span>
                </div>
                <div className="space-y-2 font-mono text-xs">
                  <div className="break-all text-muted-foreground">
                    [{entry.base_token_ids.join(", ")}]
                  </div>
                  <div className="whitespace-pre-wrap rounded-md bg-white p-2">
                    {entry.decoded_text || entry.base_token_texts?.join("") || "Missing decoded text"}
                  </div>
                </div>
              </div>
            ))}
            {entries.length > 80 && (
              <div className="text-xs text-muted-foreground">
                Showing first 80 entries. The full codebook remains available in the demo run.
              </div>
            )}
          </div>
        ) : (
          <MissingData message="Codebook entries are missing from this result artifact." />
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [manifest, setManifest] = useState<DemoManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [isManifestLoading, setIsManifestLoading] = useState(true);
  const [selectedModelSlug, setSelectedModelSlug] = useState("");
  const [selectedExampleId, setSelectedExampleId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [modelResultsBySlug, setModelResultsBySlug] = useState<Record<string, DemoModelResults>>({});
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [autoSelectedByModel, setAutoSelectedByModel] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<CompressionViewMode>("optimal");
  const [rightColumnHeight, setRightColumnHeight] = useState<number | null>(null);
  const [isReplayingTokens, setIsReplayingTokens] = useState(false);
  const [tokenReplayCounts, setTokenReplayCounts] = useState<TokenReplayCounts | null>(null);
  const [tokenReplayTimes, setTokenReplayTimes] = useState<TokenReplayTimes>({
    original: null,
    optimal: null,
    model: null,
  });
  const rightColumnRef = useRef<HTMLDivElement>(null);

  const loadManifest = async () => {
    setIsManifestLoading(true);
    setManifestError(null);

    try {
      const index = await fetchDemoJson<DemoRunIndex>(DEMO_RUNS_INDEX_PATH);
      const runManifests = await Promise.all(
        index.runs.map((run) =>
          fetchDemoJson<DemoManifest>(`${resolveDemoRunPath(run.path)}/manifest.json`)
        )
      );
      const nextManifest = buildManifestFromRuns(index.runs, runManifests);
      setManifest(nextManifest);
      setSelectedModelSlug((current) => current || preferDefaultModel(nextManifest.models)?.slug || "");
      setSelectedExampleId(
        (current) => current || preferDefaultCategory(nextManifest.examples)?.id || ""
      );
    } catch (error) {
      setManifest(null);
      setManifestError(error instanceof Error ? error.message : "Failed to load manifest");
    } finally {
      setIsManifestLoading(false);
    }
  };

  useEffect(() => {
    void loadManifest();
  }, []);

  useEffect(() => {
    const element = rightColumnRef.current;
    if (!element) return;

    const updateHeight = () => {
      if (window.innerWidth < 1024) {
        setRightColumnHeight(null);
        return;
      }

      setRightColumnHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const selectedModel = useMemo(() => {
    return manifest?.models.find((model) => model.slug === selectedModelSlug) ?? null;
  }, [manifest, selectedModelSlug]);

  useEffect(() => {
    if (!selectedModel || modelResultsBySlug[selectedModel.slug]) return;

    let isCancelled = false;

    async function loadModelResults(model: DemoModelManifestEntry) {
      setModelLoadError(null);
      try {
        const results = await fetchDemoJson<DemoModelResults>(
          resolveDemoDataPath(model.results_file)
        );

        if (!isCancelled) {
          setModelResultsBySlug((current) => ({
            ...current,
            [model.slug]: {
              ...results,
              model_slug: model.slug,
              model_group: results.model_group ?? model.model_group,
              ms: results.ms ?? model.ms,
              tokenizer: results.tokenizer ?? model.tokenizer,
            },
          }));
        }
      } catch (error) {
        if (!isCancelled) {
          setModelLoadError(error instanceof Error ? error.message : "Failed to load model results");
        }
      }
    }

    void loadModelResults(selectedModel);

    return () => {
      isCancelled = true;
    };
  }, [selectedModel, modelResultsBySlug]);

  const modelResults = selectedModelSlug ? modelResultsBySlug[selectedModelSlug] ?? null : null;
  // True only while the selected model's results file is still downloading.
  const isModelResultPending = Boolean(selectedModelSlug) && !modelResults && !modelLoadError;
  const tokenizer = modelResults?.tokenizer ?? selectedModel?.tokenizer;

  useEffect(() => {
    if (!selectedModelSlug || !modelResults || autoSelectedByModel[selectedModelSlug]) return;

    const currentResult = findExampleResult(modelResults, selectedExampleId);
    const firstDisplayableResult = preferDefaultCategory(
      modelResults.examples.filter(hasDisplayableResult)
    );

    if (firstDisplayableResult && (!currentResult || !hasDisplayableResult(currentResult))) {
      setSelectedExampleId(firstDisplayableResult.example_id);
    }

    setAutoSelectedByModel((current) => ({
      ...current,
      [selectedModelSlug]: true,
    }));
  }, [autoSelectedByModel, modelResults, selectedExampleId, selectedModelSlug]);

  const exampleOptions = useMemo(() => {
    const examplesById = new Map<string, DemoManifestExample>();

    manifest?.examples.forEach((example) => examplesById.set(example.id, example));
    modelResults?.examples.forEach((example) => {
      if (!examplesById.has(example.example_id)) {
        examplesById.set(example.example_id, {
          id: example.example_id,
          category: example.category,
          display_label: [example.example_id, example.category].filter(Boolean).join(" · "),
          prompt: example.prompt,
        });
      }
    });

    return Array.from(examplesById.values());
  }, [manifest, modelResults]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    exampleOptions.forEach((example) => {
      if (example.category) categories.add(example.category);
    });
    return Array.from(categories);
  }, [exampleOptions]);

  const filteredExampleOptions = useMemo(
    () =>
      selectedCategory
        ? exampleOptions.filter((example) => example.category === selectedCategory)
        : exampleOptions,
    [exampleOptions, selectedCategory]
  );

  useEffect(() => {
    if (selectedExampleId || !exampleOptions[0]) return;
    const defaultExample = preferDefaultCategory(exampleOptions) ?? exampleOptions[0];
    setSelectedExampleId(defaultExample.id);
  }, [exampleOptions, selectedExampleId]);

  // Initialize/sync the selected category from the selected example.
  useEffect(() => {
    if (selectedCategory) return;
    const current = exampleOptions.find((example) => example.id === selectedExampleId);
    if (current?.category) setSelectedCategory(current.category);
  }, [exampleOptions, selectedCategory, selectedExampleId]);

  // When the category changes, ensure the selected example belongs to it.
  useEffect(() => {
    if (!selectedCategory) return;
    const stillValid = filteredExampleOptions.some((example) => example.id === selectedExampleId);
    if (!stillValid && filteredExampleOptions[0]) {
      setSelectedExampleId(filteredExampleOptions[0].id);
    }
  }, [filteredExampleOptions, selectedCategory, selectedExampleId]);

  const selectedManifestExample =
    exampleOptions.find((example) => example.id === selectedExampleId) ?? null;
  const selectedResult = findExampleResult(modelResults, selectedExampleId);
  const originalMetricCount = metricCount(
    selectedResult,
    "base_new_tokens",
    selectedResult?.original?.token_ids?.length
  );
  const optimalMetricCount = metricCount(
    selectedResult,
    "theory_new_zip_tokens",
    selectedResult?.optimal?.compressed_token_ids?.length
  );
  const modelMetricCount = metricCount(
    selectedResult,
    "actual_new_zip_tokens",
    selectedResult?.model_result?.compressed_token_ids?.length
  );
  const originalDisplayCount = displayCount(
    selectedResult?.original?.tokens,
    selectedResult?.original?.token_ids
  );
  const optimalDisplayCount = displayCount(
    selectedResult?.optimal?.tokens,
    selectedResult?.optimal?.compressed_token_ids
  );
  const modelDisplayCount = displayCount(
    selectedResult?.model_result?.tokens,
    selectedResult?.model_result?.compressed_token_ids
  );
  const originalCount = originalDisplayCount ?? originalMetricCount;
  const optimalCount = optimalDisplayCount ?? optimalMetricCount;
  const modelCount = modelDisplayCount ?? modelMetricCount;
  const activeCodebook = codebookForMode(selectedResult, viewMode);
  const replayTotalCounts = useMemo(
    () => ({
      original: originalDisplayCount ?? 0,
      optimal: optimalDisplayCount ?? 0,
      model: modelDisplayCount ?? 0,
    }),
    [modelDisplayCount, optimalDisplayCount, originalDisplayCount]
  );
  const hasReplayableTokens =
    replayTotalCounts.original > 0 ||
    replayTotalCounts.optimal > 0 ||
    replayTotalCounts.model > 0;

  const resetTokenReplay = useCallback(() => {
    setIsReplayingTokens(false);
    setTokenReplayCounts(null);
    setTokenReplayTimes({
      original: null,
      optimal: null,
      model: null,
    });
  }, []);

  // Auto-play the token reveal from the start whenever the selected example or
  // model changes. While the newly selected model's results are still loading,
  // hasReplayableTokens is false, so this resets to empty and waits; once the
  // data arrives (hasReplayableTokens flips to true) it restarts the replay.
  useEffect(() => {
    if (hasReplayableTokens) {
      setTokenReplayCounts({ original: 0, optimal: 0, model: 0 });
      setTokenReplayTimes({ original: 0, optimal: 0, model: 0 });
      setIsReplayingTokens(true);
    } else {
      setIsReplayingTokens(false);
      setTokenReplayCounts(null);
      setTokenReplayTimes({ original: null, optimal: null, model: null });
    }
  }, [selectedExampleId, selectedModelSlug, hasReplayableTokens]);

  const startTokenReplay = useCallback(() => {
    if (!hasReplayableTokens) return;

    setTokenReplayCounts({ original: 0, optimal: 0, model: 0 });
    setTokenReplayTimes({ original: 0, optimal: 0, model: 0 });
    setIsReplayingTokens(true);
  }, [hasReplayableTokens]);

  useEffect(() => {
    if (!isReplayingTokens) return;

    const maxCount = Math.max(
      replayTotalCounts.original,
      replayTotalCounts.optimal,
      replayTotalCounts.model
    );

    if (maxCount === 0) {
      resetTokenReplay();
      return;
    }

    const replayStart = performance.now();

    const updateReplay = () => {
      const elapsedSeconds = (performance.now() - replayStart) / 1000;
      const nextCount = Math.min(
        maxCount,
        Math.floor((elapsedSeconds * 1000) / TOKEN_REPLAY_INTERVAL_MS) + 1
      );

      setTokenReplayCounts({
        original: Math.min(nextCount, replayTotalCounts.original),
        optimal: Math.min(nextCount, replayTotalCounts.optimal),
        model: Math.min(nextCount, replayTotalCounts.model),
      });
      setTokenReplayTimes({
        original:
          replayTotalCounts.original > 0
            ? Math.min(elapsedSeconds, (replayTotalCounts.original * TOKEN_REPLAY_INTERVAL_MS) / 1000)
            : null,
        optimal:
          replayTotalCounts.optimal > 0
            ? Math.min(elapsedSeconds, (replayTotalCounts.optimal * TOKEN_REPLAY_INTERVAL_MS) / 1000)
            : null,
        model:
          replayTotalCounts.model > 0
            ? Math.min(elapsedSeconds, (replayTotalCounts.model * TOKEN_REPLAY_INTERVAL_MS) / 1000)
            : null,
      });

      if (nextCount >= maxCount) {
        setIsReplayingTokens(false);
      }
    };

    updateReplay();
    const intervalId = window.setInterval(updateReplay, TOKEN_REPLAY_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isReplayingTokens, replayTotalCounts, resetTokenReplay]);

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col gap-5 border-b pb-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Image
                src="/dlab-logo.png"
                alt="dlab"
                width={40}
                height={40}
                className="rounded-md"
              />
              <h1 className="text-4xl font-semibold tracking-normal md:text-5xl">
                zip2zip++
              </h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Result-driven view for model compression and reconstruction artifacts.
            </p>
          </div>
          <Button variant="outline" className="shadow-sm" onClick={loadManifest} disabled={isManifestLoading}>
            <RefreshCw />
            Reload data
          </Button>
        </header>

        {manifestError && (
          <MissingData
            message={`Could not load /public${DEMO_RUNS_INDEX_PATH}: ${manifestError}`}
          />
        )}

        {!manifestError && !isManifestLoading && manifest?.models.length === 0 && (
          <MissingData
            message="Waiting for demo runs. Add run folders under public/demo-runs and list them in index.json."
          />
        )}

        <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
          <div className="min-h-0">
            <Card
              className="flex min-h-0 flex-col rounded-lg border-zinc-200 bg-white shadow-sm"
              style={rightColumnHeight ? { height: rightColumnHeight } : undefined}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4" />
                  <CardTitle className="text-lg">Example</CardTitle>
                </div>
                <CardDescription>Select an example and inspect its prompt/response.</CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-5">
                {exampleOptions.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="category-select">Category</Label>
                      {categoryOptions.length ? (
                        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                          <SelectTrigger id="category-select" className="w-full">
                            <SelectValue placeholder="All categories" />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <MissingData message="No categories available." />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="example-select">Example ID</Label>
                      <Select value={selectedExampleId} onValueChange={setSelectedExampleId}>
                        <SelectTrigger id="example-select" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredExampleOptions.map((example) => (
                            <SelectItem key={example.id} value={example.id}>
                              {example.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <MissingData message="No examples available in manifest or loaded model results." />
                )}

                <TextBlock
                  title="Prompt"
                  text={selectedResult?.prompt ?? selectedManifestExample?.prompt}
                  bodyClassName="max-h-40"
                />
                <TextBlock
                  title="Response"
                  text={selectedResult?.response}
                  className="flex min-h-0 flex-1 flex-col"
                  bodyClassName="min-h-0 max-h-none flex-1"
                />
              </CardContent>
            </Card>
          </div>

          <div ref={rightColumnRef} className="space-y-6">
            <Card className="rounded-lg border-zinc-200 bg-white shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Database className="size-4" />
                  <CardTitle className="text-lg">Model</CardTitle>
                </div>
                <CardDescription>
                  Changing the model switches all response, token, codebook, and metric views.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="model-select">Trained model</Label>
                  {manifest?.models.length ? (
                    <Select value={selectedModelSlug} onValueChange={setSelectedModelSlug}>
                      <SelectTrigger id="model-select" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {manifest.models.map((model, index) => {
                          const label = modelLabel(model);
                          const baseModel = modelBaseName(label);
                          const previousBaseModel =
                            index > 0 ? modelBaseName(modelLabel(manifest.models[index - 1])) : null;
                          const isNewGroup = previousBaseModel !== null && baseModel !== previousBaseModel;

                          return (
                            <Fragment key={model.slug}>
                              {isNewGroup && <SelectSeparator />}
                              <SelectItem
                                value={model.slug}
                                className={cn(isHyperCompressedModel(label) && "font-semibold")}
                              >
                                {label}
                              </SelectItem>
                            </Fragment>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <MissingData message="No model entries found in demo run manifests." />
                  )}
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Tokenizer</div>
                  <div className="mt-1 max-w-72 truncate">{tokenizer?.name ?? "Missing"}</div>
                  {tokenizer && (
                    <div className="mt-1">
                      zip start {tokenizer.zip_token_start}; base vocab {tokenizer.base_vocab_size}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {modelLoadError && <MissingData message={modelLoadError} />}

            <div className="grid gap-4 md:grid-cols-3">
              <CountCard
                title="Original tokens"
                value={originalCount}
                scaleValue={originalCount}
                pending={isModelResultPending}
              />
              <CountCard
                title="Model compressed tokens"
                value={modelCount}
                baseValue={originalCount}
                scaleValue={originalCount}
                pending={isModelResultPending}
              />
              <CountCard
                title="Optimal compressed tokens"
                value={optimalCount}
                baseValue={originalCount}
                scaleValue={originalCount}
                pending={isModelResultPending}
              />
            </div>

            <Card className="rounded-lg border-zinc-200 bg-white shadow-sm">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2">
                  <Layers className="size-4" />
                  <CardTitle className="text-lg">Metrics</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {selectedResult?.metrics ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {MAIN_METRIC_ROWS.map((row) => (
                        <div
                          key={row.key}
                          className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4"
                        >
                          <div className="text-xs font-medium text-muted-foreground">
                            {row.label}
                          </div>
                          <div className="mt-1.5 text-xl font-semibold tracking-normal">
                            {formatMetricValue(selectedResult.metrics?.[row.key], {
                              percent: row.percent,
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {FEATURED_METRIC_ROWS.map((row) => (
                        <FeaturedMetricCard
                          key={row.key}
                          label={row.label}
                          rawValue={metricAsNumber(selectedResult.metrics?.[row.key])}
                          percent={row.percent}
                          Icon={FEATURED_METRIC_ICONS[row.key]}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <MissingData message="Metrics are missing for this example/model pair." />
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal">Token View</h2>
              <p className="text-sm text-muted-foreground">
                Original, optimal compressed, and real model compressed artifacts.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={isReplayingTokens ? resetTokenReplay : startTokenReplay}
              disabled={!hasReplayableTokens}
            >
              {isReplayingTokens ? <Square /> : <Play />}
              {isReplayingTokens ? "Stop replay" : "Replay tokens"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", BASE_COLORS[0].split(" ")[1])} />
              Base token (color cycles by position)
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", HYPER_COLORS[0].split(" ")[1])} />
              Zip (compressed) token
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border border-zinc-300 bg-zinc-100" />
              Special / pad token
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <TokenPanel
              title="Original"
              tokenIds={selectedResult?.original?.token_ids}
              tokens={selectedResult?.original?.tokens}
              tokenizerMetadata={tokenizer}
              expectedCount={originalMetricCount}
              visibleLimit={tokenReplayCounts?.original}
              elapsedSeconds={tokenReplayTimes.original}
              isReplaying={isReplayingTokens}
              missingMessage="original.token_ids and original.tokens are missing."
            />
            <TokenPanel
              title="Real / model compressed"
              tokenIds={selectedResult?.model_result?.compressed_token_ids}
              tokens={selectedResult?.model_result?.tokens}
              tokenizerMetadata={tokenizer}
              expectedCount={modelMetricCount}
              visibleLimit={tokenReplayCounts?.model}
              elapsedSeconds={tokenReplayTimes.model}
              isReplaying={isReplayingTokens}
              reconstructionText={selectedResult?.model_result?.reconstructed_text}
              referenceText={selectedResult?.response}
              missingMessage="model_result.compressed_token_ids and model_result.tokens are missing."
            />
            <TokenPanel
              title="Optimal compressed"
              tokenIds={selectedResult?.optimal?.compressed_token_ids}
              tokens={selectedResult?.optimal?.tokens}
              tokenizerMetadata={tokenizer}
              expectedCount={optimalMetricCount}
              visibleLimit={tokenReplayCounts?.optimal}
              elapsedSeconds={tokenReplayTimes.optimal}
              isReplaying={isReplayingTokens}
              reconstructionText={selectedResult?.optimal?.reconstructed_text}
              referenceText={selectedResult?.response}
              missingMessage="optimal.compressed_token_ids and optimal.tokens are missing."
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal">Codebook View</h2>
              <p className="text-sm text-muted-foreground">
                Optimal and real model compression codebooks.
              </p>
            </div>
            <div className="inline-flex w-fit rounded-lg border bg-muted p-1">
              <Button
                variant={viewMode === "optimal" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("optimal")}
              >
                <Box />
                Optimal codebook / tokens
              </Button>
              <Button
                variant={viewMode === "model" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("model")}
              >
                <Database />
                Real model codebook / tokens
              </Button>
            </div>
          </div>

          <CodebookPanel
            title={
              viewMode === "optimal"
                ? "Optimal codebook"
                : "Real model codebook"
            }
            entries={activeCodebook}
          />
        </section>
      </div>
    </main>
  );
}
