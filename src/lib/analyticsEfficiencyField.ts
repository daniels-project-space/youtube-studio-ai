export type AnalyticsEfficiencyDatum = {
  channelId: string;
  name: string;
  slug: string;
  totalViews: number;
  costTotal: number;
  videoCount: number;
};

export type AnalyticsEfficiencyNode = AnalyticsEfficiencyDatum & {
  rawX: number;
  rawY: number;
  x: number;
  y: number;
  radius: number;
  displaced: boolean;
  selected: boolean;
  label: null | {
    x: number;
    y: number;
    anchor: "start" | "end";
  };
};

const PLOT_LEFT = 42;
const PLOT_RIGHT = 694;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 208;
const NODE_X_START = 58;
const NODE_X_SPAN = 614;
const NODE_Y_BASE = 194;
const NODE_Y_SPAN = 156;
const LABEL_TOP = 29;
const LABEL_BOTTOM = 199;
const LABEL_GAP = 17;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function settleLabelColumn(
  nodes: AnalyticsEfficiencyNode[],
): Map<string, number> {
  const sorted = [...nodes].sort((left, right) => {
    const leftTarget = left.y - left.radius - 7;
    const rightTarget = right.y - right.radius - 7;
    return leftTarget - rightTarget || left.name.localeCompare(right.name);
  });
  if (!sorted.length) return new Map();

  const ys: number[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const target = sorted[index].y - sorted[index].radius - 7;
    const floor = index === 0 ? LABEL_TOP : ys[index - 1] + LABEL_GAP;
    ys.push(Math.max(floor, target));
  }
  const overflow = Math.max(0, ys[ys.length - 1] - LABEL_BOTTOM);
  return new Map(sorted.map((node, index) => [node.channelId, ys[index] - overflow]));
}

/**
 * Lays out the custom reach/spend field without hiding channels that share the
 * same persisted totals. Exact positions remain in rawX/rawY; only colliding
 * hit targets are fanned out, with the UI drawing a connector back to truth.
 */
export function layoutAnalyticsEfficiencyField(
  rows: readonly AnalyticsEfficiencyDatum[],
  selectedChannelId: string | null,
): AnalyticsEfficiencyNode[] {
  const maxCost = Math.max(1, ...rows.map((row) => finiteNonNegative(row.costTotal)));
  const maxViews = Math.max(1, ...rows.map((row) => finiteNonNegative(row.totalViews)));
  const maxVideos = Math.max(1, ...rows.map((row) => finiteNonNegative(row.videoCount)));
  const nodes: AnalyticsEfficiencyNode[] = rows.map((row) => {
    const cost = finiteNonNegative(row.costTotal);
    const views = finiteNonNegative(row.totalViews);
    const videos = finiteNonNegative(row.videoCount);
    const rawX = NODE_X_START + (cost / maxCost) * NODE_X_SPAN;
    const rawY = NODE_Y_BASE - (views / maxViews) * NODE_Y_SPAN;
    return {
      ...row,
      rawX,
      rawY,
      x: rawX,
      y: rawY,
      radius: 5 + Math.sqrt(videos / maxVideos) * 10,
      displaced: false,
      selected: row.channelId === selectedChannelId,
      label: null,
    };
  });

  // Connected collision groups catch exact ties as well as large nearby nodes.
  const parent = nodes.map((_, index) => index);
  const root = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = cursor;
      index = next;
    }
    return cursor;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const distance = Math.hypot(
        nodes[left].rawX - nodes[right].rawX,
        nodes[left].rawY - nodes[right].rawY,
      );
      if (distance < nodes[left].radius + nodes[right].radius + 6) unite(left, right);
    }
  }

  const groups = new Map<number, number[]>();
  nodes.forEach((_, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(index);
    groups.set(root(index), group);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    indexes.sort((left, right) => nodes[left].channelId.localeCompare(nodes[right].channelId));
    const maxRadius = Math.max(...indexes.map((index) => nodes[index].radius));
    const columns = Math.ceil(Math.sqrt(indexes.length));
    const rowCount = Math.ceil(indexes.length / columns);
    const spacing = maxRadius * 2 + 6;
    const width = (columns - 1) * spacing;
    const height = (rowCount - 1) * spacing;
    const centerX = indexes.reduce((sum, index) => sum + nodes[index].rawX, 0) / indexes.length;
    const centerY = indexes.reduce((sum, index) => sum + nodes[index].rawY, 0) / indexes.length;
    const originX = clamp(centerX - width / 2, PLOT_LEFT + maxRadius, PLOT_RIGHT - maxRadius - width);
    const originY = clamp(centerY - height / 2, PLOT_TOP + maxRadius, PLOT_BOTTOM - maxRadius - height);
    indexes.forEach((nodeIndex, position) => {
      const rowIndex = Math.floor(position / columns);
      const columnIndex = position % columns;
      const node = nodes[nodeIndex];
      node.x = originX + columnIndex * spacing;
      node.y = originY + rowIndex * spacing;
      node.displaced = Math.hypot(node.x - node.rawX, node.y - node.rawY) > 0.5;
    });
  }

  const labelledIds = new Set(
    [...nodes]
      .sort((left, right) => right.totalViews - left.totalViews || left.name.localeCompare(right.name))
      .slice(0, 5)
      .map((node) => node.channelId),
  );
  if (selectedChannelId) labelledIds.add(selectedChannelId);
  const labelled = nodes.filter((node) => labelledIds.has(node.channelId));
  const leftColumn = labelled.filter((node) => node.x >= (PLOT_LEFT + PLOT_RIGHT) / 2);
  const rightColumn = labelled.filter((node) => node.x < (PLOT_LEFT + PLOT_RIGHT) / 2);
  const leftYs = settleLabelColumn(leftColumn);
  const rightYs = settleLabelColumn(rightColumn);
  for (const node of labelled) {
    const onLeft = node.x >= (PLOT_LEFT + PLOT_RIGHT) / 2;
    node.label = {
      x: node.x + (onLeft ? -1 : 1) * (node.radius + 10),
      y: (onLeft ? leftYs : rightYs).get(node.channelId) ?? node.y,
      anchor: onLeft ? "end" : "start",
    };
  }

  return nodes;
}
