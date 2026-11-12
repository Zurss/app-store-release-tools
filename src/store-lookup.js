const STORE_KINDS = { IOS: 'software', MAC_OS: 'mac-software' };

export async function findStoreVersion(appId, platform, versions, fetchImpl = fetch) {
  const kind = STORE_KINDS[platform];
  if (!kind || !/^\d+$/.test(appId)) return null;

  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', appId);
  url.searchParams.set('country', 'us');
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data?.results)) return null;
    const matches = data.results.filter((item) =>
      item?.kind === kind && String(item.trackId) === appId &&
      typeof item.version === 'string' && item.version.trim(),
    );
    if (matches.length !== 1) return null;
    const candidates = versions.filter((version) => version.attributes.versionString === matches[0].version);
    if (candidates.length !== 1) return null;
    const matchedDate = Date.parse(candidates[0].attributes.createdDate);
    if (Number.isFinite(matchedDate) && versions.some((v) => Date.parse(v.attributes.createdDate) > matchedDate)) return null;
    return candidates[0];
  } catch {
    return null;
  }
}
