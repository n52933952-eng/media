/**
 * Live UI scaling — baseline ~390×812 phone layout, used on web live pages.
 */

import { useEffect, useMemo, useState } from 'react';

const REF_W = 390;
const REF_H = 812;
const SCALE_MIN = 0.88;
const SCALE_MAX = 1.12;

export function computeLiveScale(width, height) {
  const h = height / REF_H;
  const w = width / REF_W;
  const blended = h * 0.72 + w * 0.28;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, blended));
}

export function s(size, scale) {
  return Math.round(size * scale);
}

export function buildLiveScreenMetrics(width, height) {
  const scale = computeLiveScale(width, height);
  const topBarTop = Math.max(10, 10) + s(8, scale);

  return {
    scale,
    pillH: s(46, scale),
    actionCircle: s(44, scale),
    /** Tighter on web — 82px phone slots push icons into the top bar on short viewports */
    actionSlotH: s(64, scale),
    actionRailWidth: s(76, scale),
    actionRailRight: s(10, scale),
    actionRailGutter: s(88, scale),
    chatLogH: s(180, scale),
    floatChatStackH: s(200, scale),
    floatChatMaxH: Math.min(s(400, scale), Math.round(height * 0.45)),
    topBarTop,
    liveTopBarClear: topBarTop + s(52, scale),
    reactionAreaHeight: s(280, scale),
    emojiPickerBtn: s(38, scale),
    emojiPickerEmoji: s(24, scale),
    emojiPickerMaxW: s(280, scale),
    floatReactionEmoji: s(42, scale),
    actionIconSize: s(22, scale),
    actionLabelSize: s(11, scale),
    viewerRailBottomExtra: s(112, scale),
    /** Web: rail sits above chat input — keep clear of bottom bar */
    broadcasterRailBottomExtra: s(72, scale),
    viewportHeight: height,
  };
}

/** Bottom offset so the full icon stack fits below End/Leave on any viewport height. */
export function computeActionRailBottom(viewportHeight, iconCount, metrics, isBroadcaster) {
  const gap = 4;
  const itemH = metrics.actionCircle + metrics.actionLabelSize + 12;
  const stackH = iconCount * itemH + Math.max(0, iconCount - 1) * gap;
  const safeTop = metrics.liveTopBarClear + 28;
  const preferred = 64 + 12 + (
    isBroadcaster ? metrics.broadcasterRailBottomExtra : metrics.viewerRailBottomExtra
  );
  const fitBottom = viewportHeight - stackH - safeTop;
  return Math.min(preferred, Math.max(68, fitBottom));
}

export function useLiveScreenMetrics() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : REF_W,
    height: typeof window !== 'undefined' ? window.innerHeight : REF_H,
  }));

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return useMemo(
    () => buildLiveScreenMetrics(size.width, size.height),
    [size.width, size.height],
  );
}

/** Shared action-rail layout tokens. */
export function liveActionStyles(m, railSlots) {
  return {
    actionRail: {
      right: `${m.actionRailRight}px`,
      width: `${m.actionRailWidth}px`,
      height: `${m.actionSlotH * railSlots}px`,
    },
    actionCircle: {
      width: `${m.actionCircle}px`,
      height: `${m.actionCircle}px`,
    },
    actionIcon: { fontSize: `${m.actionIconSize}px`, lineHeight: 1 },
    actionLabel: { fontSize: `${m.actionLabelSize}px`, maxWidth: `${s(72, m.scale)}px` },
    topBar: { top: `${m.topBarTop}px` },
    floatArea: { right: `${m.actionRailGutter}px` },
    logPanel: { right: `${m.actionRailGutter}px`, height: `${m.chatLogH}px` },
    reactionArea: { height: `${m.reactionAreaHeight}px` },
    emojiPickerAnchor: { right: `${m.actionRailGutter - s(2, m.scale)}px`, maxWidth: `${m.emojiPickerMaxW}px` },
    emojiPickerBtn: {
      width: `${m.emojiPickerBtn}px`,
      height: `${m.emojiPickerBtn}px`,
      borderRadius: `${m.emojiPickerBtn / 2}px`,
    },
    emojiPickerEmoji: { fontSize: `${m.emojiPickerEmoji}px`, lineHeight: 1 },
    floatReactionEmoji: { fontSize: `${m.floatReactionEmoji}px` },
    textInput: { height: `${m.pillH}px` },
    sendBtn: { height: `${m.pillH}px`, minWidth: `${s(72, m.scale)}px` },
  };
}
