export type KnownCat = {
  id: string;
  displayName: string;
  dominantColors: string[];
};

export type CatTrackState = Record<string, KnownCat[]>;

export function matchKnownCat(inferredColor: string, knownCats: KnownCat[]): KnownCat | undefined {
  return knownCats.find((cat) => cat.dominantColors.includes(inferredColor));
}

export function identifyCat(
  cameraId: string,
  inferredColor: string,
  state: CatTrackState
): { id: string; displayName: string } {
  const known = state[cameraId] ?? [];
  const match = matchKnownCat(inferredColor, known);
  if (match) {
    return { id: match.id, displayName: match.displayName };
  }
  const id = `${cameraId}-cat-${known.length + 1}`;
  const created: KnownCat = {
    id,
    displayName: `Cat ${known.length + 1}`,
    dominantColors: [inferredColor]
  };
  state[cameraId] = [...known, created];
  return { id: created.id, displayName: created.displayName };
}
