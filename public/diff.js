const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function tokens(text) {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

function append(parts, text, changed) {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.changed === changed) last.text += text;
  else parts.push({ text, changed });
}

export function diffText(before, after) {
  // shortcut: очень длинные тексты выделяются целиком, чтобы не исчерпать память.
  if (before.length + after.length > 40_000) {
    const changed = before !== after;
    return { before: before ? [{ text: before, changed }] : [], after: after ? [{ text: after, changed }] : [], approximate: changed };
  }
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  const width = right.length + 1;
  const result = { before: [], after: [] };
  const common = (text) => { append(result.before, text, false); append(result.after, text, false); };
  common(a.slice(0, start).join(''));
  if ((left.length + 1) * width > 2_000_000) {
    append(result.before, left.join(''), true);
    append(result.after, right.join(''), true);
    common(a.slice(endA).join(''));
    result.approximate = true;
    return result;
  }
  const lengths = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * width + j] = left[i] === right[j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { common(left[i]); i++; j++; }
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) append(result.before, left[i++], true);
    else append(result.after, right[j++], true);
  }
  while (i < left.length) append(result.before, left[i++], true);
  while (j < right.length) append(result.after, right[j++], true);
  common(a.slice(endA).join(''));
  return result;
}
