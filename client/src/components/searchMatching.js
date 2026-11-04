function wordDistance(first, second, limit = 2) {
  if (Math.abs(first.length - second.length) > limit) return limit + 1;
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    let minimum = firstIndex;
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      current[secondIndex] = Math.min(
        current[secondIndex - 1] + 1,
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1)
      );
      minimum = Math.min(minimum, current[secondIndex]);
    }
    if (minimum > limit) return limit + 1;
    previous = current;
  }
  return previous[second.length];
}

export function fuzzySearchScore(query, text) {
  const queryWords = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const candidateWords = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!queryWords.length || !candidateWords.length) return null;
  let typoWords = 0;
  let score = 0;
  for (const queryWord of queryWords) {
    let bestDistance = Infinity;
    for (const candidateWord of candidateWords) {
      if (candidateWord.includes(queryWord)) {
        bestDistance = 0;
        break;
      }
      const distance = wordDistance(queryWord, candidateWord);
      if (distance < bestDistance) bestDistance = distance;
    }
    if (bestDistance > 2) return null;
    if (bestDistance > 0) typoWords += 1;
    score += bestDistance;
  }
  return typoWords <= 2 ? score : null;
}
