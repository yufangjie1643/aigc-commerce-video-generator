const VECTOR_ONLY_MIN_SIMILARITY = 0.55;

export interface AssetLibraryRankedSearchResult<T> {
  asset: T;
  score: number;
  lexicalScore: number;
  tagScore: number;
  vectorScore?: number;
}

export function rankAssetLibrarySearchResults<T>(
  assets: T[],
  query: string,
  options: {
    limit: number;
    queryVector?: number[];
    tags?: string[];
    tagsFor?: (asset: T) => string[];
    textFor: (asset: T) => string;
    vectorFor: (asset: T) => number[] | undefined;
  }
): T[] {
  return rankAssetLibrarySearchMatches(assets, query, options).map((item) => item.asset);
}

export function rankAssetLibrarySearchMatches<T>(
  assets: T[],
  query: string,
  options: {
    limit: number;
    queryVector?: number[];
    tags?: string[];
    tagsFor?: (asset: T) => string[];
    textFor: (asset: T) => string;
    vectorFor: (asset: T) => number[] | undefined;
  }
): Array<AssetLibraryRankedSearchResult<T>> {
  const cleanQuery = normalizeSearchText(query);
  const cleanTags = normalizeSearchTags(options.tags ?? []);
  const searchText = [cleanQuery, ...cleanTags].filter(Boolean).join(" ");
  if (!searchText) {
    return assets.slice(0, options.limit).map((asset) => ({
      asset,
      score: 0,
      lexicalScore: 0,
      tagScore: 0
    }));
  }
  const compactQuery = compactSearchText(searchText);
  const terms = expandAssetLibrarySearchTerms(searchText).map(compactSearchText).filter(Boolean);
  const ranked = assets
    .map((asset, index) => {
      const text = compactSearchText(options.textFor(asset));
      const lexicalScore = scoreSearchText(text, compactQuery, terms);
      const tagScore = scoreSearchTags(text, options.tagsFor?.(asset) ?? [], cleanTags);
      const vectorScore = cosineSimilarity(options.queryVector, options.vectorFor(asset));
      const vectorPoints = vectorScore === undefined ? 0 : Math.max(0, vectorScore) * 20;
      return {
        asset,
        index,
        lexicalScore,
        tagScore,
        vectorScore: vectorScore ?? -1,
        score: lexicalScore + tagScore + vectorPoints
      };
    })
    .filter((item) => item.lexicalScore > 0 || item.tagScore > 0 || item.vectorScore >= VECTOR_ONLY_MIN_SIMILARITY)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.vectorScore !== a.vectorScore) return b.vectorScore - a.vectorScore;
      if (b.tagScore !== a.tagScore) return b.tagScore - a.tagScore;
      if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
      return a.index - b.index;
    });
  return ranked.slice(0, options.limit).map((item) => ({
    asset: item.asset,
    score: item.score,
    lexicalScore: item.lexicalScore,
    tagScore: item.tagScore,
    ...(item.vectorScore >= 0 ? { vectorScore: item.vectorScore } : {})
  }));
}

export function expandAssetLibrarySearchTerms(query: string): string[] {
  const normalized = normalizeSearchText(query);
  const terms = new Set<string>();
  if (normalized) terms.add(normalized);
  for (const part of normalized.split(/[\s,，、/|]+/u)) {
    if (part) terms.add(part);
  }
  if (/(裙子|裙装|裙|连衣裙|半身裙|短裙|长裙|衬衫裙|吊带裙|百褶裙|a字裙)/iu.test(normalized)) {
    ["裙", "裙子", "裙装", "连衣裙", "半身裙", "短裙", "长裙", "衬衫裙", "吊带裙", "百褶裙", "a字裙"].forEach((term) =>
      terms.add(term)
    );
  }
  return Array.from(terms);
}

function scoreSearchText(text: string, compactQuery: string, terms: string[]): number {
  let score = text.includes(compactQuery) ? 24 + Math.min(compactQuery.length, 12) : 0;
  for (const term of terms) {
    if (!term || term === compactQuery || !text.includes(term)) continue;
    score += term.length === 1 ? 4 : 8 + Math.min(term.length, 12);
  }
  return score;
}

function scoreSearchTags(text: string, assetTags: string[], queryTags: string[]): number {
  if (queryTags.length === 0) return 0;
  const compactTags = assetTags.map(compactSearchText).filter(Boolean);
  const tagText = compactTags.join(" ");
  let score = 0;
  for (const queryTag of queryTags) {
    const compactTag = compactSearchText(queryTag);
    if (!compactTag) continue;
    const expandedTags = expandAssetLibrarySearchTerms(queryTag).map(compactSearchText).filter(Boolean);
    if (compactTags.includes(compactTag)) {
      score += 32 + Math.min(compactTag.length, 12);
    } else if (tagText.includes(compactTag)) {
      score += 18 + Math.min(compactTag.length, 12);
    } else if (text.includes(compactTag)) {
      score += 10 + Math.min(compactTag.length, 12);
    } else {
      for (const expandedTag of expandedTags) {
        if (!expandedTag || expandedTag === compactTag) continue;
        if (compactTags.includes(expandedTag)) {
          score += 24 + Math.min(expandedTag.length, 12);
          break;
        }
        if (tagText.includes(expandedTag)) {
          score += 12 + Math.min(expandedTag.length, 12);
          break;
        }
      }
    }
  }
  return score;
}

function cosineSimilarity(a: number[] | undefined, b: number[] | undefined): number | undefined {
  if (!a?.length || !b?.length || a.length !== b.length) return undefined;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return undefined;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (aNorm <= 0 || bNorm <= 0) return undefined;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function normalizeSearchTags(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeSearchText).filter(Boolean)));
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/gu, "");
}
