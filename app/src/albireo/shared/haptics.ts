type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection';

const durations: Record<HapticStyle, number> = {
  light: 8,
  medium: 14,
  heavy: 24,
  selection: 6,
};

export function pulseHaptic(style: HapticStyle = 'selection') {
  if ('vibrate' in navigator) {
    navigator.vibrate(durations[style]);
  }
}
